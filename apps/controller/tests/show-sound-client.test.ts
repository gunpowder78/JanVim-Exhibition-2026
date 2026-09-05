import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentCursorObservation } from "@janvim-exhibition/show-schema";
import type { OneLoopTimerAdapter, OneLoopTimerHandle } from "../src/one-loop-driver.ts";
const clientModule = await import("../src/show-sound-client.ts").catch(() => ({ createShowSoundClient: undefined }));

const parent = "D:/VirtualData/JanVim-Exhibition-Rehearsals";
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

class Clock implements OneLoopTimerAdapter {
  now = 50_000;
  next = 0;
  jobs = new Map<number, { at: number; delay?: number; callback: () => void }>();
  setTimeout(callback: () => void, delay: number) {
    const id = ++this.next; this.jobs.set(id, { at: this.now + delay, callback }); return id;
  }
  setInterval(callback: () => void, delay: number) {
    const id = this.setTimeout(callback, delay); this.jobs.get(id)!.delay = delay; return id;
  }
  clearTimeout(id: OneLoopTimerHandle) { this.jobs.delete(id as number); }
  clearInterval(id: OneLoopTimerHandle) { this.clearTimeout(id); }
  advance(ms: number) {
    this.now += ms;
    for (const [id, job] of [...this.jobs]) {
      if (job.at > this.now) continue;
      if (job.delay === undefined) this.jobs.delete(id); else job.at = this.now + job.delay;
      job.callback();
    }
  }
}

type Frame = Record<string, unknown>;
async function peer(reply = '{"ok":true,"input":"real-cursor"}\n') {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "task3-peer-"));
  const frames: Frame[] = [];
  const sockets: Socket[] = [];
  const server = createServer(socket => {
    sockets.push(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, end)) as Frame;
        buffer = buffer.slice(end + 1); frames.push(frame);
        if (frame.command === "attach" && reply) socket.write(frame.token === receipt.token ? reply : '{"ok":false}\n');
        if (frame.command === "stop") socket.end('{"ok":true}\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    sockets.forEach(socket => socket.destroy());
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const receipt = { active: true, host: "127.0.0.1", port: (server.address() as { port: number }).port,
    runRoot: root, token: randomUUID().replaceAll("-", "").repeat(2), version: 1, input: "real-cursor" };
  await writeFile(join(root, "control.json"), JSON.stringify(receipt));
  return { root, frames, sockets, server, receipt };
}

async function until(check: () => boolean) {
  await vi.waitFor(() => expect(check()).toBe(true), { timeout: 1500, interval: 5 });
}

function setup(root?: string, createSocket?: () => Socket) {
  const clock = new Clock();
  const diagnostics: string[] = [];
  const client = clientModule.createShowSoundClient!({ soundRunRoot: root,
    runId: "show-001", controllerRunId: "controller-001",
    nowMonotonic: () => clock.now, timers: clock, createSocket,
    diagnostic: reason => diagnostics.push(reason) });
  cleanup.push(() => { client.stop("test-cleanup"); clock.advance(300); });
  return {
    rawClient: client, clock, diagnostics,
    client: { ...client, observe: (event: AgentCursorObservation, timing = { ageMs: 0 }) => client.observe(event, timing) },
  };
}

const observation = (seq: number, changes: Partial<AgentCursorObservation> = {}): AgentCursorObservation => ({
  schema: 1, type: "cursor", loopId: "loop-1", cueId: "write-1", seq, elapsedMs: 0,
  row: 0, cellCol: 0, viewRow: 0, viewCol: 0, rows: 11, cols: 21, ...changes,
});

describe("optional Show sound client", () => {
  it("exports the bounded client factory", () => { expect(clientModule.createShowSoundClient).toBeTypeOf("function"); });
  it("does no read/connect/timer work without an option and Stop is terminal before start", () => {
    const createSocket = vi.fn(() => { throw new Error("unexpected connection"); });
    const { client, clock, diagnostics } = setup(undefined, createSocket);
    client.start(); client.beginLoop(1, "loop-1"); client.observe(observation(1)); client.reset(); client.stop("done"); client.start();
    expect(createSocket).not.toHaveBeenCalled(); expect(clock.jobs.size).toBe(0); expect(diagnostics).toEqual([]);
    const stopped = setup("D:/VirtualData/JanVim-Exhibition-Rehearsals/missing", createSocket);
    stopped.client.stop("before-start"); stopped.client.start();
    expect(createSocket).not.toHaveBeenCalled(); expect(stopped.clock.jobs.size).toBe(0);
  });
  it.each(["missing", "json", "oversized", "inactive", "remote", "wrong-root", "extra", "simulated", "token", "outside", "junction"])(
    "disables only sound for %s receipt/root without connecting", async kind => {
      const p = await peer();
      let root = p.root;
      const receipt: Frame = { ...p.receipt };
      if (kind === "inactive") receipt.active = false;
      if (kind === "remote") receipt.host = "example.com";
      if (kind === "wrong-root") receipt.runRoot = parent;
      if (kind === "extra") receipt.poem = "PRIVATE-TEXT";
      if (kind === "simulated") delete receipt.input;
      if (kind === "token") receipt.token = "bad";
      await writeFile(join(root, "control.json"), kind === "json" ? "PRIVATE-TEXT{" : kind === "oversized" ? " ".repeat(4097) : JSON.stringify(receipt));
      if (kind === "missing") await rm(join(root, "control.json"));
      if (kind === "outside") root = "D:/github/JanVim";
      if (kind === "junction") {
        root = join(parent, `task3-link-${randomUUID()}`);
        await symlink(p.root, root, "junction");
        cleanup.push(() => rm(root));
      }
      const { client, clock, diagnostics } = setup(root);
      expect(client.start()).toBeUndefined();
      await until(() => diagnostics.length === 1);
      client.start(); clock.advance(5000);
      expect(p.sockets).toHaveLength(0); expect(clock.jobs.size).toBe(0);
      expect(diagnostics.join()).not.toMatch(/PRIVATE-TEXT|example|[0-9a-f]{64}|github/);
    },
  );
  it("rejects a fixed receipt reparse target escaping its run root", async () => {
    const p = await peer();
    const outside = await peer();
    await rm(join(p.root, "control.json"));
    await symlink(outside.root, join(p.root, "control.json"), "junction");
    const { client, diagnostics } = setup(p.root); client.start();
    await until(() => diagnostics.length === 1); expect(p.sockets).toHaveLength(0); expect(outside.sockets).toHaveLength(0);
    await rm(join(p.root, "control.json"));
  });
  it.each(['{"ok":false}\n', '{"ok":true}\n', "x".repeat(1025)])("closes rejected or malformed attach without leaking diagnostics", async reply => {
    const p = await peer(reply); const { client, clock, diagnostics } = setup(p.root);
    client.start(); await until(() => diagnostics.length === 1);
    expect(clock.jobs.size).toBe(0); expect(p.frames.map(f => f.command)).toEqual(["attach"]);
    expect(diagnostics.join()).not.toContain(p.receipt.token);
  });
  it("closes a closed port without retry", async () => {
    const p = await peer(); await new Promise<void>(resolve => p.server.close(() => resolve()));
    const { client, diagnostics, clock } = setup(p.root); client.start();
    await until(() => diagnostics.length === 1); client.start(); clock.advance(5000);
    expect(clock.jobs.size).toBe(0); expect(diagnostics).toHaveLength(1);
  });
  it("accepts a 4096-byte receipt but closes a real peer's wrong-token rejection", async () => {
    const p = await peer();
    await writeFile(join(p.root, "control.json"), JSON.stringify(p.receipt).padEnd(4096, " "));
    const first = setup(p.root); first.client.start(); await until(() => p.frames.length === 2);
    const q = await peer();
    await writeFile(join(q.root, "control.json"), JSON.stringify({ ...q.receipt, token: "0".repeat(64) }));
    const second = setup(q.root); second.client.start(); await until(() => second.diagnostics.length === 1);
    expect(q.frames.map(f => f.command)).toEqual(["attach"]);
    expect(second.clock.jobs.size).toBe(0);
  });
  it("bounds attach to one second and ignores a late ACK", async () => {
    const p = await peer(""); const { client, clock, diagnostics } = setup(p.root); client.start();
    await until(() => p.frames.length === 1); clock.advance(999); expect(diagnostics).toEqual([]);
    clock.advance(1); await until(() => p.sockets[0]!.destroyed);
    expect(clock.jobs.size).toBe(0); client.start(); expect(diagnostics).toHaveLength(1);
  });
  it("maps actual movement, silences viewport changes, limits notes to 8 Hz and resets its baseline", async () => {
    const p = await peer(); const { client, clock } = setup(p.root); client.start();
    await until(() => p.frames.length === 2);
    expect(p.frames[1]).toMatchObject({ command: "heartbeat", elapsedMs: 0, generationId: 1, loopId: "idle", seq: 1 });
    client.beginLoop(1, "loop-1"); client.observe(observation(1));
    clock.advance(125); client.observe(observation(2, { row: 3, cellCol: 4, viewRow: 5, viewCol: 10 }));
    await until(() => p.frames.some(f => f.command === "cursor"));
    expect(p.frames.find(f => f.command === "cursor")).toMatchObject({ x: 0.5, y: 0.5, motion: 0.625, elapsedMs: 125 });
    client.observe(observation(3, { row: 3, cellCol: 4, viewRow: 0, viewCol: 0, rows: 20 }));
    clock.advance(125); await until(() => p.frames.some(f => f.command === "heartbeat" && f.elapsedMs === 250));
    expect(p.frames.filter(f => f.command === "cursor")).toHaveLength(1);
    client.observe(observation(4, { row: 3, cellCol: 6, viewRow: 0, viewCol: 20 }));
    client.observe(observation(5, { row: 3, cellCol: 8 }));
    client.observe(observation(6, { row: 3, cellCol: 10 }));
    client.reset(); clock.advance(125);
    client.observe(observation(7, { row: 90, cellCol: 90 })); // reset baseline, silent
    clock.advance(250); client.observe(observation(8, { row: 93, cellCol: 94, viewRow: 10, viewCol: 0 }));
    await until(() => p.frames.filter(f => f.command === "cursor").length === 3);
    expect(p.frames.filter(f => f.command === "cursor").at(-1)).toMatchObject({ x: 0, y: 0, motion: 0.3125, elapsedMs: 625 });
    const before = p.frames.length;
    client.observe(observation(8, { row: 99 })); client.observe(observation(9, { loopId: "old-loop", row: 99 }));
    client.stop("PRIVATE-TEXT"); client.start(); client.beginLoop(2, "late"); client.observe(observation(10));
    await until(() => p.sockets[0]!.destroyed); clock.advance(300);
    expect(p.frames.slice(before).map(f => f.command)).toEqual(["stop"]); expect(clock.jobs.size).toBe(0);
  });
  it("announces each loop/generation before cursor and never resets attach elapsed or sequence", async () => {
    const p = await peer(); const { client, clock } = setup(p.root); client.start(); await until(() => p.frames.length === 2);
    clock.advance(750); client.beginLoop(2, "loop-2"); client.observe(observation(1, { loopId: "loop-2" }));
    clock.advance(125); client.observe(observation(2, { loopId: "loop-2", cellCol: 8, rows: 1, cols: 1 }));
    await until(() => p.frames.some(f => f.command === "cursor"));
    expect(p.frames.at(-1)).toMatchObject({ command: "cursor", generationId: 2, loopId: "loop-2", x: 1, y: 0, motion: 1, elapsedMs: 875 });
    const announced = p.frames.findIndex(f => f.command === "heartbeat" && f.loopId === "loop-2");
    expect(announced).toBeGreaterThan(1); expect(announced).toBeLessThan(p.frames.length - 1);
    const controls = p.frames.slice(1); expect(controls.map(f => f.seq)).toEqual(controls.map((_, i) => i + 1));
    client.beginLoop(1, "old"); clock.advance(125); await until(() => p.frames.at(-1)?.command === "heartbeat");
    expect(p.frames.at(-1)).toMatchObject({ generationId: 2, loopId: "loop-2", elapsedMs: 1000 });
  });
  it("emits at most eight notes per second from a fast observer and keeps only the latest sample", async () => {
    const p = await peer(); const { client, clock } = setup(p.root); client.start(); await until(() => p.frames.length === 2);
    client.beginLoop(1, "loop-1"); client.observe(observation(1));
    for (let seq = 2; seq <= 101; seq++) {
      clock.advance(10);
      client.observe(observation(seq, { cellCol: seq * 2, viewCol: seq % 21 }));
    }
    await until(() => p.frames.filter(f => f.command === "cursor").length === 8);
    const notes = p.frames.filter(f => f.command === "cursor");
    expect(notes.map(f => f.elapsedMs)).toEqual([10, 140, 270, 400, 530, 660, 790, 920]);
    clock.advance(125); await until(() => p.frames.filter(f => f.command === "cursor").length === 9);
    expect(p.frames.filter(f => f.command === "cursor").at(-1)).toMatchObject({ elapsedMs: 1000, y: 0.85 });
  });
  it("bounds unanswered Stop cleanup to 300 ms with no late callbacks", async () => {
    const p = await peer(); let socket!: Socket;
    const { client, clock } = setup(p.root, () => (socket = new Socket()));
    client.start(); await until(() => p.frames.length === 2);
    p.sockets[0]!.removeAllListeners("data");
    client.stop("reason"); client.stop("again"); client.beginLoop(1, "loop-1");
    clock.advance(299); expect(socket.destroyed).toBe(false);
    clock.advance(1); expect(socket.destroyed).toBe(true);
    await until(() => socket.listenerCount("close") === 0);
    for (const event of ["connect", "data", "drain", "error", "close"]) expect(socket.listenerCount(event)).toBe(0);
    expect(clock.jobs.size).toBe(0);
  });
  it("expires a paused producer heartbeat and releases timers when the peer closes", async () => {
    const p = await peer(); const { client, clock, diagnostics } = setup(p.root); client.start(); await until(() => p.frames.length === 2);
    clock.advance(2000); await until(() => p.sockets[0]!.destroyed);
    expect(diagnostics).toHaveLength(1); expect(clock.jobs.size).toBe(0);
    const q = await peer(); const other = setup(q.root); other.client.start(); await until(() => q.frames.length === 2);
    q.sockets[0]!.destroy(); await until(() => other.diagnostics.length === 1);
    expect(other.clock.jobs.size).toBe(0);
  });
  it("preserves age already spent at the bridge and drops a sample whose total age exceeds 500 ms", async () => {
    const p = await peer(); const { client, clock } = setup(p.root); client.start(); await until(() => p.frames.length === 2);
    client.beginLoop(1, "loop-1");
    client.observe(observation(1), { ageMs: 0 });
    clock.now = 50_500; // 400 ms has already elapsed since this movement at t=100.
    client.observe(observation(2, { cellCol: 8 }), { ageMs: 400 });
    await until(() => p.frames.some(f => f.command === "cursor"));
    expect(p.frames.find(f => f.command === "cursor")).toMatchObject({ elapsedMs: 100, motion: 1 });
    clock.now = 51_001;
    client.observe(observation(3, { cellCol: 16 }), { ageMs: 501 });
    clock.advance(125);
    await until(() => p.frames.some(f => f.command === "heartbeat" && f.elapsedMs === 1126));
    expect(p.frames.filter(f => f.command === "cursor")).toHaveLength(1);
  });
  it("does not renew 400 ms of upstream age during 101 ms of backpressure", async () => {
    const p = await peer(); let socket!: Socket;
    const { client, clock } = setup(p.root, () => (socket = new Socket()));
    client.start(); await until(() => p.frames.length === 2); client.beginLoop(1, "loop-1");
    client.observe(observation(1));
    clock.now = 50_500;
    const write = socket.write.bind(socket);
    const spy = vi.spyOn(socket, "write").mockImplementation(((...args: Parameters<Socket["write"]>) => { write(...args); return false; }) as Socket["write"]);
    client.observe(observation(2, { cellCol: 2 }), { ageMs: 400 }); // Sent source time t=100.
    await until(() => p.frames.filter(f => f.command === "cursor").length === 1);
    clock.now = 50_625;
    client.observe(observation(3, { cellCol: 8, viewCol: 10 }), { ageMs: 400 }); // Born t=225.
    clock.now = 50_726; // The retained sample spent another 101 ms blocked; total age 501.
    // A new test socket drain must not grant a fresh age to the retained sample.
    spy.mockRestore(); socket.emit("drain");
    await until(() => p.frames.some(f => f.command === "heartbeat" && f.elapsedMs === 726));
    expect(p.frames.filter(f => f.command === "cursor")).toHaveLength(1);
    expect(p.sockets[0]!.destroyed).toBe(false);
  });
  it("drops observations without trustworthy local age metadata", async () => {
    const p = await peer(); const { client, rawClient, clock } = setup(p.root);
    client.start(); await until(() => p.frames.length === 2); client.beginLoop(1, "loop-1");
    client.observe(observation(1)); clock.now += 125;
    rawClient.observe(observation(2, { cellCol: 8 }));
    client.observe(observation(3, { cellCol: 16 }), { ageMs: Number.NaN });
    client.observe(observation(4, { cellCol: 24 }), { ageMs: -1 });
    clock.advance(125); await until(() => p.frames.some(f => f.command === "heartbeat" && f.elapsedMs === 250));
    expect(p.frames.filter(f => f.command === "cursor")).toHaveLength(0);
  });
  it("preserves original sample age through backpressure and never queues a burst", async () => {
    const p = await peer(); let socket!: Socket;
    const { client, clock, diagnostics } = setup(p.root, () => (socket = new Socket()));
    client.start(); await until(() => p.frames.length === 2); client.beginLoop(1, "loop-1");
    client.observe(observation(1)); clock.advance(125);
    const write = socket.write.bind(socket);
    const writeSpy = vi.spyOn(socket, "write").mockImplementation(((...args: Parameters<Socket["write"]>) => { write(...args); return false; }) as Socket["write"]);
    client.observe(observation(2, { cellCol: 8 }));
    clock.advance(50); client.observe(observation(3, { cellCol: 10, viewCol: 10 }));
    clock.advance(75); client.observe(observation(4, { cellCol: 12, viewCol: 12 }));
    writeSpy.mockRestore(); clock.now += 100; socket.emit("drain");
    await until(() => p.frames.filter(f => f.command === "cursor").length === 2);
    expect(p.frames.filter(f => f.command === "cursor").at(-1)).toMatchObject({ elapsedMs: 250, y: 0.6 });
    clock.advance(125); client.observe(observation(5, { cellCol: 14 }));
    vi.spyOn(socket, "write").mockReturnValue(false);
    clock.advance(250); // heartbeat is now blocked
    client.observe(observation(6, { cellCol: 16 })); clock.advance(501); socket.emit("drain");
    await until(() => p.sockets[0]!.destroyed); expect(diagnostics).toHaveLength(1); expect(clock.jobs.size).toBe(0);
    expect(socket.listenerCount("drain")).toBe(0);
    expect((await readFile(join(p.root, "control.json"), "utf8"))).toBe(JSON.stringify(p.receipt));
  });
});
