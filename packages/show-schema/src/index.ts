import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import { z } from "zod";

import {
  editorActionSchema,
  manifestCueSchema,
} from "./renderer-event.js";
import type { Cue, EditorAction } from "./renderer-event.js";

export { parseAgentCursorObservation } from "./agent-cursor.js";
export type { AgentCursorObservation } from "./agent-cursor.js";

export {
  parseRendererEvent,
  parseRendererToControllerEvent,
} from "./renderer-event.js";
export type {
  ControllerStatusEvent,
  Cue,
  CueKind,
  CueTarget,
  EditorAction,
  EditorPayload,
  OperatorAction,
  RendererEvent,
  RendererToControllerEvent,
  RunCueEvent,
  RunStatusEvent,
} from "./renderer-event.js";

export type ShowManifest = {
  schema: 1;
  loopId: string;
  loopDurationMs: number;
  poemSha256: string;
  contentRevision: string;
  preparedBy: string;
  cues: Cue[];
};

export type AgentCommand =
  | {
      schema: 1;
      token: string;
      loopId: string;
      cueId: string;
      action: EditorAction;
    }
  | {
      schema: 1;
      token: string;
      loopId: string;
      cueId: string;
      action: {
        type: "prepare";
        poem: string;
        expectedSha256: string;
      };
    }
  | {
      schema: 1;
      token: string;
      loopId: string;
      cueId: string;
      action: { type: "status" };
    }
  | {
      schema: 1;
      token: string;
      loopId: string;
      cueId: string;
      action: { type: "shutdown" };
    };

export type AgentAck = {
  schema: 1;
  loopId: string;
  cueId: string;
  outcome: "applied" | "duplicate" | "rejected" | "failed";
  mode: string;
  cursor: { row: number; col: number };
  bufferSha256: string;
  errorCode?: string;
};

const hashRegex = /^[0-9a-f]{64}$/;
const tokenRegex = /^[A-Za-z0-9._-]{16,}$/;

const sha256Schema = z.string().regex(hashRegex, "hash must be 64 lowercase hexadecimal");

const manifestSchema = z
  .object({
    schema: z.literal(1),
    loopId: z.string().min(1),
    loopDurationMs: z.number().int().positive(),
    poemSha256: sha256Schema,
    contentRevision: z.string().min(1),
    preparedBy: z.string().min(1),
    cues: z.array(manifestCueSchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();

    let previousAtMs = -1;
    let editorActionCount = 0;

    for (const cue of manifest.cues) {
      if (seen.has(cue.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cues"],
          message: `cue id must be unique: ${cue.id}`,
        });
      }
      seen.add(cue.id);

      if (cue.atMs < previousAtMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cues", String(cue.id), "atMs"],
          message: "atMs must be non-decreasing",
        });
      }
      previousAtMs = cue.atMs;

      if (cue.kind === "editor-action") {
        editorActionCount += 1;

        const action = cue.payload.action;
        if (action.type === "insert" && Buffer.byteLength(action.text, "utf8") > 512) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cues", cue.id, "payload", "action", "text"],
            message: "insert text must be at most 512 bytes",
          });
        }

        if (action.type === "replace" && Buffer.byteLength(action.text, "utf8") > 512) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["cues", cue.id, "payload", "action", "text"],
            message: "insert text must be at most 512 bytes",
          });
          return;
        }
      }
    }

    if (editorActionCount > 256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cues"],
        message: "must not exceed 256 editor-action cues per loop",
      });
    }

    const last = manifest.cues[manifest.cues.length - 1];
    if (last.kind !== "editor-action" || last.payload.action.type !== "reset") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cues", manifest.cues.length - 1],
        message: "final cue must be editor-action reset",
      });
    }

    if (last.atMs > manifest.loopDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cues", manifest.cues.length - 1, "atMs"],
        message: "reset cue must be within loop duration",
      });
    }
  });

const prepareActionSchema = z
  .object({
    type: z.literal("prepare"),
    poem: z.string().min(1),
    expectedSha256: sha256Schema,
  })
  .strict();

const commandActionSchema = z.discriminatedUnion("type", [
  editorActionSchema,
  prepareActionSchema,
  z.object({ type: z.literal("status") }).strict(),
  z.object({ type: z.literal("shutdown") }).strict(),
]);

const agentCommandPayloadSchema = z
  .object({
    schema: z.literal(1),
    token: z.string().regex(tokenRegex, "token format is invalid"),
    loopId: z.string().min(1),
    cueId: z.string().min(1),
    action: commandActionSchema,
  })
  .strict();

const agentAckSchema = z
  .object({
    schema: z.literal(1),
    loopId: z.string().min(1),
    cueId: z.string().min(1),
    outcome: z.enum(["applied", "duplicate", "rejected", "failed"]),
    mode: z.string().min(1),
    cursor: z
      .object({
        row: z.number().int().nonnegative(),
        col: z.number().int().nonnegative(),
      })
      .strict(),
    bufferSha256: sha256Schema,
    errorCode: z.string().optional(),
  })
  .strict();

const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseShowManifest(value: unknown): ShowManifest {
  return manifestSchema.parse(value) as ShowManifest;
}

export function parseAgentCommand(
  value: unknown,
  listenHost: string,
): AgentCommand {
  if (listenHost !== "127.0.0.1") {
    throw new Error("Agent command listener must bind to 127.0.0.1");
  }

  return agentCommandPayloadSchema.parse(value) as AgentCommand;
}

export function parseAgentCommandFromBytes(bytes: Uint8Array, listenHost: string): AgentCommand {
  if (bytes.byteLength > 4096) {
    throw new Error("NDJSON line exceeds 4096 bytes");
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (_err) {
    throw new Error("invalid UTF-8 payload");
  }

  return parseAgentCommand(JSON.parse(text), listenHost);
}

export function parseAgentAck(value: unknown): AgentAck {
  return agentAckSchema.parse(value);
}

export function redactToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 8);
}
