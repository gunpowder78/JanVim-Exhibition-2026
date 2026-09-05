import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { closeSync, openSync, writeSync } from "node:fs";
import dgram from "node:dgram";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { encodeMessage } from "./osc.mjs";

const RUN_FILE = fileURLToPath(import.meta.url);
export const REHEARSAL_PARENT = "D:/VirtualData/JanVim-Exhibition-Rehearsals";

function invalid(message) {
  throw new Error(`invalid arguments: ${message}`);
}

export function parseCli(argv) {
  if (argv.length === 0) {
    return { command: "run", duration: 45, mode: "silent", output: null };
  }

  if (argv[0] === "--stop") {
    if (argv.length !== 2 || !path.isAbsolute(argv[1])) invalid("--stop needs an absolute run root");
    return { command: "stop", runRoot: path.normalize(argv[1]) };
  }

  const values = { duration: "45", mode: "silent", output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!["--duration", "--mode", "--output"].includes(option) || value === undefined) {
      invalid("unknown or missing option");
    }
    if (seen.has(option)) invalid("duplicate option");
    seen.add(option);
    values[option.slice(2)] = value;
  }

  if (!["silent", "listen"].includes(values.mode)) invalid("mode must be silent or listen");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(values.duration)) invalid("duration is malformed");
  const duration = Number(values.duration);
  if (!Number.isFinite(duration) || duration < 1 || duration > 3600) {
    invalid("duration must be from 1 through 3600 seconds");
  }
  if (values.output !== null && !path.isAbsolute(values.output)) {
    invalid("output must be absolute");
  }
  return {
    command: "run",
    duration,
    mode: values.mode,
    output: values.output === null ? null : path.normalize(values.output),
  };
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function prepareRunRoot(requested) {
  const parent = path.resolve(REHEARSAL_PARENT);
  await mkdir(parent, { recursive: true });
  const parentReal = await realpath(parent);
  const generated = `sound-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomBytes(6).toString("hex")}`;
  const candidate = requested === null ? path.join(parent, generated) : path.resolve(requested);
  if (!path.isAbsolute(candidate) || !isWithin(parent, candidate)) {
    throw new Error("output must be below the external rehearsal parent");
  }

  const candidateParent = await realpath(path.dirname(candidate));
  if (!isWithin(parentReal, candidateParent) && candidateParent !== parentReal) {
    throw new Error("output must be below the external rehearsal parent");
  }
  try {
    await lstat(candidate);
    throw new Error("output must be a fresh path; it already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await mkdir(candidate);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error("output must be fresh; it already exists", { cause: error });
    }
    throw error;
  }
  return path.normalize(candidate);
}

const formula = (index, multiplier, offset = 0) =>
  Number((((index * multiplier + offset) % 101) / 100).toFixed(2));

export function createTimeline(duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError("duration must be positive");
  let lastCueIndex = 0;

  return {
    due(elapsed) {
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= duration) return [];
      const cueIndex = Math.floor(elapsed / 0.25 + 1e-9);
      if (cueIndex <= 0 || cueIndex <= lastCueIndex) return [];
      lastCueIndex = cueIndex;
      const events = [{ kind: "heartbeat" }];
      const phase = elapsed < duration / 3 ? 0 : elapsed < (duration * 2) / 3 ? 1 : 2;
      if (phase === 0 || phase === 2) {
        events.push({
          kind: "cursor",
          motion: formula(cueIndex, 29, 31),
          x: formula(cueIndex, 37),
          y: formula(cueIndex, 53, 17),
        });
      }
      if (phase === 1 || phase === 2) {
        events.push({
          centroid: formula(cueIndex, 43, 7),
          energy: formula(cueIndex, 47, 11),
          kind: "flock",
        });
      }
      return events;
    },
  };
}

function validReceipt(receipt) {
  return (
    receipt !== null &&
    typeof receipt === "object" &&
    receipt.version === 1 &&
    receipt.active === true &&
    receipt.host === "127.0.0.1" &&
    Number.isInteger(receipt.port) &&
    receipt.port > 0 &&
    receipt.port <= 65535 &&
    typeof receipt.token === "string" &&
    /^[0-9a-f]{64}$/.test(receipt.token) &&
    typeof receipt.runRoot === "string" &&
    path.isAbsolute(receipt.runRoot)
  );
}

function tokensEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export async function startControlServer(runRoot, onStop) {
  const token = randomBytes(32).toString("hex");
  const sockets = new Set();
  let accepted = false;
  let receipt;

  const server = net.createServer((socket) => {
    if (sockets.size >= 8 || accepted) {
      socket.end('{"ok":false}\n');
      return;
    }
    sockets.add(socket);
    socket.setTimeout(1000, () => socket.destroy());
    let input = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      if (input.length + chunk.length > 512) {
        socket.end('{"ok":false}\n');
        return;
      }
      input = Buffer.concat([input, chunk], input.length + chunk.length);
      const newline = input.indexOf(10);
      if (newline < 0) return;
      let message;
      let exact = newline === input.length - 1;
      try {
        message = JSON.parse(input.subarray(0, newline).toString("utf8"));
      } catch {
        exact = false;
      }
      const keys = message && typeof message === "object" ? Object.keys(message).sort() : [];
      exact =
        exact &&
        keys.length === 2 &&
        keys[0] === "command" &&
        keys[1] === "token" &&
        message.command === "stop" &&
        tokensEqual(message.token, token);
      if (!exact || accepted) {
        socket.end('{"ok":false}\n');
        return;
      }
      accepted = true;
      receipt = { ...receipt, active: false };
      void writeFile(path.join(runRoot, "control.json"), `${JSON.stringify(receipt)}\n`, {
        encoding: "utf8",
        flag: "w",
      });
      onStop();
      socket.end('{"ok":true}\n');
      server.close();
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  receipt = {
    active: true,
    host: "127.0.0.1",
    port: address.port,
    runRoot: path.normalize(runRoot),
    token,
    version: 1,
  };
  await writeFile(path.join(runRoot, "control.json"), `${JSON.stringify(receipt)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });

  return {
    receipt,
    async close() {
      for (const socket of sockets) socket.destroy();
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export function sendControlRequest(receipt) {
  if (!validReceipt(receipt)) return Promise.reject(new Error("invalid control receipt"));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: receipt.host, port: receipt.port });
    let response = "";
    const timer = setTimeout(() => socket.destroy(new Error("control request timed out")), 1500);
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.end(`${JSON.stringify({ command: "stop", token: receipt.token })}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk;
      if (response.length > 64) socket.destroy(new Error("invalid control response"));
    });
    socket.on("end", () => {
      clearTimeout(timer);
      if (response === '{"ok":true}\n') resolve(true);
      else if (response === '{"ok":false}\n') resolve(false);
      else reject(new Error("invalid control response"));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function requestStop(runRoot) {
  const normalized = path.normalize(runRoot);
  const receiptPath = path.join(normalized, "control.json");
  const details = await stat(receiptPath);
  if (!details.isFile() || details.size > 4096) throw new Error("invalid control receipt");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  if (!validReceipt(receipt) || path.normalize(receipt.runRoot) !== normalized) {
    throw new Error("invalid control receipt");
  }
  return sendControlRequest(receipt);
}

function boundedLog(filePath, maximumBytes) {
  const descriptor = openSync(filePath, "wx");
  let written = 0;
  return {
    write(chunk) {
      const accepted = Math.min(chunk.length, Math.max(0, maximumBytes - written));
      if (accepted > 0) {
        writeSync(descriptor, chunk, 0, accepted);
        written += accepted;
      }
    },
    close() {
      closeSync(descriptor);
    },
  };
}

async function killCreatedTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return;
  }
  await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (killer.exitCode === null) killer.kill();
      resolve();
    }, 1500);
    killer.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    killer.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

export async function spawnManagedChild({
  args,
  cwd,
  env = process.env,
  executable,
  ipc = false,
  maxLineBytes = 8192,
  maxLogBytes = 1024 * 1024,
  maxStreamBytes = 2 * 1024 * 1024,
  onStderrLine = () => {},
  onStdoutLine = () => {},
  stderrPath,
  stdoutPath,
  timeoutMs,
}) {
  const stdoutLog = boundedLog(stdoutPath, maxLogBytes);
  const stderrLog = boundedLog(stderrPath, maxLogBytes);
  const child = spawn(executable, args, {
    cwd,
    env,
    shell: false,
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const processExit = new Promise((resolve) => {
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  });

  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    stdoutLog.close();
    stderrLog.close();
    throw error;
  }

  let settled = false;
  let limitReason = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let terminating = null;
  const pending = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };

  const terminate = () => {
    if (!terminating) terminating = killCreatedTree(child);
    return terminating;
  };
  const setLimit = (reason) => {
    if (limitReason === null) {
      limitReason = reason;
      void terminate();
    }
  };

  function consume(name, chunk, callback, log) {
    log.write(chunk);
    if (name === "stdout") stdoutBytes += chunk.length;
    else stderrBytes += chunk.length;

    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const segmentLength = end - offset;
      if (pending[name].length + segmentLength > maxLineBytes) {
        setLimit(`${name}Line`);
        return;
      }
      if (segmentLength > 0) {
        pending[name] = Buffer.concat(
          [pending[name], chunk.subarray(offset, end)],
          pending[name].length + segmentLength,
        );
      }
      if (newline < 0) break;
      const line = pending[name].toString("utf8").replace(/\r$/, "");
      pending[name] = Buffer.alloc(0);
      try {
        callback(line, performance.now());
      } catch {
        setLimit(`${name}Callback`);
        return;
      }
      offset = newline + 1;
    }
    const total = name === "stdout" ? stdoutBytes : stderrBytes;
    if (total > maxStreamBytes) setLimit(`${name}Stream`);
  }

  child.stdout.on("data", (chunk) => consume("stdout", chunk, onStdoutLine, stdoutLog));
  child.stderr.on("data", (chunk) => consume("stderr", chunk, onStderrLine, stderrLog));
  const timeout = setTimeout(() => setLimit("timeout"), timeoutMs);

  const completion = new Promise((resolve) => {
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const [name, callback] of [
        ["stdout", onStdoutLine],
        ["stderr", onStderrLine],
      ]) {
        if (pending[name].length > 0 && limitReason === null) {
          try {
            callback(pending[name].toString("utf8").replace(/\r$/, ""), performance.now());
          } catch {
            limitReason = `${name}Callback`;
          }
        }
      }
      stdoutLog.close();
      stderrLog.close();
      resolve({ exitCode, limitReason, signal, stderrBytes, stdoutBytes });
    });
  });

  return { child, completion, processExit, terminate };
}

const LANGUAGE_PORT = 57140;
const SERVER_PORT = 57141;
const SCLANG = "C:/Program Files/SuperCollider-3.14.1/sclang.exe";
const CLASS_LIBRARY = "C:/Program Files/SuperCollider-3.14.1/SCClassLibrary";
const MAX_EVENT_LOG_BYTES = 4 * 1024 * 1024;
const MAX_RESOURCE_LOG_BYTES = 2 * 1024 * 1024;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function withTimeout(promise, timeoutMs, error) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(error), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sendIpc(channel, message) {
  if (!channel?.connected || typeof channel.send !== "function") return false;
  try {
    channel.send(message, () => {});
    return true;
  } catch {
    return false;
  }
}

class SupervisorError extends Error {
  constructor(reason, message, options) {
    super(message, options);
    this.reason = reason;
  }
}

function jsonLog(filePath, maximumBytes) {
  const output = boundedLog(filePath, maximumBytes);
  let bytes = 0;
  let truncated = false;
  return {
    write(value) {
      const line = Buffer.from(`${JSON.stringify(value)}\n`);
      if (bytes + line.length > maximumBytes) {
        truncated = true;
        return false;
      }
      output.write(line);
      bytes += line.length;
      return true;
    },
    close() {
      output.close();
      return { bytes, truncated };
    },
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertLanguagePortAvailable() {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
  try {
    await new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind({ address: "127.0.0.1", exclusive: true, port: LANGUAGE_PORT }, resolve);
    });
  } catch (error) {
    throw new SupervisorError(
      "languagePortOccupied",
      `UDP port ${LANGUAGE_PORT} is occupied; the occupant was not changed`,
      { cause: error },
    );
  } finally {
    socket.close();
  }
}

function runBoundedCommand(executable, args, timeoutMs = 3000, maximumBytes = 65536) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = { stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) };
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    for (const name of ["stdout", "stderr"]) {
      child[name].on("data", (chunk) => {
        if (output[name].length + chunk.length > maximumBytes) {
          void killCreatedTree(child);
          finish(new Error(`${path.basename(executable)} ${name} exceeded its bound`));
          return;
        }
        output[name] = Buffer.concat([output[name], chunk], output[name].length + chunk.length);
      });
    }
    child.once("error", (error) => finish(error));
    child.once("close", (exitCode) => {
      finish(null, {
        exitCode,
        stderr: output.stderr.toString("utf8"),
        stdout: output.stdout.toString("utf8"),
      });
    });
    const timer = setTimeout(() => {
      void killCreatedTree(child);
      finish(new Error(`${path.basename(executable)} timed out`));
    }, timeoutMs);
  });
}

const psQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function runPowerShellJson(script, timeoutMs = 3000) {
  const result = await runBoundedCommand(
    "pwsh.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    timeoutMs,
  );
  if (result.exitCode !== 0) {
    throw new Error(`bounded process inspection failed (${result.exitCode}): ${result.stderr.trim()}`);
  }
  const output = result.stdout.trim();
  return output === "" ? null : JSON.parse(output);
}

async function inspectReadyProcesses(languagePid, readyServerPid) {
  const result = await runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    function Identity([int]$id) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
      if ($null -eq $p) { return $null }
      [pscustomobject]@{
        pid = [int]$p.ProcessId
        parentPid = [int]$p.ParentProcessId
        started = $p.CreationDate.ToUniversalTime().ToString('o')
        executable = $p.ExecutablePath
      }
    }
    $endpoints = @(Get-NetUDPEndpoint -LocalPort ${SERVER_PORT} |
      Where-Object LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::'))
    $owners = @($endpoints.OwningProcess | Sort-Object -Unique)
    if ($owners.Count -ne 1) { throw 'private endpoint does not have one owner' }
    $ancestry = @()
    $cursor = [int]$owners[0]
    for ($depth = 0; $depth -lt 32 -and $cursor -gt 0; $depth += 1) {
      $identity = Identity $cursor
      if ($null -eq $identity) { break }
      $ancestry += $identity
      $cursor = $identity.parentPid
    }
    [pscustomobject]@{
      owner = $ancestry[0]
      ancestry = $ancestry
      ready = Identity ${readyServerPid}
      language = Identity ${languagePid}
    } | ConvertTo-Json -Depth 6 -Compress
  `, 5000);

  if (!result.owner || !result.ready || !result.language) {
    throw new Error("service process inspection returned an incomplete identity");
  }
  const ancestry = Array.isArray(result.ancestry) ? result.ancestry : [result.ancestry];
  if (
    result.language.pid !== languagePid ||
    result.ready.pid !== readyServerPid ||
    !ancestry.some((identity) => identity.pid === readyServerPid) ||
    !ancestry.some((identity) => identity.pid === languagePid) ||
    path.basename(result.owner.executable ?? "").toLowerCase() !== "scsynth.exe"
  ) {
    throw new Error("private endpoint ancestry does not match the newly launched service tree");
  }
  return { ancestry, language: result.language, owner: result.owner, ready: result.ready };
}

async function inspectProcess(pid) {
  return runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"
    if ($null -eq $p) { throw 'process is not live' }
    [pscustomobject]@{
      pid = [int]$p.ProcessId
      parentPid = [int]$p.ParentProcessId
      started = $p.CreationDate.ToUniversalTime().ToString('o')
      executable = $p.ExecutablePath
    } | ConvertTo-Json -Compress
  `);
}

async function reclaimPinnedProcess(identity) {
  const result = await runPowerShellJson(`
    $ErrorActionPreference = 'Stop'
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = ${identity.pid}"
    if ($null -eq $p) {
      [pscustomobject]@{ status = 'missing' } | ConvertTo-Json -Compress
      exit 0
    }
    $started = $p.CreationDate.ToUniversalTime().ToString('o')
    if ($started -ne ${psQuote(identity.started)} -or
        $p.ExecutablePath -ne ${psQuote(identity.executable)} -or
        [int]$p.ParentProcessId -ne ${identity.parentPid}) {
      throw 'pinned process identity changed; refusing termination'
    }
    Stop-Process -Id ${identity.pid} -Force
    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
      if ($null -eq (Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 50
    }
    if ($null -ne (Get-Process -Id ${identity.pid} -ErrorAction SilentlyContinue)) {
      throw 'pinned process did not stop inside the bound'
    }
    [pscustomobject]@{ status = 'killed' } | ConvertTo-Json -Compress
  `, 4000);
  return result.status;
}

async function workingSets(roles) {
  if (roles.length === 0) return [];
  const ids = roles.map(({ pid }) => pid).join(",");
  const values = await runPowerShellJson(`
    $items = foreach ($id in @(${ids})) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($null -ne $p) {
        [pscustomobject]@{ pid = [int]$p.Id; workingSet = [long]$p.WorkingSet64 }
      }
    }
    @($items) | ConvertTo-Json -Compress
  `);
  const list = values === null ? [] : Array.isArray(values) ? values : [values];
  return roles.flatMap((role) => {
    const value = list.find((candidate) => candidate.pid === role.pid);
    return value ? [{ ...role, workingSet: value.workingSet }] : [];
  });
}

async function sendUdp(socket, packet) {
  await new Promise((resolve, reject) => {
    socket.send(packet, SERVER_PORT - 1, "127.0.0.1", (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

async function finishInternalSender(message) {
  if (process.send && process.connected) {
    await new Promise((resolve) => {
      try {
        process.send(message, () => resolve());
      } catch {
        resolve();
      }
    });
    if (process.connected) process.disconnect();
  }
}

async function runInternalSender() {
  if (!process.send) throw new Error("internal sender requires an IPC parent");
  let startAcknowledged = false;
  let stopAcknowledged = false;
  let stopRequested = false;
  let clockRequestId = 0;
  const clockReplies = new Map();
  let initialize;
  const initialized = new Promise((resolve) => {
    initialize = resolve;
  });
  process.on("message", (message) => {
    if (message?.type === "initialize") initialize(message);
    else if (message?.type === "ackStart") startAcknowledged = true;
    else if (message?.type === "ackStop") stopAcknowledged = true;
    else if (message?.type === "stop") stopRequested = true;
    else if (message?.type === "clock") {
      const resolve = clockReplies.get(message.requestId);
      if (resolve) {
        clockReplies.delete(message.requestId);
        resolve(message.value);
      }
    }
  });
  const config = await withTimeout(initialized, 5000, new Error("sender init timed out"));
  const socket = dgram.createSocket("udp4");
  let sequence = 0;
  let stopping = false;

  const requestTimestamp = () =>
    new Promise((resolve, reject) => {
      const requestId = ++clockRequestId;
      const timeout = setTimeout(() => {
        clockReplies.delete(requestId);
        reject(new Error("supervisor clock request timed out"));
      }, 1000);
      clockReplies.set(requestId, (value) => {
        clearTimeout(timeout);
        resolve(value);
      });
      try {
        process.send({ requestId, type: "clock" }, (error) => {
          if (!error) return;
          clearTimeout(timeout);
          clockReplies.delete(requestId);
          reject(error);
        });
      } catch (error) {
        clearTimeout(timeout);
        clockReplies.delete(requestId);
        reject(error);
      }
    });
  const packetFor = async (event) => {
    const sentAt = await requestTimestamp();
    const common = [
      { type: "s", value: config.session },
      { type: "i", value: ++sequence },
      { type: "d", value: sentAt },
    ];
    let packet;
    if (event.kind === "start") packet = encodeMessage("/janvim/sound/v1/start", common);
    else if (event.kind === "heartbeat") {
      packet = encodeMessage("/janvim/sound/v1/heartbeat", common);
    }
    if (event.kind === "cursor") {
      packet = encodeMessage("/janvim/sound/v1/cursor", [
        ...common,
        { type: "f", value: event.x },
        { type: "f", value: event.y },
        { type: "f", value: event.motion },
      ]);
    }
    if (event.kind === "flock") {
      packet = encodeMessage("/janvim/sound/v1/flock", [
        ...common,
        { type: "f", value: event.energy },
        { type: "f", value: event.centroid },
      ]);
    }
    if (event.kind === "stop") packet = encodeMessage("/janvim/sound/v1/stop", common);
    return { packet, sentAt, seq: sequence };
  };

  const report = (value) => {
    sendIpc(process, value);
  };
  const sendEvent = async (event) => {
    const encoded = await packetFor(event);
    await sendUdp(socket, encoded.packet);
    return encoded;
  };
  const finishStop = async (trigger) => {
    if (stopping) return;
    stopping = true;
    let attempts = 0;
    const firstAttempt = performance.now();
    while (attempts < 3 && !stopAcknowledged) {
      attempts += 1;
      const sent = await sendEvent({ kind: "stop" });
      report({ kind: "stop", sentAt: sent.sentAt, seq: sent.seq, type: "packet" });
      if (stopAcknowledged || attempts === 3) break;
      await delay(100);
    }
    const attemptWindowMilliseconds = performance.now() - firstAttempt;
    socket.close();
    await finishInternalSender({
      attemptWindowMilliseconds,
      attempts,
      trigger,
      type: "finished",
    });
    return 0;
  };

  const start = await sendEvent({ kind: "start" });
  report({ kind: "start", sentAt: start.sentAt, seq: start.seq, type: "packet" });
  const ackDeadline = performance.now() + 2000;
  while (!startAcknowledged && performance.now() < ackDeadline) await delay(10);
  if (!startAcknowledged) {
    socket.close();
    await finishInternalSender({ reason: "startAckTimeout", type: "failed" });
    return 2;
  }

  const timeline = createTimeline(config.duration);
  const timelineStart = performance.now();
  while (!stopping) {
    const elapsed = (performance.now() - timelineStart) / 1000;
    if (stopRequested || elapsed >= config.duration) {
      return finishStop(stopRequested ? "requested" : "duration");
    }
    const events = timeline.due(elapsed);
    const kinds = [];
    for (const event of events) {
      await sendEvent(event);
      kinds.push(event.kind);
    }
    if (kinds.length > 0) {
      report({ elapsed, kinds, seq: sequence, type: "cue" });
    }
    const nextBoundary = (Math.floor(elapsed / 0.25) + 1) * 0.25;
    await delay(Math.max(1, Math.min(250, (nextBoundary - elapsed) * 1000)));
  }
}

function parseServiceRecord(line) {
  const match = /^(SOUND_READY|SOUND_EVENT|SOUND_STATS|SOUND_COMPLETE) (\{.*\})$/.exec(line);
  if (!match) return null;
  return { body: JSON.parse(match[2]), type: match[1] };
}

async function runSupervisor(options) {
  const runRoot = await prepareRunRoot(options.output);
  const startedPerformance = performance.now();
  const events = jsonLog(path.join(runRoot, "events.ndjson"), MAX_EVENT_LOG_BYTES);
  const resources = jsonLog(path.join(runRoot, "resources.ndjson"), MAX_RESOURCE_LOG_BYTES);
  let control;
  let service;
  let sender;
  let pinned;
  let latestStats = null;
  let serviceComplete = null;
  let readyRecord = null;
  let receiverAnchor = null;
  let senderFinished = false;
  let senderUnexpected = false;
  let stopRequested = false;
  let resourceTimer;
  let resourceSamplePromise = null;
  let senderFallbackTimer;
  let orphanReclaimed = false;
  const resourceAggregate = { maxLivePlucks: 0, maxPlucks: 0, maxWorkingSet: {}, samples: 0 };
  const captureEnabled = options.mode === "silent" && options.duration + 5 <= 118.5;
  const capturePath = captureEnabled ? path.join(runRoot, "capture.wav") : "";
  const serviceDuration = Math.min(3600, options.duration + 5);
  let summary = null;

  const record = (source, type, body, atPerformance = performance.now()) => {
    events.write({
      elapsedSeconds: (atPerformance - startedPerformance) / 1000,
      source,
      type,
      ...(body === undefined ? {} : { body }),
    });
  };
  const requestRunStop = (source) => {
    if (stopRequested) return;
    stopRequested = true;
    record("supervisor", "stopRequested", { source });
    sendIpc(sender?.child, { type: "stop" });
  };
  const signalHandler = () => requestRunStop("signal");
  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  try {
    control = await startControlServer(runRoot, () => requestRunStop("control"));
    await assertLanguagePortAvailable();

    let resolveReady;
    const readyPromise = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const serviceArgs = [
      "-a",
      "-l",
      path.join(path.dirname(RUN_FILE), "sclang-conf.yaml"),
      "--include-path",
      CLASS_LIBRARY,
      "--include-path",
      path.join(path.dirname(RUN_FILE), "sclang-isolation"),
      "-u",
      String(LANGUAGE_PORT),
      path.join(path.dirname(RUN_FILE), "service.scd"),
      randomBytes(16).toString("hex"),
      options.mode,
      String(serviceDuration),
      capturePath,
    ];
    const session = serviceArgs.at(-4);
    service = await spawnManagedChild({
      args: serviceArgs,
      cwd: path.dirname(RUN_FILE),
      executable: SCLANG,
      maxLineBytes: 8192,
      maxLogBytes: 1024 * 1024,
      maxStreamBytes: 2 * 1024 * 1024,
      onStderrLine: (line, receivedAt) => record("sclang-stderr", "line", line, receivedAt),
      onStdoutLine: (line, receivedAt) => {
        const structured = parseServiceRecord(line);
        if (!structured) return;
        if (structured.type === "SOUND_READY" && receiverAnchor === null) {
          receiverAnchor = {
            clock: structured.body.clock,
            epochMilliseconds: performance.timeOrigin + receivedAt,
            performanceMilliseconds: receivedAt,
          };
          readyRecord = structured.body;
          resolveReady(structured.body);
        }
        if (structured.type === "SOUND_EVENT") {
          if (structured.body.type === "start") {
            sendIpc(sender?.child, { type: "ackStart" });
          }
          if (structured.body.type === "stop") {
            sendIpc(sender?.child, { type: "ackStop" });
          }
        } else if (structured.type === "SOUND_STATS") {
          latestStats = structured.body;
          resourceAggregate.maxLivePlucks = Math.max(
            resourceAggregate.maxLivePlucks,
            structured.body.livePlucks ?? 0,
          );
          resourceAggregate.maxPlucks = Math.max(
            resourceAggregate.maxPlucks,
            structured.body.maxPlucks ?? 0,
          );
        } else if (structured.type === "SOUND_COMPLETE") {
          serviceComplete = structured.body;
        }
        record("service", structured.type, structured.body, receivedAt);
      },
      stderrPath: path.join(runRoot, "sclang.stderr.log"),
      stdoutPath: path.join(runRoot, "sclang.stdout.log"),
      timeoutMs: Math.ceil((serviceDuration + 45) * 1000),
    });

    await withTimeout(
      Promise.race([
        readyPromise,
        service.processExit.then((result) => {
          throw new SupervisorError(
            "serviceExitBeforeReady",
            `sclang exited before READY (${JSON.stringify(result)})`,
          );
        }),
      ]),
      35000,
      new SupervisorError("serviceReadyTimeout", "service did not emit READY in 35 seconds"),
    );
    if (
      readyRecord.languagePort !== LANGUAGE_PORT ||
      readyRecord.serverPort !== SERVER_PORT ||
      readyRecord.session !== session ||
      readyRecord.hardwareOutput !== (options.mode === "listen") ||
      !Number.isFinite(readyRecord.clock) ||
      !Number.isInteger(readyRecord.serverPid)
    ) {
      throw new SupervisorError("invalidReady", "service READY fields did not match the invocation");
    }

    pinned = await inspectReadyProcesses(service.child.pid, readyRecord.serverPid);
    const inspectionCompletedEpochMilliseconds = performance.timeOrigin + performance.now();
    sender = await spawnManagedChild({
      args: [RUN_FILE, "--internal-sender"],
      cwd: path.dirname(RUN_FILE),
      executable: process.execPath,
      ipc: true,
      maxLineBytes: 2048,
      maxLogBytes: 65536,
      maxStreamBytes: 131072,
      stderrPath: path.join(runRoot, "sender.stderr.log"),
      stdoutPath: path.join(runRoot, "sender.stdout.log"),
      timeoutMs: Math.ceil((options.duration + 10) * 1000),
    });
    const senderIdentity = await inspectProcess(sender.child.pid);
    if (senderIdentity.parentPid !== process.pid) {
      throw new SupervisorError("senderIdentity", "sender is not the supervisor's direct child");
    }
    sender.child.on("message", (message) => {
      if (message.type === "clock") {
        const value =
          receiverAnchor.clock +
          (performance.now() - receiverAnchor.performanceMilliseconds) / 1000;
        sendIpc(sender.child, { requestId: message.requestId, type: "clock", value });
        return;
      }
      record("sender", message.type, message);
      if (message.type === "finished") senderFinished = true;
    });
    sendIpc(sender.child, {
      duration: options.duration === 3600 ? 3599.75 : options.duration,
      session,
      type: "initialize",
    });
    const senderCompletion = sender.completion.then((result) => {
      if (!senderFinished) {
        senderUnexpected = true;
        record("supervisor", "senderExit", result);
        senderFallbackTimer = setTimeout(() => {
          if (service?.child.exitCode === null) void service.terminate();
        }, 12000);
        senderFallbackTimer.unref();
      }
      return result;
    });

    const readyFile = {
      capturePath: capturePath || null,
      duration: options.duration,
      language: pinned.language,
      mode: options.mode,
      nodeExecutable: process.execPath,
      nodePid: process.pid,
      receiver: {
        ...receiverAnchor,
        capturedBeforeInspection:
          receiverAnchor.epochMilliseconds <= inspectionCompletedEpochMilliseconds,
        inspectionCompletedEpochMilliseconds,
      },
      runRoot,
      sender: senderIdentity,
      server: { ancestry: pinned.ancestry, owner: pinned.owner, ready: pinned.ready },
      service: readyRecord,
      session,
      version: 1,
    };
    await writeJson(path.join(runRoot, "ready.json"), readyFile);
    process.stdout.write(
      `SOUND_RUN_READY ${JSON.stringify({
        runRoot,
        nodePid: process.pid,
        senderPid: sender.child.pid,
        sclangPid: service.child.pid,
        serverPid: pinned.owner.pid,
      })}\n`,
    );
    if (stopRequested) sendIpc(sender.child, { type: "stop" });

    const roles = [
      { pid: service.child.pid, role: "sclang" },
      { pid: sender.child.pid, role: "sender" },
      { pid: pinned.owner.pid, role: "scsynth" },
    ];
    const sampleResources = () => {
      if (resourceSamplePromise) return resourceSamplePromise;
      resourceSamplePromise = (async () => {
        try {
          const children = await workingSets(roles);
          const supervisorWorkingSet = process.memoryUsage().rss;
          const sample = {
            children,
            elapsedSeconds: (performance.now() - startedPerformance) / 1000,
            nodes: latestStats
              ? { livePlucks: latestStats.livePlucks, maxPlucks: latestStats.maxPlucks }
              : null,
            supervisorWorkingSet,
          };
          resources.write(sample);
          resourceAggregate.samples += 1;
          resourceAggregate.maxLivePlucks = Math.max(
            resourceAggregate.maxLivePlucks,
            latestStats?.livePlucks ?? 0,
          );
          resourceAggregate.maxPlucks = Math.max(
            resourceAggregate.maxPlucks,
            latestStats?.maxPlucks ?? 0,
          );
          resourceAggregate.maxWorkingSet.supervisor = Math.max(
            resourceAggregate.maxWorkingSet.supervisor ?? 0,
            supervisorWorkingSet,
          );
          for (const child of children) {
            resourceAggregate.maxWorkingSet[child.role] = Math.max(
              resourceAggregate.maxWorkingSet[child.role] ?? 0,
              child.workingSet,
            );
          }
        } catch (error) {
          record("supervisor", "resourceSampleError", error.message);
        } finally {
          resourceSamplePromise = null;
        }
      })();
      return resourceSamplePromise;
    };
    await sampleResources();
    resourceTimer = setInterval(() => void sampleResources(), 5000);

    await service.processExit;
    clearInterval(resourceTimer);
    if (resourceSamplePromise) await resourceSamplePromise;
    await sender.terminate();
    await senderCompletion;
    clearTimeout(senderFallbackTimer);

    if (serviceComplete === null) {
      await delay(3600);
      orphanReclaimed = (await reclaimPinnedProcess(pinned.owner)) === "killed";
    } else {
      const endpointStatus = await reclaimPinnedProcess(pinned.owner);
      if (endpointStatus === "killed") {
        orphanReclaimed = true;
        serviceComplete = { ...serviceComplete, clean: false };
      }
    }
    const serviceResult = await service.completion;

    const reason = serviceComplete === null ? "languageExit" : senderUnexpected ? "senderExit" : serviceComplete.reason;
    const clean =
      serviceComplete !== null &&
      serviceComplete.clean === true &&
      serviceResult.exitCode === 0 &&
      !senderUnexpected;
    summary = {
      actualDurationSeconds: (performance.now() - startedPerformance) / 1000,
      capturePath: capturePath || null,
      clean,
      mode: options.mode,
      orphanReclaimed,
      reason,
      resource: resourceAggregate,
      runRoot,
      serviceReason: serviceComplete?.reason ?? null,
      version: 1,
    };
  } catch (error) {
    if (resourceTimer) clearInterval(resourceTimer);
    clearTimeout(senderFallbackTimer);
    if (sender) await sender.terminate();
    if (service) await service.terminate();
    summary = {
      actualDurationSeconds: (performance.now() - startedPerformance) / 1000,
      capturePath: capturePath || null,
      clean: false,
      mode: options.mode,
      orphanReclaimed,
      reason: error.reason ?? "supervisorFailure",
      resource: resourceAggregate,
      runRoot,
      serviceReason: serviceComplete?.reason ?? null,
      version: 1,
    };
    record("supervisor", "failure", { message: error.message, reason: summary.reason });
  } finally {
    if (resourceTimer) clearInterval(resourceTimer);
    if (resourceSamplePromise) await resourceSamplePromise;
    clearTimeout(senderFallbackTimer);
    process.removeListener("SIGINT", signalHandler);
    process.removeListener("SIGTERM", signalHandler);
    if (control) {
      await control.close();
      await writeJson(path.join(runRoot, "control.json"), {
        ...control.receipt,
        active: false,
      });
    }
    const eventState = events.close();
    const resourceState = resources.close();
    summary.logs = { events: eventState, resources: resourceState };
    await writeJson(path.join(runRoot, "summary.json"), summary);
  }

  process.stdout.write(`SOUND_RUN_COMPLETE ${JSON.stringify(summary)}\n`);
  return summary.clean ? 0 : 1;
}

async function main() {
  if (process.argv[2] === "--internal-sender") {
    return runInternalSender();
  }
  const command = parseCli(process.argv.slice(2));
  if (command.command === "stop") {
    const stopped = await requestStop(command.runRoot);
    process.stdout.write(`${stopped ? "STOP_REQUESTED" : "STOP_REJECTED"}\n`);
    return stopped ? 0 : 1;
  }
  return runSupervisor(command);
}

if (process.argv[1] && path.resolve(process.argv[1]) === RUN_FILE) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`sound supervisor: ${error.message}\n`);
      process.exitCode = 1;
    });
}
