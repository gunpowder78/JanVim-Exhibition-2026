import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import * as showSchema from "../src/index";
import {
  parseAgentCommand,
  parseAgentCommandFromBytes,
  parseAgentAck,
  redactToken,
  type AgentCommand,
  type AgentAck,
} from "../src/index";

describe("agent protocol schema", () => {
  const goodCommand = {
    schema: 1,
    token: "fixture-token-2026-0001",
    loopId: "fixture-loop",
    cueId: "cue-prepare",
    action: {
      type: "prepare",
      poem: "白日依山尽",
      expectedSha256:
        "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8",
    },
  } satisfies AgentCommand;

  const goodAck = {
    schema: 1,
    loopId: "fixture-loop",
    cueId: "cue-prepare",
    outcome: "applied",
    mode: "normal",
    cursor: { row: 0, col: 0 },
    bufferSha256:
      "2222222222222222222222222222222222222222222222222222222222222222",
  } satisfies AgentAck;

  it("accepts valid command and ack payloads", () => {
    expect(() => parseAgentCommand(goodCommand, "127.0.0.1")).not.toThrow();
    expect(() => parseAgentAck(goodAck)).not.toThrow();
  });

  it("rejects unknown actions and non-loopback host", () => {
    expect(() =>
      parseAgentCommand({ ...goodCommand, action: { type: "launch-the-flags" } }, "127.0.0.1"),
    ).toThrowError(/Invalid discriminator value|unrecognized|invalid_union/i);
    expect(() => parseAgentCommand(goodCommand, "localhost")).toThrowError(/127\.0\.0\.1/);
  });

  it("rejects unknown fields inside every closed action and ACK cursor", () => {
    const actions = [
      { type: "prepare", poem: "白日依山尽", expectedSha256: "b".repeat(64) },
      { type: "status" },
      { type: "move", keys: "j", repeat: 1 },
      { type: "insert", text: "x", charsPerSecond: 20 },
      { type: "select", rangeId: "verse-1" },
      { type: "replace", rangeId: "verse-1", text: "x" },
      { type: "escape" },
      { type: "reset" },
    ];
    for (const action of actions) {
      expect(() =>
        parseAgentCommand(
          { ...goodCommand, action: { ...action, unexpected: true } },
          "127.0.0.1",
        ),
      ).toThrowError(/unrecognized|unknown/i);
    }

    expect(() =>
      parseAgentAck({
        ...goodAck,
        cursor: { ...goodAck.cursor, unexpected: true },
      }),
    ).toThrowError(/unrecognized|unknown/i);
  });

  it("rejects command text that looks like editor shell or ex commands", () => {
    const commandWithDangerousText = {
      ...goodCommand,
      action: { type: "insert", text: ":wq", charsPerSecond: 20 },
    };
    expect(() =>
      parseAgentCommand(commandWithDangerousText, "127.0.0.1"),
    ).toThrowError(/forbidden command/i);

    const commandWithMoreDangerousText = {
      ...goodCommand,
      action: { type: "insert", text: "!rm -rf /", charsPerSecond: 20 },
    };
    expect(() =>
      parseAgentCommand(commandWithMoreDangerousText, "127.0.0.1"),
    ).toThrowError(/forbidden command/i);
  });

  it("enforces NDJSON line limit and utf-8 validity", () => {
    const jsonLine = JSON.stringify(goodCommand) + "\n";
    const utf8 = Buffer.from(jsonLine, "utf8");
    expect(utf8.byteLength).toBeLessThanOrEqual(4096);
    expect(() => parseAgentCommandFromBytes(utf8, "127.0.0.1")).not.toThrow();

    const overlong = Buffer.concat([
      Buffer.from("127.0.0.1:"),
      Buffer.alloc(5000, 0x61),
      Buffer.from(JSON.stringify({ ...goodCommand, action: { type: "status" } })),
    ]);
    expect(overlong.byteLength).toBeGreaterThan(4096);
    expect(() => parseAgentCommandFromBytes(overlong, "127.0.0.1")).toThrowError(
      /line exceeds/,
    );

    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd, 0x61]);
    expect(() => parseAgentCommandFromBytes(invalidUtf8, "127.0.0.1")).toThrowError(
      /invalid UTF-8/i,
    );
  });

  it("rejects invalid token and hash values", () => {
    expect(() =>
      parseAgentCommand({ ...goodCommand, token: "bad token" }, "127.0.0.1"),
    ).toThrowError(/token/i);

    expect(() =>
      parseAgentAck({ ...goodAck, bufferSha256: "not-a-hash" }),
    ).toThrowError(/bufferSha256/i);
  });

  it("redacts token to deterministic 8-char fingerprint", () => {
    const token = "fixture-token-2026-0001";
    expect(redactToken(token)).toHaveLength(8);
    expect(redactToken(token)).toBe("559b325e");
  });

  it("accepts only bounded controller status events", () => {
    const parseRendererEvent = (
      showSchema as typeof showSchema & {
        parseRendererEvent?: (value: unknown) => unknown;
      }
    ).parseRendererEvent;
    expect(parseRendererEvent).toBeTypeOf("function");

    expect(
      parseRendererEvent?.({ schema: 1, type: "controller-status", state: "ready" }),
    ).toEqual({ schema: 1, type: "controller-status", state: "ready" });
    expect(() =>
      parseRendererEvent?.({
        schema: 1,
        type: "controller-status",
        state: "blocked",
        reason: "x".repeat(65),
      }),
    ).toThrow();
    expect(() =>
      parseRendererEvent?.({
        schema: 1,
        type: "controller-status",
        state: "unknown",
      }),
    ).toThrow();
  });
});
