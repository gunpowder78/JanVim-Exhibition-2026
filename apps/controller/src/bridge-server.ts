import { timingSafeEqual } from "node:crypto";
import { createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { TextDecoder } from "node:util";

import {
  parseAgentAck,
  parseAgentCommand,
  parseAgentCursorObservation,
  type AgentAck,
  type AgentCommand,
  type AgentCursorObservation,
} from "@janvim-exhibition/show-schema";

const LISTEN_HOST = "127.0.0.1";
const MAX_LINE_BYTES = 4_096;
const MAX_ACTIVE_CONNECTIONS = 4;
const MAX_PENDING_COMMANDS = 32;
const MAX_DUPLICATE_WAITERS = 4;
const MAX_ACKNOWLEDGEMENTS = 512;
const MAX_READY_WAITERS = 8;
const MAX_AGENT_DISCONNECT_LISTENERS = 8;
const MAX_CURSOR_BYTES = 1_024;
const CURSOR_INTERVAL_MS = 125;
const TOKEN_PATTERN = /^[A-Za-z0-9._-]{16,}$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface BridgeServerOptions {
  token: string;
  acknowledgementTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  now?: () => number;
}

export interface BridgeAddress {
  host: typeof LISTEN_HOST;
  port: number;
  family: string;
}

// Local delivery metadata only; never added to the authenticated wire observation.
export interface AgentCursorTiming {
  readonly ageMs: number;
}

type CursorListener = (event: AgentCursorObservation, timing: AgentCursorTiming) => void;

export interface BridgeDiagnostics {
  activeConnections: number;
  authenticatedConnections: number;
  pendingCommands: number;
  pendingTimers: number;
  sessionListeners: number;
  readyWaiters: number;
  agentDisconnectListeners: number;
}

type TrackedTimer = ReturnType<typeof setTimeout>;
type AgentDisconnectRegistration = {
  listener: () => void;
};

interface PendingCommand {
  actionType: AgentCommand["action"]["type"];
  dispatchedAtMs: number;
  promise: Promise<AgentAck>;
  resolve: (acknowledgement: AgentAck) => void;
  reject: (error: Error) => void;
  timer: TrackedTimer;
  duplicateWaiters: number;
}

interface ReadyWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: TrackedTimer;
}

interface Session {
  authenticated: boolean;
  lastCursorSeq: number;
  lastCursorAtMs: number;
  buffer: Buffer;
  handshakeTimer: TrackedTimer;
  onData: (chunk: Buffer) => void;
  onError: () => void;
  onClose: () => void;
}

export class BridgeServer {
  private readonly server: Server;
  private readonly token: string;
  private readonly acknowledgementTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<Socket, Session>();
  private readonly pending = new Map<string, PendingCommand>();
  private readonly acknowledgements = new Map<string, AgentAck>();
  private readonly timers = new Set<TrackedTimer>();
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private readonly agentDisconnectListeners = new Set<AgentDisconnectRegistration>();
  private agentSocket?: Socket;
  private cursorListener?: { listener: CursorListener; busy: boolean };
  private closing = false;

  public constructor(options: BridgeServerOptions) {
    if (!TOKEN_PATTERN.test(options.token)) {
      throw new Error("Bridge token format is invalid");
    }

    this.token = options.token;
    this.now = options.now ?? (() => performance.now());
    this.acknowledgementTimeoutMs = boundedPositiveTimeout(
      options.acknowledgementTimeoutMs,
      2_000,
    );
    this.handshakeTimeoutMs = boundedPositiveTimeout(options.handshakeTimeoutMs, 1_000);
    this.server = createServer((socket) => this.accept(socket));
    this.server.on("error", this.onServerError);
  }

  public async listen(): Promise<BridgeAddress> {
    if (this.closing) throw new Error("Bridge server is closing");
    if (!this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        const onListenError = (error: Error): void => {
          this.server.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          this.server.off("error", onListenError);
          resolve();
        };

        this.server.once("error", onListenError);
        this.server.once("listening", onListening);
        this.server.listen(0, LISTEN_HOST);
      });
    }

    return this.address();
  }

  public address(): BridgeAddress {
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Bridge server is not listening");
    }

    const networkAddress = address as AddressInfo;
    if (networkAddress.address !== LISTEN_HOST) {
      throw new Error("Bridge server escaped the IPv4 loopback boundary");
    }

    return {
      host: LISTEN_HOST,
      port: networkAddress.port,
      family: networkAddress.family,
    };
  }

  public waitForAgent(timeoutMs = 2_000): Promise<void> {
    if (this.isAgentReady()) return Promise.resolve();
    if (this.closing) return Promise.reject(new Error("Bridge server is closing"));
    if (this.readyWaiters.size >= MAX_READY_WAITERS) {
      return Promise.reject(new Error("Bridge ready waiter limit reached"));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = {} as ReadyWaiter;
      waiter.resolve = resolve;
      waiter.reject = reject;
      waiter.timer = this.setTrackedTimer(() => {
        this.readyWaiters.delete(waiter);
        reject(new Error("Timed out waiting for authenticated agent"));
      }, boundedPositiveTimeout(timeoutMs, 2_000));
      this.readyWaiters.add(waiter);
    });
  }

  public async dispatch(value: AgentCommand): Promise<AgentAck> {
    const command = parseAgentCommand(value, LISTEN_HOST);
    if (!tokensEqual(command.token, this.token)) {
      throw new Error("Command token does not match bridge token");
    }

    const key = commandKey(command.loopId, command.cueId);
    const remembered = this.acknowledgements.get(key);
    if (remembered !== undefined) return duplicateAcknowledgement(remembered);

    const inFlight = this.pending.get(key);
    if (inFlight !== undefined) {
      if (inFlight.duplicateWaiters >= MAX_DUPLICATE_WAITERS) {
        throw new Error("Bridge duplicate waiter limit reached");
      }
      inFlight.duplicateWaiters += 1;
      return inFlight.promise.then(duplicateAcknowledgement).finally(() => {
        inFlight.duplicateWaiters -= 1;
      });
    }

    const socket = this.agentSocket;
    if (socket === undefined || socket.destroyed || !this.isAgentReady()) {
      throw new Error("No authenticated agent connection is ready");
    }
    if (this.pending.size >= MAX_PENDING_COMMANDS) {
      throw new Error("Bridge pending command limit reached");
    }

    const encoded = Buffer.from(`${JSON.stringify(command)}\n`, "utf8");
    if (encoded.byteLength - 1 > MAX_LINE_BYTES) {
      throw new Error("Command NDJSON line exceeds 4096 bytes");
    }

    let resolvePromise!: (acknowledgement: AgentAck) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<AgentAck>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = this.setTrackedTimer(() => {
      const current = this.pending.get(key);
      if (current === undefined) return;
      this.pending.delete(key);
      current.reject(new Error(`Timed out waiting for agent ACK: ${command.cueId}`));
    }, this.acknowledgementTimeoutMs);

    this.pending.set(key, {
      actionType: command.action.type,
      dispatchedAtMs: this.now(),
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
      duplicateWaiters: 0,
    });

    socket.write(encoded, (error) => {
      if (error !== undefined && error !== null) {
        this.rejectPending(key, new Error(`Failed to write command: ${error.message}`));
      }
    });

    return promise;
  }

  public onAgentDisconnected(listener: () => void): () => void {
    if (this.closing) throw new Error("Bridge server is closing");
    if (this.agentDisconnectListeners.size >= MAX_AGENT_DISCONNECT_LISTENERS) {
      throw new Error("Bridge agent disconnect listener capacity reached");
    }
    const registration: AgentDisconnectRegistration = { listener };
    this.agentDisconnectListeners.add(registration);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.agentDisconnectListeners.delete(registration);
    };
  }

  public onCursor(listener: CursorListener): () => void {
    if (this.closing) throw new Error("Bridge server is closing");
    if (this.cursorListener !== undefined) throw new Error("Bridge cursor listener capacity reached");
    const registration = { listener, busy: false };
    this.cursorListener = registration;
    return () => {
      if (this.cursorListener === registration) this.cursorListener = undefined;
    };
  }

  public diagnostics(): BridgeDiagnostics {
    let authenticatedConnections = 0;
    let sessionListeners = 0;
    for (const [socket, session] of this.sessions) {
      if (session.authenticated) authenticatedConnections += 1;
      sessionListeners += socket.listenerCount("data");
      sessionListeners += socket.listenerCount("error");
      sessionListeners += socket.listenerCount("close");
    }

    return {
      activeConnections: this.sessions.size,
      authenticatedConnections,
      pendingCommands: this.pending.size,
      pendingTimers: this.timers.size,
      sessionListeners,
      readyWaiters: this.readyWaiters.size,
      agentDisconnectListeners: this.agentDisconnectListeners.size,
    };
  }

  public async close(): Promise<void> {
    if (this.closing && !this.server.listening) return;
    this.closing = true;
    this.cursorListener = undefined;
    this.agentDisconnectListeners.clear();
    this.rejectReadyWaiters(new Error("Bridge server closed"));
    this.rejectAllPending(new Error("Bridge server closed"));

    for (const socket of [...this.sessions.keys()]) {
      this.cleanupSession(socket, new Error("Bridge server closed"));
      socket.destroy();
    }

    for (const timer of [...this.timers]) this.clearTrackedTimer(timer);

    if (this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.close((error) => {
          if (error !== undefined) reject(error);
          else resolve();
        });
      });
    }
    this.server.off("error", this.onServerError);
  }

  private accept(socket: Socket): void {
    if (this.closing || this.sessions.size >= MAX_ACTIVE_CONNECTIONS) {
      socket.destroy();
      return;
    }

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1_000);

    const session = {} as Session;
    session.authenticated = false;
    session.lastCursorSeq = 0;
    session.lastCursorAtMs = -Infinity;
    session.buffer = Buffer.alloc(0);
    session.onData = (chunk) => this.receive(socket, chunk);
    session.onError = () => {};
    session.onClose = () => this.cleanupSession(socket, new Error("Agent connection closed"));
    session.handshakeTimer = this.setTrackedTimer(() => {
      socket.destroy();
    }, this.handshakeTimeoutMs);

    this.sessions.set(socket, session);
    socket.on("data", session.onData);
    socket.on("error", session.onError);
    socket.on("close", session.onClose);
  }

  private receive(socket: Socket, chunk: Buffer): void {
    const session = this.sessions.get(socket);
    if (session === undefined) return;

    session.buffer = Buffer.concat([session.buffer, chunk]);
    for (;;) {
      const newline = session.buffer.indexOf(0x0a);
      if (newline < 0) {
        if (session.buffer.byteLength > MAX_LINE_BYTES) socket.destroy();
        return;
      }
      if (newline > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }

      const line = session.buffer.subarray(0, newline);
      session.buffer = session.buffer.subarray(newline + 1);
      if (line.byteLength === 0 || !this.receiveLine(socket, session, line)) {
        socket.destroy();
        return;
      }
      if (socket.destroyed) return;
    }
  }

  private receiveLine(socket: Socket, session: Session, bytes: Buffer): boolean {
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(bytes));
    } catch {
      return false;
    }

    if (!session.authenticated) {
      if (!isAuthenticatedHello(value, this.token) || this.isAgentReady()) return false;

      session.authenticated = true;
      this.agentSocket = socket;
      this.clearTrackedTimer(session.handshakeTimer);
      this.resolveReadyWaiters();
      return true;
    }

    if (typeof value === "object" && value !== null && "type" in value && value.type === "cursor") {
      // A damaged optional observation cannot reject the command's separate ACK.
      if (socket === this.agentSocket && bytes.byteLength <= MAX_CURSOR_BYTES) {
        this.receiveCursor(session, value);
      }
      return true;
    }

    let acknowledgement: AgentAck;
    try {
      acknowledgement = parseAgentAck(value);
    } catch {
      return false;
    }

    const key = commandKey(acknowledgement.loopId, acknowledgement.cueId);
    const pending = this.pending.get(key);
    if (pending === undefined) return true;

    this.pending.delete(key);
    this.clearTrackedTimer(pending.timer);
    this.rememberAcknowledgement(key, acknowledgement);
    pending.resolve(acknowledgement);
    return true;
  }

  private receiveCursor(session: Session, value: unknown): void {
    let event: AgentCursorObservation;
    try {
      event = parseAgentCursorObservation(value);
    } catch {
      return;
    }
    const pending = this.pending.get(commandKey(event.loopId, event.cueId));
    if (pending === undefined || !["move", "insert", "select"].includes(pending.actionType)) return;
    if (event.seq <= session.lastCursorSeq) return;
    session.lastCursorSeq = event.seq;
    const now = this.now();
    const ageMs = now - (pending.dispatchedAtMs + event.elapsedMs);
    if (!Number.isFinite(ageMs) || ageMs > 500 || ageMs < -100) return;
    if (now - session.lastCursorAtMs < CURSOR_INTERVAL_MS) return;
    session.lastCursorAtMs = now;
    const registration = this.cursorListener;
    if (registration === undefined || registration.busy) return;
    // No cue awaits the observer; even an accidentally async observer has one bounded slot.
    registration.busy = true;
    try {
      void Promise.resolve(registration.listener(event, { ageMs: Math.max(0, ageMs) })).then(
        () => { registration.busy = false; },
        () => { registration.busy = false; },
      );
    } catch {
      registration.busy = false;
    }
  }

  private cleanupSession(socket: Socket, reason: Error): void {
    const session = this.sessions.get(socket);
    if (session === undefined) return;

    this.sessions.delete(socket);
    this.clearTrackedTimer(session.handshakeTimer);
    socket.off("data", session.onData);
    socket.off("error", session.onError);
    socket.off("close", session.onClose);

    if (this.agentSocket === socket) {
      this.agentSocket = undefined;
      this.rejectAllPending(reason);
      for (const { listener } of [...this.agentDisconnectListeners]) {
        try {
          void Promise.resolve(listener()).catch(() => undefined);
        } catch {
          // One observer cannot suppress delivery to the bounded snapshot.
        }
      }
    }
  }

  private rememberAcknowledgement(key: string, acknowledgement: AgentAck): void {
    this.acknowledgements.set(key, acknowledgement);
    if (this.acknowledgements.size <= MAX_ACKNOWLEDGEMENTS) return;

    const oldest = this.acknowledgements.keys().next().value as string | undefined;
    if (oldest !== undefined) this.acknowledgements.delete(oldest);
  }

  private rejectPending(key: string, error: Error): void {
    const pending = this.pending.get(key);
    if (pending === undefined) return;
    this.pending.delete(key);
    this.clearTrackedTimer(pending.timer);
    pending.reject(error);
  }

  private rejectAllPending(error: Error): void {
    for (const key of [...this.pending.keys()]) this.rejectPending(key, error);
  }

  private resolveReadyWaiters(): void {
    for (const waiter of [...this.readyWaiters]) {
      this.readyWaiters.delete(waiter);
      this.clearTrackedTimer(waiter.timer);
      waiter.resolve();
    }
  }

  private rejectReadyWaiters(error: Error): void {
    for (const waiter of [...this.readyWaiters]) {
      this.readyWaiters.delete(waiter);
      this.clearTrackedTimer(waiter.timer);
      waiter.reject(error);
    }
  }

  private isAgentReady(): boolean {
    return this.agentSocket !== undefined && !this.agentSocket.destroyed;
  }

  private setTrackedTimer(callback: () => void, delayMs: number): TrackedTimer {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      callback();
    }, delayMs);
    this.timers.add(timer);
    return timer;
  }

  private clearTrackedTimer(timer: TrackedTimer): void {
    if (!this.timers.delete(timer)) return;
    clearTimeout(timer);
  }

  private readonly onServerError = (error: Error): void => {
    this.rejectReadyWaiters(error);
    this.rejectAllPending(error);
  };
}

function boundedPositiveTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > 30_000) {
    throw new Error("Bridge timeout must be an integer from 1 to 30000 milliseconds");
  }
  return value;
}

function commandKey(loopId: string, cueId: string): string {
  return `${loopId}\u0000${cueId}`;
}

function duplicateAcknowledgement(acknowledgement: AgentAck): AgentAck {
  return { ...acknowledgement, outcome: "duplicate" };
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function isAuthenticatedHello(value: unknown, token: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    keys.length === 3 &&
    keys[0] === "schema" &&
    keys[1] === "token" &&
    keys[2] === "type" &&
    record.schema === 1 &&
    record.type === "hello" &&
    typeof record.token === "string" &&
    tokensEqual(record.token, token)
  );
}
