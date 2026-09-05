const INT32_MAX = 0x7fffffff;
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const positiveInteger = value => Number.isInteger(value) && value > 0;
const int32 = value => positiveInteger(value) && value <= INT32_MAX;
const bounded = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const DATA_KEYS = ["version", "command", "sourceId", "seq", "epoch", "sampledAtMs", "state"];
const SAMPLE_KEYS = [...DATA_KEYS, "energy", "centroidX"];
const MUTE_KEYS = ["kind", "epoch", "revision"];
const LIVE_KEYS = [...MUTE_KEYS, "energy", "centroid", "expiresAtMs"];
const SNAPSHOT_KEYS = ["epoch", "revision", "closed", "expiresAtMs"];

// Revalidate the public object boundary; no credentials or wire buffers enter it.
// Overflow is distinguished from other invalid data so the owner can be disabled.
function validFrame(frame) {
  return exactKeys(frame, frame?.state === "sample" ? SAMPLE_KEYS : DATA_KEYS) &&
    frame.version === 1 && frame.command === "flock" && id(frame.sourceId) &&
    positiveInteger(frame.seq) && positiveInteger(frame.epoch) && bounded(frame.sampledAtMs, 3600000) &&
    ["sample", "empty", "unavailable"].includes(frame.state) &&
    (frame.state !== "sample" || [frame.energy, frame.centroidX].every(v => bounded(v, 1)));
}

// No timers, sockets, Show lease, or global Stop here. The transport must capture
// R by calling attach immediately before it queues the successful ACK.
export function createFlockInput({ nowMs, onDisable }) {
  let owner = null;
  let originMs;
  let lastNow = -Infinity;
  let sequence = 0;
  let sampledAtMs = 0;
  let epoch = 1;
  let revision = 0;
  let closed = false;
  let expiredCount = 0;
  let target = null;
  let pending = false;
  let lastLiveMs = -Infinity;

  const mute = () => {
    target = { kind: "flock-mute", epoch, revision };
    pending = true;
  };
  const close = (reason = "source-disconnect") => {
    if (closed) return;
    closed = true;
    revision++;
    mute();
    onDisable(reason);
  };
  const advance = () => {
    // Reserve the last int32 revision for a fresh terminal mute watermark.
    if (revision >= INT32_MAX - 1) {
      close("revision-overflow");
      return false;
    }
    revision++;
    return true;
  };
  const clock = () => {
    if (closed) return null;
    const now = nowMs();
    if (!Number.isFinite(now) || now < 0 || now < lastNow) {
      close("clock-anomaly");
      return null;
    }
    lastNow = now;
    if (target?.kind === "flock-live" && now >= target.expiresAtMs && advance()) mute();
    return now;
  };

  return {
    attach(sourceId) {
      if (closed || owner || !id(sourceId)) return false;
      const now = clock();
      if (closed) return false;
      owner = sourceId;
      originMs = now;
      return true;
    },
    accept(frame) {
      const now = clock();
      if (closed || !owner || !validFrame(frame) || frame.sourceId !== owner) return false;
      if (frame.seq > INT32_MAX || frame.epoch > INT32_MAX) {
        close("producer-counter-overflow");
        return false;
      }
      const sampled = originMs + frame.sampledAtMs;
      const expiresAtMs = sampled + 500;
      if (!Number.isFinite(expiresAtMs)) {
        close("clock-anomaly");
        return false;
      }
      if (now >= expiresAtMs) {
        if (++expiredCount >= 20) close("expired-frames");
        return false;
      }
      if (now < sampled || frame.seq <= sequence || frame.sampledAtMs < sampledAtMs ||
          frame.epoch < epoch || (sequence === 0 && frame.epoch !== 1)) return false;
      if (!advance()) return false;
      expiredCount = 0;
      sequence = frame.seq;
      sampledAtMs = frame.sampledAtMs;
      epoch = frame.epoch;
      target = frame.state === "sample"
        ? { kind: "flock-live", epoch, revision, energy: frame.energy, centroid: frame.centroidX, expiresAtMs }
        : { kind: "flock-mute", epoch, revision };
      pending = true;
      return true;
    },
    take({ showAuthorized = false } = {}) {
      const now = clock();
      if (showAuthorized !== true && target?.kind === "flock-live" && advance()) mute();
      if (!pending) return null;
      if (target.kind === "flock-live") {
        if (now - lastLiveMs < 50) return null;
        lastLiveMs = now;
      }
      pending = false;
      // Consumption clears only the pending bit; expiry responsibility remains.
      return { ...target };
    },
    snapshot() {
      clock();
      return { epoch, revision, closed, expiresAtMs: target?.kind === "flock-live" ? target.expiresAtMs : null };
    },
    close,
  };
}

// Call update before accept on every IPC reply, including replies without an
// event. Both layers use the original monotonic epoch milliseconds, never UTC.
export function createFlockAdmission({ nowMs }) {
  let watermark = null;
  let consumedRevision = 0;
  let lastLiveMs = -Infinity;
  let lastNow = -Infinity;
  let badClock = false;

  const update = snapshot => {
    if (!exactKeys(snapshot, SNAPSHOT_KEYS) || !int32(snapshot.epoch) ||
        !Number.isInteger(snapshot.revision) || snapshot.revision < 0 || snapshot.revision > INT32_MAX ||
        (snapshot.revision === 0 && (snapshot.epoch !== 1 || snapshot.expiresAtMs !== null || snapshot.closed)) ||
        typeof snapshot.closed !== "boolean" ||
        !(snapshot.expiresAtMs === null || (Number.isFinite(snapshot.expiresAtMs) && snapshot.expiresAtMs > 0)) ||
        (snapshot.closed && snapshot.expiresAtMs !== null)) return;
    if (watermark && (watermark.closed || snapshot.revision <= watermark.revision ||
        snapshot.epoch < watermark.epoch)) return;
    watermark = { ...snapshot };
  };

  return {
    update,
    accept(event) {
      if (!exactKeys(event, event?.kind === "flock-live" ? LIVE_KEYS : MUTE_KEYS) ||
          !["flock-live", "flock-mute"].includes(event.kind) ||
          !int32(event.epoch) || !int32(event.revision)) return false;
      const isLive = event.kind === "flock-live";
      const now = nowMs();
      if (!Number.isFinite(now) || now < 0 || now < lastNow) badClock = true;
      else lastNow = now;
      if (isLive && (badClock || ![event.energy, event.centroid].every(v => bounded(v, 1)) ||
          !Number.isFinite(event.expiresAtMs) || now >= event.expiresAtMs || event.expiresAtMs - now > 500)) return false;
      update({ epoch: event.epoch, revision: event.revision, closed: false,
        expiresAtMs: isLive ? event.expiresAtMs : null });
      if (!watermark || event.epoch !== watermark.epoch || event.revision !== watermark.revision ||
          event.revision <= consumedRevision ||
          (isLive ? watermark.closed || watermark.expiresAtMs !== event.expiresAtMs : watermark.expiresAtMs !== null)) return false;
      if (isLive) {
        if (now - lastLiveMs < 50) return false;
        lastLiveMs = now;
      }
      consumedRevision = event.revision;
      return true;
    },
  };
}
