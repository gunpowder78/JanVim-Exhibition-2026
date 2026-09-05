import { describe, expect, it } from "vitest";

import * as schema from "../src/index.js";

const sample = { schema: 1, type: "cursor", loopId: "loop-1", cueId: "move-1",
  seq: 1, elapsedMs: 10, row: 0, cellCol: 2,
  viewRow: 0, viewCol: 2, rows: 20, cols: 80 };

describe("agent cursor observations", () => {
  it("exports a parser for the distinct cursor frame", () => {
    expect(schema.parseAgentCursorObservation).toBeTypeOf("function");
    expect(schema.parseAgentCursorObservation(sample)).toEqual(sample);
    expect(() => schema.parseAgentCursorObservation({ ...sample, cellCol: NaN })).toThrow();
  });

  it("accepts inclusive numeric bounds and command identifiers measured in UTF-8 bytes", () => {
    const boundary = { ...sample, loopId: "界".repeat(85), cueId: "x".repeat(256),
      seq: 2_147_483_647, elapsedMs: 2_000, row: 1_000_000, cellCol: 1_000_000,
      viewRow: 65_535, viewCol: 65_535, rows: 65_536, cols: 65_536 };
    expect(schema.parseAgentCursorObservation(boundary)).toEqual(boundary);
    expect(schema.parseAgentCursorObservation({ ...sample, elapsedMs: 0.5,
      cellCol: 0, viewCol: 0, rows: 1, cols: 1 })).toMatchObject({ elapsedMs: 0.5 });
  });

  it.each(Object.keys(sample))("rejects missing field %s", (key) => {
    const missing: Record<string, unknown> = { ...sample };
    delete missing[key];
    expect(() => schema.parseAgentCursorObservation(missing)).toThrow();
  });

  it.each([
    null, [], "cursor", { ...sample, extra: 1 },
    ...[0, 2, "1"].map((schema) => ({ ...sample, schema })),
    { ...sample, type: "ack" },
    ...["loopId", "cueId"].flatMap((key) => ["", 1, "x".repeat(257), "界".repeat(86)]
      .map((value) => ({ ...sample, [key]: value }))),
    ...["seq", "row", "cellCol", "viewRow", "viewCol", "rows", "cols"].flatMap((key) =>
      [-1, 0.1, NaN, Infinity, -Infinity, "1"].map((value) => ({ ...sample, [key]: value }))),
    ...[0, 2_147_483_648].map((seq) => ({ ...sample, seq })),
    ...["row", "cellCol"].map((key) => ({ ...sample, [key]: 1_000_001 })),
    ...["rows", "cols"].flatMap((key) => [0, 65_537].map((value) => ({ ...sample, [key]: value }))),
    ...[-1, 2_000.1, NaN, Infinity, -Infinity, "10"].map((elapsedMs) => ({ ...sample, elapsedMs })),
    { ...sample, viewRow: 20 }, { ...sample, viewCol: 80 },
  ])("rejects malformed observation %#", (value) => {
    expect(() => schema.parseAgentCursorObservation(value)).toThrow();
  });

  it("bounds encoded observations to 1024 UTF-8 bytes including JSON escapes", () => {
    // Identifiers remain within 256 bytes each, but escaping exceeds the wire budget.
    expect(() => schema.parseAgentCursorObservation({ ...sample,
      loopId: "\u0001".repeat(200), cueId: "界".repeat(85) })).toThrow();
  });
});
