import { lstat, open, realpath } from "node:fs/promises";
import { Socket } from "node:net";
import { win32 } from "node:path";
import { z } from "zod";

import type { AgentCursorObservation } from "@janvim-exhibition/show-schema";
import type { AgentCursorTiming } from "./bridge-server.js";
import { G2_REHEARSAL_PARENT } from "./g2-command.js";
import type { OneLoopTimerAdapter, OneLoopTimerHandle } from "./one-loop-driver.js";

export interface ShowSoundClient {
  start(): void;
  beginLoop(generationId: number, loopId: string): void;
  observe(event: AgentCursorObservation, timing?: AgentCursorTiming): void;
  reset(): void;
  stop(reason: string): void;
}

export interface ShowSoundClientOptions {
  soundRunRoot?: string;
  runId: string;
  controllerRunId: string;
  nowMonotonic?: () => number;
  timers?: OneLoopTimerAdapter;
  createSocket?: () => Socket;
  diagnostic?: (reason: string) => void;
}

const INT32_MAX = 2_147_483_647;
const ID = /^[A-Za-z0-9._-]{1,64}$/;
const receiptSchema = z.object({
  active: z.literal(true), host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65_535),
  runRoot: z.string(), token: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.literal(1), input: z.literal("real-cursor"),
}).strict();

function samePath(left: string, right: string): boolean {
  return win32.resolve(left).toLowerCase() === win32.resolve(right).toLowerCase();
}

async function readReceipt(root: string): Promise<z.infer<typeof receiptSchema>> {
  if (!win32.isAbsolute(root) || /["\r\n\0]/.test(root) ||
      !samePath(win32.dirname(win32.resolve(root)), G2_REHEARSAL_PARENT)) {
    throw new Error("sound-root-invalid");
  }
  const canonical = await realpath(root);
  if (!samePath(canonical, root)) throw new Error("sound-root-escape");
  const path = win32.join(canonical, "control.json");
  if (!samePath(await realpath(path), path)) throw new Error("sound-receipt-escape");
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.nlink !== 1 || details.size > 4096) {
    throw new Error("sound-receipt-invalid");
  }
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.size > 4096 || opened.ino !== details.ino ||
        opened.dev !== details.dev || !samePath(await realpath(path), path)) {
      throw new Error("sound-receipt-changed");
    }
    // A growing or replaced receipt cannot cause an unbounded read/allocation.
    const bytes = Buffer.alloc(4096);
    let length = 0;
    while (length < opened.size) {
      const { bytesRead } = await file.read(bytes, length, opened.size - length, length);
      if (bytesRead === 0) throw new Error("sound-receipt-short-read");
      length += bytesRead;
    }
    if ((await file.stat()).size !== length) throw new Error("sound-receipt-changed");
    const receipt = receiptSchema.parse(JSON.parse(bytes.subarray(0, length).toString("utf8")));
    if (!win32.isAbsolute(receipt.runRoot) || !samePath(receipt.runRoot, canonical)) {
      throw new Error("sound-receipt-root-mismatch");
    }
    return receipt;
  } finally {
    await file.close();
  }
}

const realTimers: OneLoopTimerAdapter = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (callback, delay) => setInterval(callback, delay),
  clearInterval: handle => clearInterval(handle as NodeJS.Timeout),
};

export function createShowSoundClient(options: ShowSoundClientOptions): ShowSoundClient {
  const now = options.nowMonotonic ?? (() => performance.now());
  const timers = options.timers ?? realTimers;
  let started = false;
  let terminal = options.soundRunRoot === undefined;
  let socket: Socket | undefined;
  let receipt: z.infer<typeof receiptSchema> | undefined;
  let deadline: OneLoopTimerHandle | undefined;
  let pulse: OneLoopTimerHandle | undefined;
  let attachedAt: number | undefined;
  let reply = "";
  let generationId = 1;
  let loopId = "idle";
  let announce = true;
  let sequence = 0;
  let sourceSequence = 0;
  let sentElapsed = 0;
  let lastHeartbeat = 0;
  let lastCursor = -Infinity;
  let blockedAt: number | undefined;
  let reference: { row: number; cellCol: number; at: number } | undefined;
  let latest: { x: number; y: number; motion: number; at: number } | undefined;

  const clearTimers = (): void => {
    if (deadline !== undefined) timers.clearTimeout(deadline);
    if (pulse !== undefined) timers.clearInterval(pulse);
    deadline = pulse = undefined;
  };
  const release = (): void => {
    clearTimers();
    socket?.destroy();
    // Keep the error guard until close has consumed any in-flight socket error.
    socket?.removeListener("connect", onConnect);
    socket?.removeListener("data", onData);
    socket?.removeListener("drain", onDrain);
    reference = latest = undefined;
    receipt = undefined;
    reply = "";
  };
  const disable = (reason: string): void => {
    if (terminal) return;
    terminal = true;
    release();
    try { options.diagnostic?.(reason); } catch { /* Audio diagnostics cannot affect Show. */ }
  };
  const write = (frame: Record<string, unknown>): boolean => {
    if (terminal || socket === undefined) return false;
    try {
      const line = JSON.stringify(frame);
      if (Buffer.byteLength(line) > 1024) { disable("sound-frame-invalid"); return false; }
      if (!socket.write(`${line}\n`)) blockedAt = now();
      return true;
    } catch { disable("sound-send-failed"); return false; }
  };
  const send = (command: "heartbeat" | "cursor", at: number, features?: { x: number; y: number; motion: number }): boolean => {
    if (attachedAt === undefined || receipt === undefined) return false;
    const elapsedMs = at - attachedAt;
    if (sequence >= INT32_MAX || elapsedMs < sentElapsed || elapsedMs > 3_600_000 || !Number.isFinite(elapsedMs)) {
      disable("sound-clock-or-sequence-exhausted"); return false;
    }
    const sent = write({ command, token: receipt.token, runId: options.runId,
      controllerRunId: options.controllerRunId, seq: ++sequence, elapsedMs, generationId, loopId, ...features });
    if (sent) sentElapsed = elapsedMs;
    return sent;
  };
  const flush = (): void => {
    if (terminal || attachedAt === undefined) return;
    const at = now();
    if (at - lastHeartbeat >= 2000) { disable("sound-heartbeat-expired"); return; }
    if (blockedAt !== undefined) {
      if (at - blockedAt > 500) disable("sound-backpressure");
      return;
    }
    if (latest && (at - latest.at > 500 || latest.at - attachedAt < sentElapsed)) latest = undefined;
    // Send an aged sample before the next heartbeat, preserving wire timestamp order.
    if (!announce && latest && at - lastCursor >= 125) {
      const sample = latest; latest = undefined;
      if (send("cursor", sample.at, { x: sample.x, y: sample.y, motion: sample.motion })) lastCursor = at;
    }
    if (terminal || blockedAt !== undefined) return;
    if (announce || at - lastHeartbeat >= 250) {
      if (send("heartbeat", at)) { lastHeartbeat = at; announce = false; }
    }
  };
  function onConnect(): void {
    if (terminal || receipt === undefined) return;
    write({ command: "attach", token: receipt.token, runId: options.runId, controllerRunId: options.controllerRunId });
  }
  function onData(chunk: Buffer): void {
    if (terminal) return;
    if (attachedAt !== undefined || Buffer.byteLength(reply) + chunk.length > 1024) {
      disable("sound-attach-rejected"); return;
    }
    reply += chunk.toString("utf8");
    if (!reply.includes("\n")) return;
    if (reply !== '{"ok":true,"input":"real-cursor"}\n') { disable("sound-attach-rejected"); return; }
    attachedAt = lastHeartbeat = now();
    reference = latest = undefined;
    reply = "";
    if (deadline !== undefined) timers.clearTimeout(deadline);
    deadline = undefined;
    pulse = timers.setInterval(flush, 125);
    flush();
  }
  function onDrain(): void {
    if (terminal) return;
    if (blockedAt !== undefined && now() - blockedAt > 500) { disable("sound-backpressure"); return; }
    blockedAt = undefined;
    flush();
  }
  function onError(): void { disable("sound-connection-failed"); }
  function onClose(): void {
    disable("sound-peer-closed");
    release();
    socket?.removeListener("error", onError);
    socket?.removeListener("close", onClose);
    socket = undefined;
  }

  return {
    start() {
      if (started || terminal) return;
      started = true;
      if (!ID.test(options.runId) || !/^[A-Za-z0-9._-]{1,96}$/.test(options.controllerRunId)) {
        disable("sound-identity-invalid"); return;
      }
      deadline = timers.setTimeout(() => disable("sound-connect-timeout"), 1000);
      void readReceipt(options.soundRunRoot!).then(value => {
        if (terminal) return;
        receipt = value;
        socket = options.createSocket?.() ?? new Socket();
        socket.on("connect", onConnect).on("data", onData).on("drain", onDrain)
          .on("error", onError).on("close", onClose);
        socket.setNoDelay(true);
        socket.connect({ host: "127.0.0.1", port: value.port });
      }).catch(() => disable("sound-receipt-or-connect-failed"));
    },
    beginLoop(generation, loop) {
      if (terminal || !Number.isInteger(generation) || generation < generationId || generation > INT32_MAX || !ID.test(loop)) return;
      generationId = generation;
      loopId = loop;
      reference = latest = undefined;
      announce = true;
      flush();
    },
    observe(event, timing) {
      if (terminal || attachedAt === undefined || loopId === "idle" || event.loopId !== loopId || event.seq <= sourceSequence) return;
      // Cue-relative elapsedMs alone cannot recover age already spent in the bridge.
      if (timing === undefined || !Number.isFinite(timing.ageMs) || timing.ageMs < 0 || timing.ageMs > 500) return;
      const at = now() - timing.ageMs;
      if (at < attachedAt || (reference !== undefined && at < reference.at)) return;
      sourceSequence = event.seq;
      const previous = reference;
      reference = { row: event.row, cellCol: event.cellCol, at };
      if (!previous || (previous.row === event.row && previous.cellCol === event.cellCol)) return;
      latest = {
        at,
        x: 1 - event.viewRow / Math.max(1, event.rows - 1),
        y: event.viewCol / Math.max(1, event.cols - 1),
        motion: Math.min(1, Math.hypot(event.row - previous.row, event.cellCol - previous.cellCol) / 8 * 125 / Math.max(125, at - previous.at)),
      };
      flush();
    },
    reset() { reference = latest = undefined; },
    stop(_reason) {
      if (terminal) return;
      terminal = true; // Latch before any callbacks or asynchronous visual cleanup.
      clearTimers();
      reference = latest = undefined;
      if (attachedAt === undefined || socket === undefined || receipt === undefined || blockedAt !== undefined) {
        release(); return;
      }
      try {
        socket.end(`${JSON.stringify({ command: "stop", token: receipt.token })}\n`);
        deadline = timers.setTimeout(release, 300);
      } catch { release(); }
    },
  };
}
