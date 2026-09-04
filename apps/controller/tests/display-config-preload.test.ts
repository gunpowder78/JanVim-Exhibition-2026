import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import {
  CLOSE_IDENTIFY_CHANNEL,
  DISPLAY_CONFIG_PRELOAD_GLOBAL,
  IDENTIFY_CHANNEL,
  SAVE_DISPLAY_MAP_CHANNEL,
  SNAPSHOT_CHANNEL,
  createDisplayConfigPreloadApi,
  installDisplayConfigPreload,
  type DisplayConfigIpcRendererAdapter,
} from "../src/display-config-preload.ts";

class FakeIpc implements DisplayConfigIpcRendererAdapter {
  public readonly invocations: Array<{
    channel: string;
    payload: unknown;
  }> = [];

  public async invoke(channel: string, payload: unknown): Promise<unknown> {
    this.invocations.push({ channel, payload });
    if (channel === SNAPSHOT_CHANNEL) {
      return {
        topologySha256: TOKEN,
        displays: [],
        allowedModes: [],
      };
    }
    return { saved: true };
  }
}

const TOKEN = "a".repeat(64);
const FRAME_URL = `file:///display-configurator/index.html?topologySha256=${TOKEN}`;

describe("display configurator preload", () => {
  it("exposes only four fixed invoke methods under a dedicated global", async () => {
    const ipc = new FakeIpc();
    const api = createDisplayConfigPreloadApi(ipc, TOKEN);

    expect(DISPLAY_CONFIG_PRELOAD_GLOBAL).toBe("janvimDisplayConfigurator");
    expect(Object.keys(api).sort()).toEqual([
      "closeIdentifyDisplays",
      "getSnapshot",
      "identifyDisplays",
      "saveDisplayMap",
    ]);

    await api.getSnapshot();
    await api.identifyDisplays(TOKEN);
    await api.closeIdentifyDisplays(TOKEN);
    await api.saveDisplayMap({
      topologySha256: TOKEN,
      mode: "single-display-preview",
      bindings: [{ softId: "SCREEN-1", displayId: "display-A" }],
    });

    expect(ipc.invocations).toEqual([
      { channel: SNAPSHOT_CHANNEL, payload: { topologySha256: TOKEN } },
      { channel: IDENTIFY_CHANNEL, payload: { topologySha256: TOKEN } },
      {
        channel: CLOSE_IDENTIFY_CHANNEL,
        payload: { topologySha256: TOKEN },
      },
      {
        channel: SAVE_DISPLAY_MAP_CHANNEL,
        payload: {
          topologySha256: TOKEN,
          mode: "single-display-preview",
          bindings: [{ softId: "SCREEN-1", displayId: "display-A" }],
        },
      },
    ]);
  });

  it("requires the startup topology token before invoking any IPC", async () => {
    const ipc = new FakeIpc();

    expect(() => createDisplayConfigPreloadApi(ipc, "bad")).toThrow(/topology/i);
    expect(ipc.invocations).toHaveLength(0);
  });

  it("rejects malformed hashes, unknown fields, roles, modes, and unbounded bindings", async () => {
    const ipc = new FakeIpc();
    const api = createDisplayConfigPreloadApi(ipc, TOKEN);

    await expect(api.identifyDisplays("bad")).rejects.toThrow(/topology/i);
    await expect(api.closeIdentifyDisplays("f".repeat(65))).rejects.toThrow(
      /topology/i,
    );
    await expect(
      api.saveDisplayMap({
        topologySha256: TOKEN,
        mode: "automatic" as never,
        bindings: [],
      }),
    ).rejects.toThrow(/request|mode/i);
    await expect(
      api.saveDisplayMap({
        topologySha256: TOKEN,
        mode: "production-3",
        bindings: Array.from({ length: 17 }, (_, index) => ({
          softId: "SCREEN-1" as const,
          displayId: `display-${index}`,
        })),
      }),
    ).rejects.toThrow(/request|bindings/i);
    await expect(
      api.saveDisplayMap({
        topologySha256: TOKEN,
        mode: "single-display-preview",
        bindings: [
          {
            softId: "SCREEN-4" as never,
            displayId: "display-A",
            inferred: true,
          } as never,
        ],
      }),
    ).rejects.toThrow(/request|binding/i);

    expect(ipc.invocations).toHaveLength(0);
  });

  it("installs the API without altering the Narrative preload contract", () => {
    const exposed: Array<{ name: string; value: unknown }> = [];
    installDisplayConfigPreload(
      {
        exposeInMainWorld: (name, value) => exposed.push({ name, value }),
      },
      new FakeIpc(),
      FRAME_URL,
    );

    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.name).toBe(DISPLAY_CONFIG_PRELOAD_GLOBAL);
    expect(Object.keys(exposed[0]?.value as object).sort()).toEqual([
      "closeIdentifyDisplays",
      "getSnapshot",
      "identifyDisplays",
      "saveDisplayMap",
    ]);

    const narrative = readFileSync(
      join(process.cwd(), "apps", "controller", "src", "preload.ts"),
      "utf8",
    );
    expect(narrative).toContain('PRELOAD_GLOBAL = "janvimExhibition"');
    expect(narrative).not.toContain(DISPLAY_CONFIG_PRELOAD_GLOBAL);
  });

  it("builds one sandbox-compatible CommonJS bundle in its own output", async () => {
    const outputDirectory = mkdtempSync(
      join(tmpdir(), "janvim-display-config-preload-"),
    );
    try {
      const { DISPLAY_CONFIG_PRELOAD_BUNDLE_NAME, createDisplayConfigPreloadBuildConfig } =
        await import("../vite.display-config-preload.config.ts");
      await build({
        ...createDisplayConfigPreloadBuildConfig(outputDirectory),
        configFile: false,
        logLevel: "silent",
      });

      expect(readdirSync(outputDirectory)).toEqual([
        DISPLAY_CONFIG_PRELOAD_BUNDLE_NAME,
      ]);
      const bundle = readFileSync(
        join(outputDirectory, DISPLAY_CONFIG_PRELOAD_BUNDLE_NAME),
        "utf8",
      );
      expect(bundle).toMatch(/require\(["']electron["']\)/);
      expect(bundle).not.toMatch(/(^|\n)\s*import\s/m);

      const exposed: Array<{ name: string; value: unknown }> = [];
      runInNewContext(bundle, {
        Buffer,
        TextDecoder,
        TextEncoder,
        URL,
        process: { env: {}, type: "renderer", versions: {} },
        location: { href: FRAME_URL },
        require: (moduleName: string) => {
          if (moduleName !== "electron") {
            throw new Error(`unexpected preload import: ${moduleName}`);
          }
          return {
            contextBridge: {
              exposeInMainWorld: (name: string, value: unknown) =>
                exposed.push({ name, value }),
            },
            ipcRenderer: new FakeIpc(),
          };
        },
      });
      expect(exposed.map((entry) => entry.name)).toEqual([
        DISPLAY_CONFIG_PRELOAD_GLOBAL,
      ]);
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
