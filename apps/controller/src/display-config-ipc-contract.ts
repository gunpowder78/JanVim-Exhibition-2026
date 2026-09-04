import { z } from "zod";

import type {
  DisplayMapPhysicalSnapshot,
  DisplayMode,
  SoftDisplayId,
} from "./display-routing-contract.js";

export const SNAPSHOT_CHANNEL = "janvim-display-config:snapshot";
export const IDENTIFY_CHANNEL = "janvim-display-config:identify";
export const CLOSE_IDENTIFY_CHANNEL = "janvim-display-config:close-identify";
export const SAVE_DISPLAY_MAP_CHANNEL = "janvim-display-config:save";

export interface NumberedDisplay extends DisplayMapPhysicalSnapshot {
  readonly number: number;
}

export interface ConfigurationSnapshot {
  readonly topologySha256: string;
  readonly displays: readonly NumberedDisplay[];
  readonly allowedModes: readonly DisplayMode[];
}

export interface SaveDisplayMapRequest {
  readonly topologySha256: string;
  readonly mode: DisplayMode;
  readonly bindings: readonly {
    readonly softId: SoftDisplayId;
    readonly displayId: string;
  }[];
}

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const boundedIdSchema = z.string().superRefine((value, context) => {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 256 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    context.addIssue({ code: "custom", message: "display ID is invalid" });
  }
});
const boundedLabelSchema = z.string().superRefine((value, context) => {
  if (
    Buffer.byteLength(value, "utf8") > 512 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    context.addIssue({ code: "custom", message: "display label is invalid" });
  }
});
const rectangleSchema = z
  .object({
    x: z.number().int().safe(),
    y: z.number().int().safe(),
    width: z.number().int().safe().positive(),
    height: z.number().int().safe().positive(),
  })
  .strict();
const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
const modeSchema = z.union([
  z.literal("production-3"),
  z.literal("single-display-preview"),
]);
const softIdSchema = z.union([
  z.literal("SCREEN-1"),
  z.literal("SCREEN-2"),
  z.literal("SCREEN-3"),
]);
const numberedDisplaySchema = z
  .object({
    number: z.number().int().min(1).max(16),
    displayId: boundedIdSchema,
    label: boundedLabelSchema,
    bounds: rectangleSchema,
    workingArea: rectangleSchema,
    scaleFactor: z.number().positive().finite().max(Number.MAX_SAFE_INTEGER),
    rotation: rotationSchema,
    geometrySha256: hashSchema,
  })
  .strict();
const snapshotSchema = z
  .object({
    topologySha256: hashSchema,
    displays: z.array(numberedDisplaySchema).max(16),
    allowedModes: z.array(modeSchema).max(1),
  })
  .strict();
const topologyRequestSchema = z
  .object({ topologySha256: hashSchema })
  .strict();
const saveRequestSchema = z
  .object({
    topologySha256: hashSchema,
    mode: modeSchema,
    bindings: z
      .array(
        z
          .object({
            softId: softIdSchema,
            displayId: boundedIdSchema,
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

export function parseConfigurationSnapshot(value: unknown): ConfigurationSnapshot {
  return snapshotSchema.parse(value) as ConfigurationSnapshot;
}

export function parseSnapshotRequest(
  value: unknown,
): { readonly topologySha256: string } {
  return topologyRequestSchema.parse(value);
}

export function parseTopologyRequest(
  value: unknown,
): { readonly topologySha256: string } {
  return topologyRequestSchema.parse(value);
}

export function parseSaveDisplayMapRequest(
  value: unknown,
): SaveDisplayMapRequest {
  return saveRequestSchema.parse(value) as SaveDisplayMapRequest;
}
