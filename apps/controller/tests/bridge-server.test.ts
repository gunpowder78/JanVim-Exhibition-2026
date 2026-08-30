import { once } from "node:events";
import { createConnection, type Socket } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { AgentAck, AgentCommand } from "../../../packages/show-schema/src/index";
import { BridgeServer } from "../src/bridge-server.ts";

const TOKEN = "fixture-token-2026-bridge";
const BUFFER_HASH = "2".repeat(64);

function statusCommand(cueId: string): AgentCommand {
  return {
    schema: 1,
    token: TOKEN,
    loopId: "loop-fixture",
    cueId,
    action: { type: "status" },
  };
}

function appliedAck(command: AgentCommand): AgentAck {
  return {
    schema: 1,
    loopId: command.loopId,
    cueId: command.cueId,
    outcome: "applied",
    mode: "normal",
    cursor: { row: 0, col: 0 },
    bufferSha256: BUFFER_HASH,
  };
}

class LineReader {
  private buffer = Buffer.alloc(0);
  private readonly lines: string[] = [];
  private readonly waiters: Array<() => void> = [];
  public lineCount = 0;

  public constructor(private readonly socket: Socket) {
    socket.on("data", this.onData);
  }

  public async read(count: number): Promise<string[]> {
    const deadline = Date.now() + 1_000;
    while (this.lines.length < count) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`timed out waiting for ${count} NDJSON lines`);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = this.waiters.indexOf(wake);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`timed out waiting for ${count} NDJSON lines`));
        }, remaining);
        const wake = (): void => {
          clearTimeout(timer);
          resolve();
        };
        this.waiters.push(wake);
      });
    }

    return this.lines.splice(0, count);
  }

  public dispose(): void {
    this.socket.off("data", this.onData);
    for (const wake of this.waiters.splice(0)) wake();
  }

  private readonly onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) break;

      this.lines.push(this.buffer.subarray(0, newline).toString("utf8"));
      this.lineCount += 1;
      this.buffer = this.buffer.subarray(newline + 1);
    }

    for (const wake of this.waiters.splice(0)) wake();
  };
}

describe("loopback bridge server", () => {
  const servers: BridgeServer[] = [];
  const sockets: Socket[] = [];
  const readers: LineReader[] = [];

  afterEach(async () => {
    for (const reader of readers.splice(0)) reader.dispose();
    for (const socket of sockets.splice(0)) socket.destroy();
    await Promise.all(servers.splice(0).map(async (server) => server.close()));
  });

  async function startServer(): Promise<BridgeServer> {
    const server = new BridgeServer({
      token: TOKEN,
      acknowledgementTimeoutMs: 500,
      handshakeTimeoutMs: 500,
    });
    servers.push(server);
    await server.listen();
    return server;
  }

  async function connectRaw(server: BridgeServer): Promise<Socket> {
    const address = server.address();
    const socket = createConnection({ host: address.host, port: address.port });
    socket.on("error", () => {});
    sockets.push(socket);
    await once(socket, "connect");
    return socket;
  }

  async function connectAgent(server: BridgeServer): Promise<{ socket: Socket; reader: LineReader }> {
    const socket = await connectRaw(server);
    const reader = new LineReader(socket);
    readers.push(reader);
    socket.write(`${JSON.stringify({ schema: 1, type: "hello", token: TOKEN })}\n`);
    await server.waitForAgent(500);
    return { socket, reader };
  }

  it("binds an ephemeral IPv4 port only on 127.0.0.1", async () => {
    const server = await startServer();

    expect(server.address()).toMatchObject({
      host: "127.0.0.1",
      family: "IPv4",
    });
    expect(server.address().port).toBeGreaterThan(0);
  });

  it("immediately disconnects a client whose first message has the wrong token", async () => {
    const server = await startServer();
    const socket = await connectRaw(server);
    const closed = once(socket, "close");

    socket.write(
      `${JSON.stringify({ schema: 1, type: "hello", token: "wrong-token-2026-0000" })}\n`,
    );

    await closed;
    expect(server.diagnostics()).toMatchObject({
      authenticatedConnections: 0,
      pendingCommands: 0,
    });
  });

  it("maps one command to exactly one validated ACK", async () => {
    const server = await startServer();
    const { socket, reader } = await connectAgent(server);
    const command = statusCommand("cue-one");

    const acknowledgement = server.dispatch(command);
    const [line] = await reader.read(1);
    expect(JSON.parse(line!)).toEqual(command);
    socket.write(`${JSON.stringify(appliedAck(command))}\n`);

    await expect(acknowledgement).resolves.toEqual(appliedAck(command));
    expect(reader.lineCount).toBe(1);
  });

  it("accepts split and coalesced ACK NDJSON without changing order", async () => {
    const server = await startServer();
    const { socket, reader } = await connectAgent(server);
    const splitCommand = statusCommand("cue-split");
    const splitPromise = server.dispatch(splitCommand);
    await reader.read(1);

    const splitLine = Buffer.from(`${JSON.stringify(appliedAck(splitCommand))}\n`, "utf8");
    socket.write(splitLine.subarray(0, 9));
    socket.write(splitLine.subarray(9));
    await expect(splitPromise).resolves.toMatchObject({ cueId: "cue-split" });

    const first = statusCommand("cue-coalesced-1");
    const second = statusCommand("cue-coalesced-2");
    const firstPromise = server.dispatch(first);
    const secondPromise = server.dispatch(second);
    await reader.read(2);
    socket.write(
      `${JSON.stringify(appliedAck(first))}\n${JSON.stringify(appliedAck(second))}\n`,
    );

    await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([
      appliedAck(first),
      appliedAck(second),
    ]);
  });

  it("rejects a 4097-byte inbound NDJSON line", async () => {
    const server = await startServer();
    const socket = await connectRaw(server);
    const closed = once(socket, "close");

    socket.write(Buffer.concat([Buffer.alloc(4_097, 0x61), Buffer.from("\n")]));

    await closed;
    expect(server.diagnostics().authenticatedConnections).toBe(0);
  });

  it("bounds unauthenticated connection slots", async () => {
    const server = await startServer();
    for (let index = 0; index < 4; index += 1) {
      await connectRaw(server);
    }
    const overflow = await connectRaw(server);
    if (!overflow.destroyed) await once(overflow, "close");

    expect(server.diagnostics().activeConnections).toBe(4);
  });

  it("bounds callers waiting for an authenticated agent", async () => {
    const server = await startServer();
    const waiters = Array.from({ length: 8 }, () => server.waitForAgent(100));
    for (const waiter of waiters) void waiter.catch(() => {});

    await expect(server.waitForAgent(100)).rejects.toThrow(/ready waiter limit/i);
    expect(server.diagnostics().readyWaiters).toBe(8);
    await server.close();
    await Promise.allSettled(waiters);
  });

  it("returns duplicate without sending the same loopId and cueId to the agent twice", async () => {
    const server = await startServer();
    const { socket, reader } = await connectAgent(server);
    const command = statusCommand("cue-duplicate");

    const first = server.dispatch(command);
    await reader.read(1);
    socket.write(`${JSON.stringify(appliedAck(command))}\n`);
    await expect(first).resolves.toMatchObject({ outcome: "applied" });

    await expect(server.dispatch(command)).resolves.toMatchObject({
      cueId: "cue-duplicate",
      outcome: "duplicate",
    });
    expect(reader.lineCount).toBe(1);
  });

  it("bounds duplicate callers waiting on one in-flight command", async () => {
    const server = await startServer();
    const { socket, reader } = await connectAgent(server);
    const command = statusCommand("cue-pending-duplicate");
    const primary = server.dispatch(command);
    await reader.read(1);
    const duplicates = Array.from({ length: 4 }, () => server.dispatch(command));
    const overflow = server.dispatch(command);
    const overflowAssertion = expect(overflow).rejects.toThrow(/duplicate waiter limit/i);
    socket.write(`${JSON.stringify(appliedAck(command))}\n`);

    await expect(primary).resolves.toMatchObject({ outcome: "applied" });
    await expect(Promise.all(duplicates)).resolves.toSatisfy((acknowledgements: AgentAck[]) =>
      acknowledgements.every((acknowledgement) => acknowledgement.outcome === "duplicate"),
    );
    await overflowAssertion;
    expect(reader.lineCount).toBe(1);
  });

  it("releases every pending timer and session listener when the socket closes", async () => {
    const server = await startServer();
    const { socket, reader } = await connectAgent(server);
    const pending = server.dispatch(statusCommand("cue-disconnect"));
    await reader.read(1);
    const closed = once(socket, "close");

    socket.destroy();
    await closed;

    await expect(pending).rejects.toThrow(/agent connection closed/i);
    expect(server.diagnostics()).toEqual({
      activeConnections: 0,
      authenticatedConnections: 0,
      pendingCommands: 0,
      pendingTimers: 0,
      sessionListeners: 0,
      readyWaiters: 0,
      agentDisconnectListeners: 0,
    });
  });

  it("notifies an idle authenticated disconnect exactly once without retaining resources", async () => {
    const server = await startServer();
    const notifications: Array<ReturnType<BridgeServer["diagnostics"]>> = [];
    server.onAgentDisconnected(() => {
      notifications.push(server.diagnostics());
    });
    const { socket } = await connectAgent(server);

    const closed = once(socket, "close");
    socket.destroy();
    await closed;

    expect(notifications).toEqual([
      expect.objectContaining({
        authenticatedConnections: 0,
        pendingCommands: 0,
        pendingTimers: 0,
        sessionListeners: 0,
      }),
    ]);
    expect(server.diagnostics()).toMatchObject({
      activeConnections: 0,
      authenticatedConnections: 0,
      pendingCommands: 0,
      pendingTimers: 0,
      sessionListeners: 0,
      readyWaiters: 0,
      agentDisconnectListeners: 1,
    });

    await server.close();
    expect(notifications).toHaveLength(1);
    expect(server.diagnostics().agentDisconnectListeners).toBe(0);
  });

  it("bounds disconnect listeners, disposes registrations, and rejects pending work first", async () => {
    const server = await startServer();
    const deliveries: number[] = [];
    const disposers = Array.from({ length: 8 }, (_value, index) =>
      server.onAgentDisconnected(() => {
        expect(server.diagnostics().pendingCommands).toBe(0);
        deliveries.push(index);
      }),
    );

    expect(server.diagnostics().agentDisconnectListeners).toBe(8);
    expect(() => server.onAgentDisconnected(() => undefined)).toThrow(
      /disconnect listener limit|capacity/i,
    );
    expect(server.diagnostics().agentDisconnectListeners).toBe(8);
    disposers[3]!();
    expect(server.diagnostics().agentDisconnectListeners).toBe(7);

    const unauthenticated = await connectRaw(server);
    const unauthenticatedClosed = once(unauthenticated, "close");
    unauthenticated.destroy();
    await unauthenticatedClosed;
    expect(deliveries).toEqual([]);

    const { socket, reader } = await connectAgent(server);
    const pending = server.dispatch(statusCommand("cue-disconnect-order"));
    await reader.read(1);
    const closed = once(socket, "close");
    socket.destroy();
    await closed;
    await expect(pending).rejects.toThrow(/agent connection closed/i);

    expect(deliveries).toEqual([0, 1, 2, 4, 5, 6, 7]);
    await server.close();
    expect(deliveries).toHaveLength(7);
    expect(server.diagnostics()).toMatchObject({
      activeConnections: 0,
      pendingCommands: 0,
      pendingTimers: 0,
      sessionListeners: 0,
      readyWaiters: 0,
      agentDisconnectListeners: 0,
    });
  });

  it("counts duplicate callback registrations independently and disposes only one", async () => {
    const server = await startServer();
    let deliveries = 0;
    const callback = (): void => {
      deliveries += 1;
    };
    const disposers = Array.from({ length: 8 }, () =>
      server.onAgentDisconnected(callback),
    );

    expect(server.diagnostics().agentDisconnectListeners).toBe(8);
    expect(() => server.onAgentDisconnected(callback)).toThrow(
      /disconnect listener limit|capacity/i,
    );
    disposers[0]!();
    expect(server.diagnostics().agentDisconnectListeners).toBe(7);

    const { socket } = await connectAgent(server);
    const closed = once(socket, "close");
    socket.destroy();
    await closed;

    expect(deliveries).toBe(7);
  });

  it("absorbs asynchronous disconnect-listener rejection without suppressing peers", async () => {
    const server = await startServer();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    let peerDeliveries = 0;

    try {
      server.onAgentDisconnected(async () => {
        throw new Error("injected async disconnect listener failure");
      });
      server.onAgentDisconnected(() => {
        peerDeliveries += 1;
      });
      const { socket } = await connectAgent(server);
      const closed = once(socket, "close");
      socket.destroy();
      await closed;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(peerDeliveries).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
