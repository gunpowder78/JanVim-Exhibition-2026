import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { parseFlatJson } from "./flock-protocol.mjs";

const PROFILE_NAME = "sound-mix-v1.json";
const PROFILE_DIRECTORY = "site-config";
const MAX_PROFILE_BYTES = 4096;
const MIN_GAIN_DB = -24;
const MAX_GAIN_DB = 6;
const PROFILE_KEYS = ["schema", "windGainDb", "instrumentGainDb"];

export const DEFAULT_SITE_MIX = Object.freeze({
  schema: 1,
  windGainDb: 0,
  instrumentGainDb: 0,
});

export const SITE_MIX_PATH =
  "D:/VirtualData/JanVim-Exhibition-Rehearsals/site-config/sound-mix-v1.json";

const invalid = reason => new Error(reason);
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const stateOf = value => ({
  windGainDb: value.windGainDb,
  instrumentGainDb: value.instrumentGainDb,
});
const eventOf = value => ({ kind: "site-mix", ...stateOf(value) });
const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");
const exactKeys = value => value !== null && Object.keys(value).length === PROFILE_KEYS.length &&
  PROFILE_KEYS.every(key => Object.hasOwn(value, key));
const validGain = value => Number.isInteger(value) && value >= MIN_GAIN_DB && value <= MAX_GAIN_DB;
const identityOf = stats => ({ dev: stats.dev, ino: stats.ino, size: stats.size });
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size;

function encodeSiteMix(value) {
  return Buffer.from(
    `{"schema":1,"windGainDb":${value.windGainDb},"instrumentGainDb":${value.instrumentGainDb}}\n`,
    "utf8",
  );
}

export function parseSiteMix(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PROFILE_BYTES ||
      bytes.at(-1) !== 10 || bytes.subarray(0, -1).includes(10) || bytes.includes(13)) {
    throw invalid("site-mix-invalid");
  }
  const value = parseFlatJson(bytes.subarray(0, -1));
  if (!exactKeys(value) || value.schema !== 1 ||
      !validGain(value.windGainDb) || !validGain(value.instrumentGainDb) ||
      !bytes.equals(encodeSiteMix(value))) {
    throw invalid("site-mix-invalid");
  }
  return value;
}

async function inspectDirectory(directory) {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
  if (!stats.isDirectory() || stats.isSymbolicLink() || stats.nlink < 1) {
    throw invalid("site-mix-directory-invalid");
  }
  const resolved = await realpath(directory);
  if (!samePath(resolved, directory)) throw invalid("site-mix-directory-invalid");
  return { exists: true };
}

async function readProfile(profilePath) {
  let pathStats;
  try {
    pathStats = await lstat(profilePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
  if (!pathStats.isFile() || pathStats.isSymbolicLink() || pathStats.nlink !== 1 ||
      pathStats.size === 0 || pathStats.size > MAX_PROFILE_BYTES) {
    throw invalid("site-mix-file-invalid");
  }
  const resolved = await realpath(profilePath);
  if (!samePath(resolved, profilePath)) throw invalid("site-mix-file-invalid");

  const handle = await open(profilePath, "r");
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || !sameIdentity(identityOf(pathStats), identityOf(opened))) {
      throw invalid("site-mix-file-invalid");
    }
    bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw invalid("site-mix-file-invalid");
      offset += bytesRead;
    }
    const finished = await handle.stat();
    if (!sameIdentity(identityOf(opened), identityOf(finished))) {
      throw invalid("site-mix-file-invalid");
    }
  } finally {
    await handle.close();
  }

  const value = parseSiteMix(bytes);
  return {
    exists: true,
    bytes,
    hash: hashOf(bytes),
    identity: identityOf(pathStats),
    value,
  };
}

async function makeDirectory(directory) {
  const inspected = await inspectDirectory(directory);
  if (!inspected.exists) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const verified = await inspectDirectory(directory);
  if (!verified.exists) throw invalid("site-mix-directory-invalid");
}

async function writeAtomically(profilePath, bytes, expected) {
  const directory = path.dirname(profilePath);
  await makeDirectory(directory);

  const current = await readProfile(profilePath);
  if (current.exists !== expected.exists ||
      (current.exists && (!sameIdentity(current.identity, expected.identity) || current.hash !== expected.hash))) {
    throw invalid("site-mix-file-changed");
  }

  const temporaryPath = path.join(
    directory,
    `.sound-mix-${randomBytes(12).toString("hex")}.tmp`,
  );
  let temporaryExists = false;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    temporaryExists = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryStats = await lstat(temporaryPath);
    if (!temporaryStats.isFile() || temporaryStats.isSymbolicLink() ||
        temporaryStats.nlink !== 1 || temporaryStats.size !== bytes.length) {
      throw invalid("site-mix-temp-invalid");
    }

    const beforeInstall = await readProfile(profilePath);
    if (beforeInstall.exists !== expected.exists ||
        (beforeInstall.exists &&
          (!sameIdentity(beforeInstall.identity, expected.identity) || beforeInstall.hash !== expected.hash))) {
      throw invalid("site-mix-file-changed");
    }
    await rename(temporaryPath, profilePath);
    temporaryExists = false;

    const installed = await readProfile(profilePath);
    if (!installed.exists || installed.hash !== hashOf(bytes) || !installed.bytes.equals(bytes)) {
      throw invalid("site-mix-install-invalid");
    }
    return installed;
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch(() => {});
  }
}

function validateProfilePath(profilePath) {
  if (typeof profilePath !== "string" || !path.isAbsolute(profilePath) || /[\0\r\n]/u.test(profilePath) ||
      path.basename(profilePath) !== PROFILE_NAME ||
      path.basename(path.dirname(profilePath)) !== PROFILE_DIRECTORY) {
    throw invalid("site-mix-path-invalid");
  }
}

export async function openSiteMixStore({ profilePath = SITE_MIX_PATH } = {}) {
  validateProfilePath(profilePath);
  let value = { ...DEFAULT_SITE_MIX };
  let profile = { exists: false };
  let persistence = "saved";
  let locked = false;
  let queue = Promise.resolve();

  try {
    const directory = await inspectDirectory(path.dirname(profilePath));
    if (directory.exists) {
      profile = await readProfile(profilePath);
      if (profile.exists) value = { ...profile.value };
    }
  } catch {
    persistence = "save-error";
    locked = true;
    profile = { exists: false };
  }
  let pending = eventOf(value);

  const result = ok => ({ ok, ...(ok ? {} : { reason: "save-failed" }), ...stateOf(value) });
  const performAdjustment = async (target, deltaDb) => {
    if (locked) return result(false);
    const key = target === "wind" ? "windGainDb" : "instrumentGainDb";
    const nextValue = {
      ...value,
      [key]: Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, value[key] + deltaDb)),
    };
    if (nextValue[key] === value[key] && persistence === "saved") return result(true);

    try {
      const bytes = encodeSiteMix(nextValue);
      const installed = await writeAtomically(profilePath, bytes, profile);
      value = nextValue;
      profile = installed;
      persistence = "saved";
      pending = eventOf(value);
      return result(true);
    } catch {
      persistence = "save-error";
      locked = true;
      return result(false);
    }
  };

  return {
    snapshot: () => ({ ...stateOf(value), persistence }),
    adjust(target, deltaDb) {
      if (!["wind", "instrument"].includes(target) || ![-1, 1].includes(deltaDb)) {
        return Promise.reject(invalid("site-mix-adjust-invalid"));
      }
      const operation = queue.then(() => performAdjustment(target, deltaDb));
      queue = operation.catch(() => {});
      return operation;
    },
    take() {
      const event = pending;
      pending = null;
      return event;
    },
    profileHash: () => profile.hash ?? null,
  };
}
