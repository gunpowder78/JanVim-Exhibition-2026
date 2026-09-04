import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  hashDisplayGeometryV2,
  hashDisplayTopology,
  parseDisplayLayout,
  parseDisplayMap,
  type ShowRuntimeDisplay,
} from "../src/display-routing-contract.ts";
import { resolveDisplayRoute } from "../src/display-router.ts";

const APPROVED_LAYOUT = {
  schema: 1,
  roles: [
    { softId: "SCREEN-1", surface: "janvim" },
    { softId: "SCREEN-2", surface: "narrative" },
    { softId: "SCREEN-3", surface: "jianshan-placeholder" },
  ],
  modes: [
    {
      mode: "production-3",
      activeRoles: ["SCREEN-1", "SCREEN-2", "SCREEN-3"],
      skippedRoles: [],
    },
    {
      mode: "single-display-preview",
      activeRoles: ["SCREEN-1"],
      skippedRoles: ["SCREEN-2", "SCREEN-3"],
    },
  ],
};

const GEOMETRY_HASHES = {
  screen1: "07b21d0e2485470a1cfd693c6f6e1ced4f444dc02a3a663c67133e72322bff9d",
  screen2: "6041ec2eaf12d60e78e71f29a284800bdebe421f9c2ac9132e0ff43f9e60027a",
  screen3: "8ff9b6687b7700b4690ff4682839e1e3a35d1ba4956f9ffb21fc6a2bf9c77771",
  service: "1dde2c34dd561649aa6eed60d66ef81e6e4c55ffa2c6243ee5c82a4ea4ce02d4",
} as const;
const PRODUCTION_TOPOLOGY_HASH =
  "b7145669274cfe19a1276b972e97e488b52a12f252c0275846124c5f98024d65";
const PREVIEW_TOPOLOGY_HASH =
  "0b67716859be735322d7f4b5a788e369b8c15753cd0b345b1c6bfc1fce02eb6a";

const screen1: ShowRuntimeDisplay = {
  displayId: "display-A",
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workingArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  rotation: 0,
};
const screen2: ShowRuntimeDisplay = {
  displayId: "display-B",
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  workingArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1.25,
  rotation: 90,
};
const screen3: ShowRuntimeDisplay = {
  displayId: "display-C",
  bounds: { x: 3840, y: 0, width: 1920, height: 1080 },
  workingArea: { x: 3840, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
  rotation: 180,
};
const serviceDisplay: ShowRuntimeDisplay = {
  displayId: "display-Z",
  bounds: { x: 5760, y: 0, width: 1280, height: 720 },
  workingArea: { x: 5760, y: 0, width: 1280, height: 680 },
  scaleFactor: 1.5,
  rotation: 270,
};

function approvedLayoutBytes(): Buffer {
  return readFileSync(
    new URL("../../../show/display-layout.json", import.meta.url),
  );
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function productionMapFixture(layoutSha256: string) {
  return {
    schema: 2,
    mappingStatus: "confirmed",
    mode: "production-3",
    layoutSha256,
    capturedAtUtc: "2026-09-04T00:00:00.000Z",
    topologySha256: PRODUCTION_TOPOLOGY_HASH,
    bindings: [
      {
        softId: "SCREEN-1",
        displayId: "display-A",
        label: "Projector A",
        bounds: { ...screen1.bounds },
        workingArea: { ...screen1.workingArea },
        scaleFactor: screen1.scaleFactor,
        rotation: screen1.rotation,
        geometrySha256: GEOMETRY_HASHES.screen1,
      },
      {
        softId: "SCREEN-2",
        displayId: "display-B",
        label: "Projector B",
        bounds: { ...screen2.bounds },
        workingArea: { ...screen2.workingArea },
        scaleFactor: screen2.scaleFactor,
        rotation: screen2.rotation,
        geometrySha256: GEOMETRY_HASHES.screen2,
      },
      {
        softId: "SCREEN-3",
        displayId: "display-C",
        label: "Projector C",
        bounds: { ...screen3.bounds },
        workingArea: { ...screen3.workingArea },
        scaleFactor: screen3.scaleFactor,
        rotation: screen3.rotation,
        geometrySha256: GEOMETRY_HASHES.screen3,
      },
    ],
    unassignedDisplays: [
      {
        displayId: "display-Z",
        label: "Operator monitor",
        bounds: { ...serviceDisplay.bounds },
        workingArea: { ...serviceDisplay.workingArea },
        scaleFactor: serviceDisplay.scaleFactor,
        rotation: serviceDisplay.rotation,
        geometrySha256: GEOMETRY_HASHES.service,
      },
    ],
  };
}

function previewMapFixture(layoutSha256: string) {
  const production = productionMapFixture(layoutSha256);
  return {
    ...production,
    mode: "single-display-preview",
    topologySha256: PREVIEW_TOPOLOGY_HASH,
    bindings: [production.bindings[0]!],
    unassignedDisplays: [],
  };
}

function parsedLayout() {
  return parseDisplayLayout(approvedLayoutBytes());
}

function parsedProductionMap() {
  const layout = parsedLayout();
  return {
    layout,
    map: parseDisplayMap(encodeJson(productionMapFixture(layout.layoutSha256))),
  };
}

describe("strict logical display layout", () => {
  it("pins the byte-hashed logical layout to LF in every checkout", () => {
    const path = "show/display-layout.json";
    const result = spawnSync("git", ["check-attr", "eol", "--", path], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`${path}: eol: lf`);
  });

  it("keeps only the approved roles and modes in their approved order", () => {
    const bytes = approvedLayoutBytes();
    const raw = JSON.parse(bytes.toString("utf8")) as unknown;
    const layout = parseDisplayLayout(bytes);

    expect(raw).toEqual(APPROVED_LAYOUT);
    expect(layout).toMatchObject(APPROVED_LAYOUT);
    expect(layout.layoutSha256).toBe(sha256(bytes));
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.roles)).toBe(true);
    expect(Object.isFrozen(layout.roles[0])).toBe(true);
    expect(Object.isFrozen(layout.modes[0]?.activeRoles)).toBe(true);
  });

  it.each([
    ["an unknown field", { ...APPROVED_LAYOUT, inferredRole: "SCREEN-1" }],
    [
      "a reordered role",
      {
        ...APPROVED_LAYOUT,
        roles: [APPROVED_LAYOUT.roles[1], APPROVED_LAYOUT.roles[0], APPROVED_LAYOUT.roles[2]],
      },
    ],
    [
      "an unsupported mode",
      {
        ...APPROVED_LAYOUT,
        modes: [{ mode: "automatic", activeRoles: ["SCREEN-1"], skippedRoles: [] }],
      },
    ],
  ])("rejects %s", (_description, fixture) => {
    expect(() => parseDisplayLayout(encodeJson(fixture))).toThrow();
  });

  it("enforces the 16 KiB byte cap before JSON conversion", () => {
    const padded = new TextEncoder().encode(
      `${JSON.stringify(APPROVED_LAYOUT)}${" ".repeat(16 * 1024)}`,
    );

    expect(() => parseDisplayLayout(padded)).toThrow(/16 KiB/i);
  });
});

describe("schema-2 display map contract", () => {
  it("parses, clones, and deeply freezes an exact production map", () => {
    const layout = parsedLayout();
    const fixture = productionMapFixture(layout.layoutSha256);
    const parsed = parseDisplayMap(encodeJson(fixture));

    fixture.bindings[0]!.label = "mutated after parse";
    expect(parsed.bindings[0]?.label).toBe("Projector A");
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.bindings)).toBe(true);
    expect(Object.isFrozen(parsed.bindings[0]?.bounds)).toBe(true);
    expect(Object.isFrozen(parsed.unassignedDisplays[0])).toBe(true);
  });

  it("uses literal, version-specific geometry and topology digests", () => {
    const { map } = parsedProductionMap();
    const topology = [...map.bindings, ...map.unassignedDisplays];

    expect(hashDisplayGeometryV2(screen1)).toBe(GEOMETRY_HASHES.screen1);
    expect(hashDisplayGeometryV2(screen2)).toBe(GEOMETRY_HASHES.screen2);
    expect(hashDisplayTopology(topology)).toBe(PRODUCTION_TOPOLOGY_HASH);
    expect(hashDisplayTopology([...topology].reverse())).toBe(
      PRODUCTION_TOPOLOGY_HASH,
    );

    const roleChanged = topology.map((display) =>
      "softId" in display && display.softId === "SCREEN-1"
        ? { ...display, softId: "SCREEN-2" as const }
        : display,
    );
    expect(hashDisplayTopology(roleChanged)).not.toBe(PRODUCTION_TOPOLOGY_HASH);
  });

  it.each([
    ["unknown top-level fields", (map: ReturnType<typeof productionMapFixture>) => {
      Object.assign(map, { expectedDisplayCount: 2 });
    }, /unrecognized|unknown/i],
    ["unknown binding fields", (map: ReturnType<typeof productionMapFixture>) => {
      Object.assign(map.bindings[0]!, { primary: true });
    }, /unrecognized|unknown/i],
    ["duplicate display IDs", (map: ReturnType<typeof productionMapFixture>) => {
      map.unassignedDisplays[0]!.displayId = map.bindings[0]!.displayId;
    }, /duplicate display IDs/i],
    ["duplicate soft roles", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[1]!.softId = map.bindings[0]!.softId;
    }, /duplicate soft roles/i],
    ["non-UTC timestamps", (map: ReturnType<typeof productionMapFixture>) => {
      map.capturedAtUtc = "2026-09-04T08:00:00+08:00";
    }, /UTC timestamp/i],
    ["impossible timestamps", (map: ReturnType<typeof productionMapFixture>) => {
      map.capturedAtUtc = "2026-02-30T00:00:00.000Z";
    }, /UTC timestamp/i],
    ["rectangles with unsafe edges", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[0]!.bounds.x = Number.MAX_SAFE_INTEGER;
    }, /safe rectangle/i],
    ["non-positive rectangles", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[0]!.workingArea.width = 0;
    }, /safe rectangle/i],
    ["unsafe scales", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[0]!.scaleFactor = Number.MAX_VALUE;
    }, /safe scale factor/i],
    ["unsupported rotations", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[0]!.rotation = 45;
    }, /rotation/i],
    ["wrong geometry hashes", (map: ReturnType<typeof productionMapFixture>) => {
      map.bindings[0]!.geometrySha256 = "0".repeat(64);
    }, /geometry hash mismatch/i],
    ["wrong topology hashes", (map: ReturnType<typeof productionMapFixture>) => {
      map.topologySha256 = "0".repeat(64);
    }, /topology hash mismatch/i],
    ["preview maps with extra roles", (map: ReturnType<typeof productionMapFixture>) => {
      map.mode = "single-display-preview";
    }, /preview.*SCREEN-1/i],
  ])("rejects %s", (_description, mutate, expectedMessage) => {
    const layout = parsedLayout();
    const map = productionMapFixture(layout.layoutSha256);
    mutate(map);

    expect(() => parseDisplayMap(encodeJson(map))).toThrow(expectedMessage);
  });

  it("rejects a topology over 16 displays", () => {
    const layout = parsedLayout();
    const map = productionMapFixture(layout.layoutSha256);
    map.unassignedDisplays = Array.from({ length: 14 }, (_, index) => ({
      ...map.unassignedDisplays[0]!,
      displayId: `extra-${index}`,
      label: `Extra ${index}`,
    }));

    expect(() => parseDisplayMap(encodeJson(map))).toThrow(/at most 16 displays/i);
  });

  it.each([
    ["display ID", "displayId", "界".repeat(86), /256 UTF-8 bytes/i],
    ["label", "label", "界".repeat(171), /512 UTF-8 bytes/i],
    ["display ID control character", "displayId", "display\nA", /control characters/i],
    ["label control character", "label", "Projector\u0000A", /control characters/i],
  ])("rejects an invalid %s", (_description, field, value, expectedMessage) => {
    const layout = parsedLayout();
    const map = productionMapFixture(layout.layoutSha256);
    Object.assign(map.bindings[0]!, { [field]: value });

    expect(() => parseDisplayMap(encodeJson(map))).toThrow(expectedMessage);
  });

  it("rejects malformed layout hashes and mixed schema-1 fields", () => {
    const layout = parsedLayout();
    const malformedHash = productionMapFixture("not-a-sha256");
    const mixed = productionMapFixture(layout.layoutSha256);
    Object.assign(mixed, {
      expectedDisplayCount: 2,
      primary: mixed.bindings[0],
      secondary: mixed.bindings[1],
    });

    expect(() => parseDisplayMap(encodeJson(malformedHash))).toThrow(/layoutSha256/i);
    expect(() => parseDisplayMap(encodeJson(mixed))).toThrow(/unrecognized|unknown/i);
  });

  it("enforces the 64 KiB byte cap and rejects invalid UTF-8", () => {
    const layout = parsedLayout();
    const padded = new TextEncoder().encode(
      `${JSON.stringify(productionMapFixture(layout.layoutSha256))}${" ".repeat(64 * 1024)}`,
    );

    expect(() => parseDisplayMap(padded)).toThrow(/64 KiB/i);
    expect(() => parseDisplayMap(Uint8Array.from([0xff]))).toThrow(/UTF-8/i);
  });
});

describe("unified display resolver", () => {
  it("maps three explicit roles independent of enumeration order", () => {
    const { layout, map } = parsedProductionMap();

    expect(resolveDisplayRoute([screen3, screen1, screen2], layout, map)).toMatchObject({
      state: "mapped",
      mode: "production-3",
      roles: { "SCREEN-1": screen1, "SCREEN-2": screen2, "SCREEN-3": screen3 },
      skippedRoles: [],
      unassignedDisplays: [],
    });
  });

  it("ignores stored unassigned topology changes and reports current extras", () => {
    const { layout, map } = parsedProductionMap();
    const changedService = {
      ...serviceDisplay,
      bounds: { ...serviceDisplay.bounds, x: 6400 },
    };
    const route = resolveDisplayRoute(
      [screen1, changedService, screen3, screen2],
      layout,
      map,
    );

    expect(route).toMatchObject({
      state: "mapped",
      mode: "production-3",
      roles: { "SCREEN-1": screen1, "SCREEN-2": screen2, "SCREEN-3": screen3 },
      unassignedDisplays: [changedService],
    });
  });

  it("maps only SCREEN-1 in single-display preview and freezes cloned output", () => {
    const layout = parsedLayout();
    const map = parseDisplayMap(
      encodeJson(previewMapFixture(layout.layoutSha256)),
    );
    const route = resolveDisplayRoute([screen1], layout, map);

    expect(route).toMatchObject({
      state: "mapped",
      mode: "single-display-preview",
      roles: { "SCREEN-1": screen1 },
      skippedRoles: ["SCREEN-2", "SCREEN-3"],
      unassignedDisplays: [],
    });
    if (route.state !== "mapped") throw new Error(route.reason);
    expect(route.roles["SCREEN-1"]).not.toBe(screen1);
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.roles)).toBe(true);
    expect(Object.isFrozen(route.roles["SCREEN-1"]?.bounds)).toBe(true);
    expect(Object.isFrozen(route.skippedRoles)).toBe(true);
  });

  it("requires exactly one live display for preview", () => {
    const layout = parsedLayout();
    const map = parseDisplayMap(
      encodeJson(previewMapFixture(layout.layoutSha256)),
    );

    expect(resolveDisplayRoute([screen1, serviceDisplay], layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-count-mismatch",
    });
  });

  it("requires the map to hash the parsed logical layout", () => {
    const layout = parsedLayout();
    const map = parseDisplayMap(
      encodeJson(productionMapFixture("f".repeat(64))),
    );

    expect(resolveDisplayRoute([screen1, screen2, screen3], layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-layout-hash-mismatch",
    });
  });

  it.each([
    ["bounds", { ...screen2, bounds: { ...screen2.bounds, x: 1919 } }],
    [
      "working area",
      { ...screen2, workingArea: { ...screen2.workingArea, height: 1039 } },
    ],
    ["scale", { ...screen2, scaleFactor: 1.5 }],
    ["rotation", { ...screen2, rotation: 270 as const }],
  ])("requires the assigned display's stored %s", (_description, changedScreen2) => {
    const { layout, map } = parsedProductionMap();

    expect(resolveDisplayRoute([screen1, changedScreen2, screen3], layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-geometry-mismatch",
    });
  });

  it("returns bounded configuration reasons for missing, duplicate, or excess live displays", () => {
    const { layout, map } = parsedProductionMap();
    const duplicates = [screen1, { ...screen2, displayId: screen1.displayId }, screen3];
    const unsafeNumericId = [screen1, screen2, { ...screen3, displayId: Number.NaN }];
    const excess = Array.from({ length: 17 }, (_, index): ShowRuntimeDisplay => ({
      ...serviceDisplay,
      displayId: `live-${index}`,
      bounds: { ...serviceDisplay.bounds, x: index * 1280 },
      workingArea: { ...serviceDisplay.workingArea, x: index * 1280 },
    }));

    expect(resolveDisplayRoute([screen1, screen2], layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-count-mismatch",
    });
    expect(resolveDisplayRoute(duplicates, layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-runtime-invalid",
    });
    expect(resolveDisplayRoute(unsafeNumericId, layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-runtime-invalid",
    });
    expect(resolveDisplayRoute(excess, layout, map)).toEqual({
      state: "configuration-required",
      reason: "display-runtime-invalid",
    });
  });
});
