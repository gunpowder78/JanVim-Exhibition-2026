const INT32_MAX = 0x7fffffff;
const RUN_ID = /^[A-Za-z0-9._-]{1,64}$/;
const CONTROLLER_ID = /^[A-Za-z0-9._-]{1,96}$/;
const FRAME_KEYS = ["command", "runId", "controllerRunId", "seq", "elapsedMs", "generationId", "loopId"];
const CURSOR_KEYS = [...FRAME_KEYS, "x", "y", "motion"];
const positiveInt32 = value => Number.isInteger(value) && value > 0 && value <= INT32_MAX;
const bounded = (value, maximum) => Number.isFinite(value) && value >= 0 && value <= maximum;
const id = (value, pattern) => typeof value === "string" && pattern.test(value);
const exactKeys = (value, keys) => value !== null && typeof value === "object" &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Authentication belongs to the control listener. No token or text enters this policy.
// elapsedMs starts at zero after the attach reply, stays monotonic across loops and
// generations, and is relative to this attachment (not the SC or Show run clock).
export function createRealInput({ nowMs, onStop }) {
  let owner = null;
  let originMs;
  let leaseMs;
  let sequence = 0;
  let elapsed = 0;
  let generation = 0;
  let loop = "idle";
  let latest = null;
  let heartbeat = null;
  let lastHeartbeatMs = -Infinity;
  let lastCursorMs = -Infinity;
  let stopped = false;

  const close = (reason = "source-disconnect") => {
    if (stopped) return;
    stopped = true;
    latest = null;
    heartbeat = null;
    onStop(reason);
  };
  const live = now => {
    if (!stopped && owner && now - leaseMs >= 2000) close("producer-timeout");
    return !stopped;
  };

  return {
    attach(identity) {
      if (!live(nowMs()) || owner || !exactKeys(identity, ["runId", "controllerRunId"]) ||
          !id(identity.runId, RUN_ID) || !id(identity.controllerRunId, CONTROLLER_ID)) return false;
      owner = { ...identity };
      originMs = leaseMs = nowMs();
      heartbeat = null;
      return true;
    },
    accept(frame) {
      const now = nowMs();
      if (!live(now) || !owner || !exactKeys(frame, frame?.command === "cursor" ? CURSOR_KEYS : FRAME_KEYS) ||
          !["heartbeat", "cursor"].includes(frame.command) ||
          frame.runId !== owner.runId || frame.controllerRunId !== owner.controllerRunId ||
          !positiveInt32(frame.seq) || frame.seq <= sequence ||
          !positiveInt32(frame.generationId) || frame.generationId < generation ||
          !id(frame.loopId, RUN_ID) || !bounded(frame.elapsedMs, 3600000) || frame.elapsedMs < elapsed) return false;
      const age = now - originMs - frame.elapsedMs;
      if (age < 0 || age > 500) return false;
      if (frame.command === "cursor" && (loop === "idle" || frame.loopId !== loop ||
          frame.generationId !== generation || ![frame.x, frame.y, frame.motion].every(v => bounded(v, 1)))) return false;
      sequence = frame.seq;
      elapsed = frame.elapsedMs;
      const expiresAtMs = originMs + elapsed + 500;
      if (frame.command === "heartbeat") {
        if (frame.generationId !== generation || frame.loopId !== loop) latest = null;
        generation = frame.generationId;
        loop = frame.loopId;
        leaseMs = now;
        heartbeat = { kind: "heartbeat", expiresAtMs };
      } else {
        latest = { kind: "cursor", x: frame.x, y: frame.y, motion: frame.motion, expiresAtMs };
      }
      return true;
    },
    take() {
      const now = nowMs();
      if (!live(now)) return [];
      const events = [];
      if (!owner && now - lastHeartbeatMs >= 250) heartbeat = { kind: "heartbeat", expiresAtMs: now + 500 };
      if (heartbeat && now > heartbeat.expiresAtMs) heartbeat = null;
      if (latest && now > latest.expiresAtMs) latest = null;
      if (heartbeat && now - lastHeartbeatMs >= 250) {
        events.push(heartbeat);
        heartbeat = null;
        lastHeartbeatMs = now;
      }
      if (latest && now - lastCursorMs >= 125) {
        events.push(latest);
        latest = null;
        lastCursorMs = now;
      }
      return events;
    },
    close,
  };
}

// Called immediately before UDP admission, after any IPC/clock waits. The
// supervisor and sender use monotonic epoch milliseconds for these expiries.
export function createRealAdmission({ nowMs }) {
  let lastCursorMs = -Infinity;
  let lastHeartbeatMs = -Infinity;
  return event => {
    const now = nowMs();
    if (!Number.isFinite(event.expiresAtMs) || now > event.expiresAtMs ||
        event.expiresAtMs - now > 500) return false;
    if (event.kind === "heartbeat") {
      if (now - lastHeartbeatMs < 250) return false;
      lastHeartbeatMs = now;
      return true;
    }
    if (event.kind !== "cursor" || now - lastCursorMs < 125 ||
        ![event.x, event.y, event.motion].every(v => bounded(v, 1))) return false;
    lastCursorMs = now;
    return true;
  };
}
