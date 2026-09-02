import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseShowManifest, type ShowManifest } from "../src/index";

const fixturePath = join(process.cwd(), "content", "fixture", "show.manifest.json");
const baseline = JSON.parse(readFileSync(fixturePath, "utf8")) as ShowManifest;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("show manifest schema", () => {
  it("accepts the fixture manifest", () => {
    expect(() => parseShowManifest(baseline)).not.toThrow();
  });

  it("requires unique cue ids and non-decreasing atMs", () => {
    const manifest = clone(baseline);
    manifest.cues.push({ ...manifest.cues[1], id: manifest.cues[0].id });

    expect(() => parseShowManifest(manifest)).toThrowError(
      /cue id must be unique/i,
    );

    manifest.cues[0].atMs = 10_000;
    manifest.cues[1].atMs = 9_000;

    expect(() => parseShowManifest(manifest)).toThrowError(/atMs must be non-decreasing/i);
  });

  it("requires final cue to be reset and at or before loop duration", () => {
    const missingReset = clone(baseline);
    missingReset.cues[missingReset.cues.length - 1] = {
      ...missingReset.cues[0],
      id: "not-reset",
      kind: "fade",
      atMs: 10_000,
    };
    expect(() => parseShowManifest(missingReset)).toThrowError(
      /final cue must be editor-action reset/i,
    );

    const lateReset = clone(baseline);
    lateReset.cues[lateReset.cues.length - 1].atMs = lateReset.loopDurationMs + 1;
    expect(() => parseShowManifest(lateReset)).toThrowError(
      /reset cue must be within loop duration/i,
    );
  });

  it("validates editor-action payload and inserts chunk sizes", () => {
    const missingDisplay = clone(baseline);
    const actionCue = missingDisplay.cues.find((cue) => cue.kind === "editor-action");
    delete (actionCue as { payload?: { displayKeys?: string[] } }).payload?.displayKeys;
    expect(() => parseShowManifest(missingDisplay)).toThrowError(/displayKeys/i);

    const longInsert = clone(baseline);
    type InsertCue = (typeof baseline.cues)[number] & {
      kind: "editor-action";
      payload: { action: { type: "insert"; text: string } };
    };
    const insertCue = longInsert.cues.find(
      (cue): cue is InsertCue =>
        cue.kind === "editor-action" && cue.payload.action.type === "insert",
    );
    if (!insertCue) {
      throw new Error("Expected at least one insert editor-action cue");
    }
    insertCue.payload.action.text = "𠮷".repeat(600);
    expect(() => parseShowManifest(longInsert)).toThrowError(/at most 512 bytes/i);
  });

  it("limits editor actions to 256 per loop", () => {
    const tooMany = clone(baseline);
    const actionCue = tooMany.cues.find((cue) => cue.kind === "editor-action");
    const insertAction = actionCue?.payload;
    if (!insertAction) {
      throw new Error("Expected at least one editor-action");
    }

    for (let i = 0; i < 260; i += 1) {
      tooMany.cues.push({
        id: `extra-editor-${i}`,
        atMs: 55_000 + i,
        target: "main",
        kind: "editor-action",
        payload: {
          action: { type: "move", keys: "j", repeat: 1 },
          displayKeys: ["j"],
          semanticLabel: "overflow",
          critical: true,
        },
      });
    }

    expect(() => parseShowManifest(tooMany)).toThrowError(/must not exceed 256 editor-action cues/i);
  });

  it("requires all hashes to be fixed 64 lowercase hex", () => {
    expect(() => parseShowManifest(baseline)).not.toThrow();

    const upperHash = clone(baseline);
    upperHash.poemSha256 = "A".repeat(64);
    expect(() => parseShowManifest(upperHash)).toThrowError(/64 lowercase hexadecimal/i);
  });

  it("rejects unknown top-level and cue fields", () => {
    const unknownTop = clone(baseline);
    (unknownTop as { unknownTopField?: string }).unknownTopField = "x";
    expect(() => parseShowManifest(unknownTop)).toThrowError(/unrecognized key/i);

    const unknownCue = clone(baseline);
    // @ts-expect-error test only
    unknownCue.cues[0].unknown = "x";
    expect(() => parseShowManifest(unknownCue)).toThrowError(/unrecognized key/i);
  });
});
