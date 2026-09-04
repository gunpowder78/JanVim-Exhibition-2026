import {
  CLOSE_IDENTIFY_CHANNEL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
  parseConfigurationSnapshot,
  parseSaveDisplayMapRequest,
  parseTopologyRequest,
  type ConfigurationSnapshot,
  type SaveDisplayMapRequest,
} from "./display-config-ipc-contract.js";

export {
  CLOSE_IDENTIFY_CHANNEL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
};

export const DISPLAY_CONFIG_PRELOAD_GLOBAL = "janvimDisplayConfigurator";

export interface DisplayConfigIpcRendererAdapter {
  invoke(channel: string, payload: unknown): Promise<unknown>;
}

export interface DisplayConfigContextBridgeAdapter {
  exposeInMainWorld(name: string, value: unknown): void;
}

export interface DisplayConfigPreloadApi {
  getSnapshot(): Promise<ConfigurationSnapshot>;
  identifyDisplays(topologySha256: string): Promise<void>;
  closeIdentifyDisplays(topologySha256: string): Promise<void>;
  saveDisplayMap(request: SaveDisplayMapRequest): Promise<void>;
}

export function createDisplayConfigPreloadApi(
  ipc: DisplayConfigIpcRendererAdapter,
  topologySha256: string,
): DisplayConfigPreloadApi {
  const snapshotRequest = parseTopologyRequest({ topologySha256 });
  const api: DisplayConfigPreloadApi = {
    getSnapshot: async () =>
      parseConfigurationSnapshot(
        await ipc.invoke(SNAPSHOT_CHANNEL, snapshotRequest),
      ),
    identifyDisplays: async (topologySha256: string) => {
      const request = parseTopologyRequest({ topologySha256 });
      await ipc.invoke(IDENTIFY_CHANNEL, request);
    },
    closeIdentifyDisplays: async (topologySha256: string) => {
      const request = parseTopologyRequest({ topologySha256 });
      await ipc.invoke(CLOSE_IDENTIFY_CHANNEL, request);
    },
    saveDisplayMap: async (request: SaveDisplayMapRequest) => {
      await ipc.invoke(
        SAVE_DISPLAY_MAP_CHANNEL,
        parseSaveDisplayMapRequest(request),
      );
    },
  };
  return Object.freeze(api);
}

export function installDisplayConfigPreload(
  contextBridge: DisplayConfigContextBridgeAdapter,
  ipc: DisplayConfigIpcRendererAdapter,
  frameUrl: string,
): void {
  const topologySha256 = new URL(frameUrl).searchParams.get("topologySha256");
  if (topologySha256 === null) {
    throw new Error("Display configurator topology token is missing");
  }
  contextBridge.exposeInMainWorld(
    DISPLAY_CONFIG_PRELOAD_GLOBAL,
    createDisplayConfigPreloadApi(ipc, topologySha256),
  );
}
