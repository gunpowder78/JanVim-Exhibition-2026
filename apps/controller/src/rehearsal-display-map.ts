import { z } from "zod";

import {
  hashDisplayGeometry,
  type DisplayMapConfig,
  type DisplayMapRole,
  type RuntimeDisplay,
} from "./display-router.js";

export interface RehearsalDisplayCatalog {
  schema: 1;
  mappingStatus: "unconfirmed";
  expectedDisplayCount: 2;
  displays: DisplayMapRole[];
}

const rectangleSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const displayRoleSchema = z
  .object({
    displayId: z.string().min(1),
    bounds: rectangleSchema,
    scaleFactor: z.number().positive().finite(),
    geometrySha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .superRefine((role, context) => {
    if (hashDisplayGeometry(role) !== role.geometrySha256) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["geometrySha256"],
        message: "display geometry hash mismatch",
      });
    }
  });
const catalogSchema = z
  .object({
    schema: z.literal(1),
    mappingStatus: z.literal("unconfirmed"),
    expectedDisplayCount: z.literal(2),
    displays: z.array(displayRoleSchema).length(2),
  })
  .strict()
  .refine((catalog) => catalog.displays[0]!.displayId !== catalog.displays[1]!.displayId, {
    message: "captured display IDs must be distinct",
  });
const confirmedMapSchema = z
  .object({
    schema: z.literal(1),
    mappingStatus: z.literal("confirmed"),
    expectedDisplayCount: z.literal(2),
    primary: displayRoleSchema,
    secondary: displayRoleSchema,
  })
  .strict()
  .refine((map) => map.primary.displayId !== map.secondary.displayId, {
    message: "confirmed display IDs must be distinct",
  });

export function captureRehearsalDisplays(
  displays: readonly RuntimeDisplay[],
): RehearsalDisplayCatalog {
  if (displays.length !== 2) throw new Error("Capture requires exactly two displays");
  const normalized = displays
    .map((display) => ({
      displayId: normalizeDisplayId(display.displayId),
      bounds: { ...display.bounds },
      scaleFactor: display.scaleFactor,
    }))
    .sort((left, right) => left.displayId.localeCompare(right.displayId));
  for (const display of normalized) {
    if (!isValidRuntimeDisplay(display)) {
      throw new Error("Captured display is invalid");
    }
  }
  if (new Set(normalized.map((display) => display.displayId)).size !== 2) {
    throw new Error("Captured display IDs must be distinct");
  }

  return {
    schema: 1,
    mappingStatus: "unconfirmed",
    expectedDisplayCount: 2,
    displays: normalized.map((display) => ({
      ...display,
      geometrySha256: hashDisplayGeometry(display),
    })),
  };
}

export function confirmRehearsalDisplayMap(
  catalog: RehearsalDisplayCatalog,
  primaryId: string,
  secondaryId: string,
): DisplayMapConfig {
  const parsedCatalog = parseRehearsalDisplayCatalog(catalog);
  if (primaryId === secondaryId) throw new Error("Display IDs must be distinct");
  const primary = parsedCatalog.displays.find((display) => display.displayId === primaryId);
  const secondary = parsedCatalog.displays.find((display) => display.displayId === secondaryId);
  if (primary === undefined || secondary === undefined) {
    throw new Error("Confirmed IDs must exist in the captured catalog");
  }

  return {
    schema: 1,
    mappingStatus: "confirmed",
    expectedDisplayCount: 2,
    primary: { ...primary, bounds: { ...primary.bounds }, geometrySha256: hashDisplayGeometry(primary) },
    secondary: {
      ...secondary,
      bounds: { ...secondary.bounds },
      geometrySha256: hashDisplayGeometry(secondary),
    },
  };
}

export function parseRehearsalDisplayCatalog(value: unknown): RehearsalDisplayCatalog {
  return catalogSchema.parse(value) as RehearsalDisplayCatalog;
}

export function parseConfirmedRehearsalDisplayMap(value: unknown): DisplayMapConfig {
  return confirmedMapSchema.parse(value) as DisplayMapConfig;
}

function normalizeDisplayId(value: RuntimeDisplay["displayId"]): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "";
  return String(value);
}

function isValidRuntimeDisplay(display: {
  displayId: string;
  bounds: RuntimeDisplay["bounds"];
  scaleFactor: number;
}): boolean {
  return (
    display.displayId.length > 0 &&
    Number.isSafeInteger(display.bounds.x) &&
    Number.isSafeInteger(display.bounds.y) &&
    Number.isSafeInteger(display.bounds.width) &&
    Number.isSafeInteger(display.bounds.height) &&
    display.bounds.width > 0 &&
    display.bounds.height > 0 &&
    Number.isFinite(display.scaleFactor) &&
    display.scaleFactor > 0
  );
}
