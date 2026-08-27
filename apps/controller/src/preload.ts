import { z } from "zod";

import type { Cue } from "@janvim-exhibition/show-schema";

export const PRELOAD_GLOBAL = "janvimExhibition";
export const SHOW_EVENT_CHANNEL = "janvim-exhibition:show-event";
export const REQUEST_START_CHANNEL = "janvim-exhibition:request-start";

export interface IpcRendererAdapter {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  send(channel: string, payload: unknown): void;
}

export interface ContextBridgeAdapter {
  exposeInMainWorld(name: string, value: unknown): void;
}

export interface SecondaryPreloadApi {
  onShowEvent(listener: (cue: Cue) => void): () => void;
  requestStart(): void;
}

const safeText = z.string().refine(
  (value) => new TextEncoder().encode(value).byteLength <= 512,
  "text exceeds 512 UTF-8 bytes",
);

const editorActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("move"),
    keys: z.enum(["h", "j", "k", "l", "w", "b", "e", "0", "$", "G"]),
    repeat: z.number().int().min(0).max(256),
  }).strict(),
  z.object({
    type: z.literal("insert"),
    text: safeText,
    charsPerSecond: z.number().min(0).max(1_000),
  }).strict(),
  z.object({ type: z.literal("select"), rangeId: z.string().min(1) }).strict(),
  z.object({ type: z.literal("replace"), rangeId: z.string().min(1), text: safeText }).strict(),
  z.object({ type: z.literal("escape") }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);

const cueBase = {
  id: z.string().min(1),
  atMs: z.number().int().nonnegative(),
  target: z.enum(["main", "secondary", "both"]),
};

const rendererCueSchema = z.discriminatedUnion("kind", [
  z.object({
    ...cueBase,
    kind: z.literal("editor-action"),
    payload: z.object({
      action: editorActionSchema,
      displayKeys: z.array(z.string()).min(1),
      semanticLabel: z.string().min(1),
      critical: z.literal(true),
    }).strict(),
  }).strict(),
  z.object({
    ...cueBase,
    kind: z.enum(["prompt", "token-stream", "formula", "matrix", "image", "key-overlay", "fade"]),
    payload: z.record(z.string(), z.unknown()),
  }).strict(),
]);

export function createPreloadApi(ipc: IpcRendererAdapter): SecondaryPreloadApi {
  return {
    onShowEvent: (listener) => {
      let subscribed = true;
      const wrapped = (_event: unknown, payload: unknown): void => {
        const parsed = rendererCueSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data as Cue);
      };
      ipc.on(SHOW_EVENT_CHANNEL, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(SHOW_EVENT_CHANNEL, wrapped);
      };
    },
    requestStart: () => {
      ipc.send(REQUEST_START_CHANNEL, { schema: 1, source: "local-ready-page" });
    },
  };
}

export function installPreload(
  contextBridge: ContextBridgeAdapter,
  ipc: IpcRendererAdapter,
): void {
  contextBridge.exposeInMainWorld(PRELOAD_GLOBAL, createPreloadApi(ipc));
}
