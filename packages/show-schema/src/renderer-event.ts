import { z } from "zod";

export type EditorAction =
  | { type: "move"; keys: "h" | "j" | "k" | "l" | "w" | "b" | "e" | "0" | "$" | "G"; repeat: number }
  | { type: "insert"; text: string; charsPerSecond: number }
  | { type: "select"; rangeId: string }
  | { type: "replace"; rangeId: string; text: string }
  | { type: "escape" }
  | { type: "reset" };

export type CueTarget = "main" | "secondary" | "both";

export type CueKind =
  | "prompt"
  | "token-stream"
  | "formula"
  | "matrix"
  | "image"
  | "editor-action"
  | "key-overlay"
  | "fade";

export type EditorPayload = {
  action: EditorAction;
  displayKeys: string[];
  semanticLabel: string;
  critical: true;
};

export type Cue =
  | {
      id: string;
      atMs: number;
      target: CueTarget;
      kind: Exclude<CueKind, "editor-action">;
      payload: Record<string, unknown>;
    }
  | {
      id: string;
      atMs: number;
      target: CueTarget;
      kind: "editor-action";
      payload: EditorPayload;
    };

export type ControllerStatusEvent = {
  schema: 1;
  type: "controller-status";
  state: "booting" | "ready" | "running" | "blocked" | "complete-awaiting-close";
  reason?: string;
};

export type OperatorAction = "start" | "restart-loop" | "stop-show";

export type RendererToControllerEvent =
  | { schema: 1; type: "operator-action"; action: OperatorAction }
  | {
      schema: 1;
      type: "presentation-ack";
      generationId: number;
      loopId: string;
      cueId: string;
    };

export type RunCueEvent = {
  schema: 1;
  type: "run-cue";
  generationId: number;
  loopId: string;
  requiresPresentationAck: boolean;
  cue: Cue;
};

export type RunStatusEvent = {
  schema: 1;
  type: "run-status";
  generationId: number;
  state:
    | "booting"
    | "ready"
    | "running"
    | "safe-cruise"
    | "black-recovering"
    | "safe-ready"
    | "shutting-down"
    | "stopped";
  reason?: string;
};

export type RendererEvent = Cue | ControllerStatusEvent | RunCueEvent | RunStatusEvent;

const textEncoder = new TextEncoder();
const nonCommandText = z
  .string()
  .min(0)
  .refine(
    (value) => !value.startsWith(":") && !value.startsWith("!"),
    "forbidden command prefix is not allowed",
  );
const safeInsert = z
  .string()
  .refine(
    (value) => textEncoder.encode(value).byteLength <= 512,
    "insert text must be at most 512 bytes",
  )
  .pipe(nonCommandText);

export const editorActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("move"),
      keys: z.enum(["h", "j", "k", "l", "w", "b", "e", "0", "$", "G"]),
      repeat: z.number().int().min(0).max(256),
    })
    .strict(),
  z
    .object({
      type: z.literal("insert"),
      text: safeInsert,
      charsPerSecond: z.number().min(0).max(1_000),
    })
    .strict(),
  z.object({ type: z.literal("select"), rangeId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("replace"),
      rangeId: z.string().min(1),
      text: safeInsert,
    })
    .strict(),
  z.object({ type: z.literal("escape") }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);

const editorPayloadSchema = z
  .object({
    action: editorActionSchema,
    displayKeys: z.array(z.string()).min(1),
    semanticLabel: z.string().min(1),
    critical: z.literal(true),
  })
  .strict();
const cueTargetSchema = z.enum(["main", "secondary", "both"]);
const cueNonEditorKindSchema = z.enum([
  "prompt",
  "token-stream",
  "formula",
  "matrix",
  "image",
  "key-overlay",
  "fade",
]);
const manifestEditorCueSchema = z
  .object({
    id: z.string().min(1),
    atMs: z.number().int().nonnegative(),
    target: cueTargetSchema,
    kind: z.literal("editor-action"),
    payload: editorPayloadSchema,
  })
  .strict();
const manifestNonEditorCueSchema = z
  .object({
    id: z.string().min(1),
    atMs: z.number().int().nonnegative(),
    target: cueTargetSchema,
    kind: cueNonEditorKindSchema,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

export const manifestCueSchema = z.discriminatedUnion("kind", [
  manifestEditorCueSchema,
  manifestNonEditorCueSchema,
]);

const controllerStatusSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("controller-status"),
    state: z.enum(["booting", "ready", "running", "blocked", "complete-awaiting-close"]),
    reason: z.string().regex(/^[a-z0-9-]{1,64}$/).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.state === "blocked" && event.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "blocked status requires a stable reason",
      });
    }
    if (event.state !== "blocked" && event.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is only valid for blocked status",
      });
    }
  });

const runtimeIdSchema = z.string().refine((value) => {
  const byteLength = textEncoder.encode(value).byteLength;
  return (
    byteLength >= 1 &&
    byteLength <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}, "runtime id must be 1 to 256 UTF-8 bytes without control characters");

const positiveSafeIntegerSchema = z
  .number()
  .refine(Number.isSafeInteger, "generation id must be a safe integer")
  .refine((value) => value > 0, "generation id must be positive");

const stableReasonSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "reason must be stable lower-case words");

const operatorActionEventSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("operator-action"),
    action: z.enum(["start", "restart-loop", "stop-show"]),
  })
  .strict();

const presentationAckEventSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("presentation-ack"),
    generationId: positiveSafeIntegerSchema,
    loopId: runtimeIdSchema,
    cueId: runtimeIdSchema,
  })
  .strict();

const rendererToControllerEventSchema = z.discriminatedUnion("type", [
  operatorActionEventSchema,
  presentationAckEventSchema,
]);

const runCueEventSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("run-cue"),
    generationId: positiveSafeIntegerSchema,
    loopId: runtimeIdSchema,
    requiresPresentationAck: z.boolean(),
    cue: manifestCueSchema,
  })
  .strict();

const runStatusEventSchema = z
  .object({
    schema: z.literal(1),
    type: z.literal("run-status"),
    generationId: positiveSafeIntegerSchema,
    state: z.enum([
      "booting",
      "ready",
      "running",
      "safe-cruise",
      "black-recovering",
      "safe-ready",
      "shutting-down",
      "stopped",
    ]),
    reason: stableReasonSchema.optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.state === "safe-ready" && event.reason === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "safe-ready status requires a stable reason",
      });
    }
    if (event.state !== "safe-ready" && event.reason !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "reason is only valid for safe-ready status",
      });
    }
  });

export function parseRendererToControllerEvent(value: unknown): RendererToControllerEvent {
  return rendererToControllerEventSchema.parse(value) as RendererToControllerEvent;
}

export function parseRendererEvent(value: unknown): RendererEvent {
  if (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
  ) {
    if (value.type === "controller-status") {
      return controllerStatusSchema.parse(value) as ControllerStatusEvent;
    }
    if (value.type === "run-cue") {
      return runCueEventSchema.parse(value) as RunCueEvent;
    }
    if (value.type === "run-status") {
      return runStatusEventSchema.parse(value) as RunStatusEvent;
    }
  }
  return manifestCueSchema.parse(value) as Cue;
}
