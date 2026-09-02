import {
  parseRendererEvent,
  parseRendererToControllerEvent,
  type RendererEvent,
  type RendererToControllerEvent,
} from "@janvim-exhibition/show-schema/renderer-event";

export const PRELOAD_GLOBAL = "janvimExhibition";
export const SHOW_EVENT_CHANNEL = "janvim-exhibition:show-event";
export const RENDERER_EVENT_CHANNEL = "janvim-exhibition:renderer-event";

export interface IpcRendererAdapter {
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  send(channel: string, payload: unknown): void;
}

export interface ContextBridgeAdapter {
  exposeInMainWorld(name: string, value: unknown): void;
}

export interface SecondaryPreloadApi {
  onShowEvent(listener: (event: RendererEvent) => void): () => void;
  sendRendererEvent(event: RendererToControllerEvent): void;
}

export function createPreloadApi(ipc: IpcRendererAdapter): SecondaryPreloadApi {
  return {
    onShowEvent: (listener) => {
      let subscribed = true;
      const wrapped = (_event: unknown, payload: unknown): void => {
        try {
          listener(parseRendererEvent(payload));
        } catch {
          // Invalid renderer payloads fail closed at the preload boundary.
        }
      };
      ipc.on(SHOW_EVENT_CHANNEL, wrapped);
      return () => {
        if (!subscribed) return;
        subscribed = false;
        ipc.removeListener(SHOW_EVENT_CHANNEL, wrapped);
      };
    },
    sendRendererEvent: (event) => {
      ipc.send(RENDERER_EVENT_CHANNEL, parseRendererToControllerEvent(event));
    },
  };
}

export function installPreload(
  contextBridge: ContextBridgeAdapter,
  ipc: IpcRendererAdapter,
): void {
  contextBridge.exposeInMainWorld(PRELOAD_GLOBAL, createPreloadApi(ipc));
}
