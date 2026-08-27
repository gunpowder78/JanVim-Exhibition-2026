import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { build } from "vite";

import type { Cue } from "../../../packages/show-schema/src/index";
import {
  PRELOAD_GLOBAL,
  REQUEST_START_CHANNEL,
  SHOW_EVENT_CHANNEL,
  createPreloadApi,
  installPreload,
  type IpcRendererAdapter,
} from "../src/preload.ts";

class FakeIpc implements IpcRendererAdapter {
  public readonly listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();
  public readonly sends: Array<{ channel: string; payload: unknown }> = [];

  public on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  public removeListener(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }

  public send(channel: string, payload: unknown): void {
    this.sends.push({ channel, payload });
  }

  public emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener({}, payload);
  }
}

const cue: Cue = {
  id: "cue-preload",
  atMs: 100,
  target: "secondary",
  kind: "prompt",
  payload: { text: "已校验 cue" },
};

describe("secondary preload contract", () => {
  it("exposes only fixed onShowEvent and requestStart methods", () => {
    const api = createPreloadApi(new FakeIpc());
    expect(Object.keys(api).sort()).toEqual(["onShowEvent", "requestStart"]);
    expect(SHOW_EVENT_CHANNEL).toBe("janvim-exhibition:show-event");
    expect(REQUEST_START_CHANNEL).toBe("janvim-exhibition:request-start");
  });

  it("validates each cue before delivery and unregisters the exact wrapped listener", () => {
    const ipc = new FakeIpc();
    const api = createPreloadApi(ipc);
    const received: Cue[] = [];
    const unsubscribe = api.onShowEvent((value) => received.push(value));

    ipc.emit(SHOW_EVENT_CHANNEL, cue);
    ipc.emit(SHOW_EVENT_CHANNEL, { ...cue, kind: "shell", payload: { command: "calc.exe" } });
    expect(received).toEqual([cue]);
    expect(ipc.listeners.get(SHOW_EVENT_CHANNEL)?.size).toBe(1);

    unsubscribe();
    expect(ipc.listeners.get(SHOW_EVENT_CHANNEL)?.size).toBe(0);
    ipc.emit(SHOW_EVENT_CHANNEL, cue);
    expect(received).toEqual([cue]);
  });

  it("sends only a fixed local start request with no caller-controlled payload", () => {
    const ipc = new FakeIpc();
    const api = createPreloadApi(ipc);

    api.requestStart();

    expect(ipc.sends).toEqual([
      {
        channel: REQUEST_START_CHANNEL,
        payload: { schema: 1, source: "local-ready-page" },
      },
    ]);
  });

  it("installs the narrow API under one fixed global name", () => {
    const exposed: Array<{ name: string; value: unknown }> = [];
    installPreload(
      {
        exposeInMainWorld: (name, value) => exposed.push({ name, value }),
      },
      new FakeIpc(),
    );

    expect(PRELOAD_GLOBAL).toBe("janvimExhibition");
    expect(exposed).toHaveLength(1);
    expect(exposed[0]?.name).toBe(PRELOAD_GLOBAL);
    expect(Object.keys(exposed[0]?.value as object).sort()).toEqual(["onShowEvent", "requestStart"]);
  });

  it("builds one sandbox-compatible CommonJS preload with no ESM imports", async () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), "janvim-exhibition-preload-"));
    try {
      const { PRELOAD_BUNDLE_NAME, createPreloadBuildConfig } = await import(
        "../vite.preload.config.ts"
      );
      await build({
        ...createPreloadBuildConfig(outputDirectory),
        configFile: false,
        logLevel: "silent",
      });

      expect(readdirSync(outputDirectory)).toEqual([PRELOAD_BUNDLE_NAME]);
      const bundle = readFileSync(join(outputDirectory, PRELOAD_BUNDLE_NAME), "utf8");
      expect(bundle).toMatch(/require\(["']electron["']\)/);
      expect(bundle).not.toMatch(/(^|\n)\s*import\s/m);
      expect(bundle).not.toContain('import("electron")');

      const exposed: Array<{ name: string; value: unknown }> = [];
      runInNewContext(bundle, {
        Buffer,
        TextDecoder,
        TextEncoder,
        clearImmediate,
        process: { env: {}, type: "renderer", versions: {} },
        require: (moduleName: string) => {
          if (moduleName !== "electron") throw new Error(`unexpected preload import: ${moduleName}`);
          return {
            contextBridge: {
              exposeInMainWorld: (name: string, value: unknown) => exposed.push({ name, value }),
            },
            ipcRenderer: new FakeIpc(),
          };
        },
        setImmediate,
      });
      expect(exposed).toHaveLength(1);
      expect(exposed[0]?.name).toBe(PRELOAD_GLOBAL);
    } finally {
      rmSync(outputDirectory, { force: true, recursive: true });
    }
  });

  it("includes the sandbox preload bundle in the production build", () => {
    const rootPackage = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const controllerPackage = JSON.parse(
      readFileSync(join(process.cwd(), "apps", "controller", "package.json"), "utf8"),
    ) as { main?: string; scripts?: Record<string, string> };

    expect(rootPackage.scripts?.build).toContain("apps/controller/vite.preload.config.ts");
    expect(controllerPackage.scripts?.build).toContain("vite.preload.config.ts");
    expect(controllerPackage.main).toBe("dist/src/main.js");
  });
});
