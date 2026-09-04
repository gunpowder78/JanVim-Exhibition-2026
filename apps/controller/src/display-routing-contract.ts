import { createHash } from "node:crypto";

import { z } from "zod";

export type SoftDisplayId = "SCREEN-1" | "SCREEN-2" | "SCREEN-3";
export type DisplayMode = "production-3" | "single-display-preview";
export type DisplayRotation = 0 | 90 | 180 | 270;

export interface DisplayRectangleV2 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ShowRuntimeDisplay {
  readonly displayId: string | number;
  readonly bounds: DisplayRectangleV2;
  readonly workingArea: DisplayRectangleV2;
  readonly scaleFactor: number;
  readonly rotation: DisplayRotation;
}

export interface DisplayLayout {
  readonly schema: 1;
  readonly roles: readonly [
    { readonly softId: "SCREEN-1"; readonly surface: "janvim" },
    { readonly softId: "SCREEN-2"; readonly surface: "narrative" },
    {
      readonly softId: "SCREEN-3";
      readonly surface: "jianshan-placeholder";
    },
  ];
  readonly modes: readonly [
    {
      readonly mode: "production-3";
      readonly activeRoles: readonly ["SCREEN-1", "SCREEN-2", "SCREEN-3"];
      readonly skippedRoles: readonly [];
    },
    {
      readonly mode: "single-display-preview";
      readonly activeRoles: readonly ["SCREEN-1"];
      readonly skippedRoles: readonly ["SCREEN-2", "SCREEN-3"];
    },
  ];
  readonly layoutSha256: string;
}

export interface DisplayMapPhysicalSnapshot {
  readonly displayId: string;
  readonly label: string;
  readonly bounds: DisplayRectangleV2;
  readonly workingArea: DisplayRectangleV2;
  readonly scaleFactor: number;
  readonly rotation: DisplayRotation;
  readonly geometrySha256: string;
}

export interface DisplayMapBindingV2 extends DisplayMapPhysicalSnapshot {
  readonly softId: SoftDisplayId;
}

export interface DisplayMapV2 {
  readonly schema: 2;
  readonly mappingStatus: "confirmed";
  readonly mode: DisplayMode;
  readonly layoutSha256: string;
  readonly capturedAtUtc: string;
  readonly topologySha256: string;
  readonly bindings: readonly DisplayMapBindingV2[];
  readonly unassignedDisplays: readonly DisplayMapPhysicalSnapshot[];
}

type DisplayGeometryV2 = Pick<
  ShowRuntimeDisplay,
  "displayId" | "bounds" | "workingArea" | "scaleFactor" | "rotation"
>;

const LAYOUT_MAX_BYTES = 16 * 1024;
const MAP_MAX_BYTES = 64 * 1024;
const MAX_TOPOLOGY_DISPLAYS = 16;
const DISPLAY_ID_MAX_BYTES = 256;
const DISPLAY_LABEL_MAX_BYTES = 512;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const approvedLayoutSchema = z
  .object({
    schema: z.literal(1),
    roles: z.tuple([
      z.object({ softId: z.literal("SCREEN-1"), surface: z.literal("janvim") }).strict(),
      z.object({ softId: z.literal("SCREEN-2"), surface: z.literal("narrative") }).strict(),
      z
        .object({
          softId: z.literal("SCREEN-3"),
          surface: z.literal("jianshan-placeholder"),
        })
        .strict(),
    ]),
    modes: z.tuple([
      z
        .object({
          mode: z.literal("production-3"),
          activeRoles: z.tuple([
            z.literal("SCREEN-1"),
            z.literal("SCREEN-2"),
            z.literal("SCREEN-3"),
          ]),
          skippedRoles: z.tuple([]),
        })
        .strict(),
      z
        .object({
          mode: z.literal("single-display-preview"),
          activeRoles: z.tuple([z.literal("SCREEN-1")]),
          skippedRoles: z.tuple([
            z.literal("SCREEN-2"),
            z.literal("SCREEN-3"),
          ]),
        })
        .strict(),
    ]),
  })
  .strict();

const rectangleSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  })
  .strict()
  .superRefine((rectangle, context) => {
    if (!isSafeRectangle(rectangle)) {
      context.addIssue({
        code: "custom",
        message: "display geometry must use a safe rectangle",
      });
    }
  });

const scaleFactorSchema = z.number().superRefine((scaleFactor, context) => {
  if (
    !Number.isFinite(scaleFactor) ||
    scaleFactor <= 0 ||
    scaleFactor > Number.MAX_SAFE_INTEGER
  ) {
    context.addIssue({
      code: "custom",
      message: "display geometry must use a safe scale factor",
    });
  }
});

const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

const softDisplayIdSchema = z.union([
  z.literal("SCREEN-1"),
  z.literal("SCREEN-2"),
  z.literal("SCREEN-3"),
]);

const displayIdSchema = boundedTextSchema(
  "display ID",
  DISPLAY_ID_MAX_BYTES,
  false,
);
const displayLabelSchema = boundedTextSchema(
  "display label",
  DISPLAY_LABEL_MAX_BYTES,
  true,
);
const hashSchema = z.string().regex(HASH_PATTERN);

const physicalSnapshotFields = {
  displayId: displayIdSchema,
  label: displayLabelSchema,
  bounds: rectangleSchema,
  workingArea: rectangleSchema,
  scaleFactor: scaleFactorSchema,
  rotation: rotationSchema,
  geometrySha256: hashSchema,
};

const physicalSnapshotSchema = z
  .object(physicalSnapshotFields)
  .strict()
  .superRefine(validateGeometryHash);

const bindingSchema = z
  .object({
    softId: softDisplayIdSchema,
    ...physicalSnapshotFields,
  })
  .strict()
  .superRefine(validateGeometryHash);

const displayMapV2Schema = z
  .object({
    schema: z.literal(2),
    mappingStatus: z.literal("confirmed"),
    mode: z.union([
      z.literal("production-3"),
      z.literal("single-display-preview"),
    ]),
    layoutSha256: hashSchema,
    capturedAtUtc: z.string().superRefine((timestamp, context) => {
      if (!isCanonicalUtcTimestamp(timestamp)) {
        context.addIssue({
          code: "custom",
          message: "capturedAtUtc must be a canonical UTC timestamp",
        });
      }
    }),
    topologySha256: hashSchema,
    bindings: z.array(bindingSchema).max(MAX_TOPOLOGY_DISPLAYS),
    unassignedDisplays: z.array(physicalSnapshotSchema).max(MAX_TOPOLOGY_DISPLAYS),
  })
  .strict()
  .superRefine((map, context) => {
    const topology = [...map.bindings, ...map.unassignedDisplays];
    if (topology.length > MAX_TOPOLOGY_DISPLAYS) {
      context.addIssue({
        code: "custom",
        message: "display topology must contain at most 16 displays",
      });
    }

    const displayIds = topology.map((display) => display.displayId);
    if (new Set(displayIds).size !== displayIds.length) {
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "display topology contains duplicate display IDs",
      });
    }

    const softIds = map.bindings.map((binding) => binding.softId);
    if (new Set(softIds).size !== softIds.length) {
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "display map contains duplicate soft roles",
      });
    }

    if (
      map.mode === "production-3" &&
      (map.bindings.length !== 3 ||
        !(["SCREEN-1", "SCREEN-2", "SCREEN-3"] as const).every((softId) =>
          softIds.includes(softId),
        ))
    ) {
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "production-3 must bind SCREEN-1, SCREEN-2, and SCREEN-3",
      });
    }

    if (
      map.mode === "single-display-preview" &&
      (map.bindings.length !== 1 ||
        map.bindings[0]?.softId !== "SCREEN-1" ||
        map.unassignedDisplays.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "single-display-preview must bind only SCREEN-1",
      });
    }

    if (hashDisplayTopology(topology) !== map.topologySha256) {
      context.addIssue({
        code: "custom",
        path: ["topologySha256"],
        message: "display topology hash mismatch",
      });
    }
  });

export function parseDisplayLayout(bytes: Uint8Array): DisplayLayout {
  const value = parseBoundedJson(bytes, LAYOUT_MAX_BYTES, "display layout", "16 KiB");
  const parsed = approvedLayoutSchema.parse(value);
  return deepFreeze({
    ...parsed,
    layoutSha256: hashBytes(bytes),
  }) as DisplayLayout;
}

export function parseDisplayMap(bytes: Uint8Array): DisplayMapV2 {
  const value = parseBoundedJson(bytes, MAP_MAX_BYTES, "display map", "64 KiB");
  return deepFreeze(displayMapV2Schema.parse(value)) as DisplayMapV2;
}

export function assertDisplayMapBytesWithinLimit(bytes: Uint8Array): void {
  assertBoundedBytes(bytes, MAP_MAX_BYTES, "display map", "64 KiB");
}

export function hashDisplayGeometryV2(display: DisplayGeometryV2): string {
  return hashCanonical([
    String(display.displayId),
    display.bounds.x,
    display.bounds.y,
    display.bounds.width,
    display.bounds.height,
    display.workingArea.x,
    display.workingArea.y,
    display.workingArea.width,
    display.workingArea.height,
    display.scaleFactor,
    display.rotation,
  ]);
}

export function hashDisplayTopology(
  displays: readonly (DisplayMapBindingV2 | DisplayMapPhysicalSnapshot)[],
): string {
  const canonical = [...displays]
    .sort(compareDisplayIds)
    .map((display) => [
      "softId" in display ? display.softId : null,
      display.displayId,
      display.label,
      display.bounds.x,
      display.bounds.y,
      display.bounds.width,
      display.bounds.height,
      display.workingArea.x,
      display.workingArea.y,
      display.workingArea.width,
      display.workingArea.height,
      display.scaleFactor,
      display.rotation,
    ]);
  return hashCanonical(canonical);
}

function boundedTextSchema(label: string, maxBytes: number, allowEmpty: boolean) {
  return z.string().superRefine((value, context) => {
    if (!allowEmpty && value.length === 0) {
      context.addIssue({ code: "custom", message: `${label} must not be empty` });
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      context.addIssue({
        code: "custom",
        message: `${label} must be at most ${maxBytes} UTF-8 bytes`,
      });
    }
    if (CONTROL_CHARACTER_PATTERN.test(value)) {
      context.addIssue({
        code: "custom",
        message: `${label} must not contain control characters`,
      });
    }
  });
}

function validateGeometryHash(
  display: DisplayGeometryV2 & { readonly geometrySha256: string },
  context: z.RefinementCtx,
): void {
  if (hashDisplayGeometryV2(display) !== display.geometrySha256) {
    context.addIssue({
      code: "custom",
      path: ["geometrySha256"],
      message: "display geometry hash mismatch",
    });
  }
}

function parseBoundedJson(
  bytes: Uint8Array,
  maxBytes: number,
  label: string,
  displayLimit: string,
): unknown {
  assertBoundedBytes(bytes, maxBytes, label, displayLimit);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must contain valid UTF-8`);
  }
  return JSON.parse(text) as unknown;
}

function assertBoundedBytes(
  bytes: Uint8Array,
  maxBytes: number,
  label: string,
  displayLimit: string,
): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} must be supplied as Uint8Array bytes`);
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${displayLimit} limit`);
  }
}

function isCanonicalUtcTimestamp(value: string): boolean {
  if (!UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isSafeRectangle(rectangle: DisplayRectangleV2): boolean {
  return (
    Number.isSafeInteger(rectangle.x) &&
    Number.isSafeInteger(rectangle.y) &&
    Number.isSafeInteger(rectangle.width) &&
    Number.isSafeInteger(rectangle.height) &&
    rectangle.width > 0 &&
    rectangle.height > 0 &&
    Number.isSafeInteger(rectangle.x + rectangle.width) &&
    Number.isSafeInteger(rectangle.y + rectangle.height)
  );
}

function compareDisplayIds(
  left: DisplayMapBindingV2 | DisplayMapPhysicalSnapshot,
  right: DisplayMapBindingV2 | DisplayMapPhysicalSnapshot,
): number {
  if (left.displayId < right.displayId) return -1;
  if (left.displayId > right.displayId) return 1;
  return 0;
}

function hashCanonical(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
