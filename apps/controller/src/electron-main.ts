import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, screen } from "electron";

import { parseG2Command } from "./g2-command.js";
import { runElectronCommand } from "./electron-command.js";
import { runElectronLifecycle } from "./electron-lifecycle.js";
import {
  createElectronCommandAdapters,
  type G2BrowserWindowConstructor,
} from "./g2-runtime-adapters.js";
import {
  parseShowCommand,
  selectElectronCommandFamily,
} from "./show-command.js";
import { runShowElectronCommand } from "./show-electron-command.js";
import {
  controllerStartedAtUtc,
  createShowRuntimeAdapters,
  type ShowElectronAppAdapter,
} from "./show-runtime-adapters.js";

void runElectronLifecycle(
  app,
  async () => {
    try {
      const repositoryRoot = resolve(app.getAppPath(), "..", "..");
      const argv = process.argv.slice(2);
      const family = selectElectronCommandFamily(argv);
      if (family === "g2") {
        const command = parseG2Command(argv, repositoryRoot);
        return await runElectronCommand(
          command,
          createElectronCommandAdapters({
            repositoryRoot,
            BrowserWindow: BrowserWindow as unknown as G2BrowserWindowConstructor,
            ipcMain,
            screen,
          }),
        );
      }

      const command = parseShowCommand(argv, repositoryRoot);
      const startedAtUtc = controllerStartedAtUtc(process.getCreationTime());
      return await runShowElectronCommand(
        command,
        createShowRuntimeAdapters({
          repositoryRoot,
          BrowserWindow: BrowserWindow as unknown as G2BrowserWindowConstructor,
          ipcMain,
          screen,
          controllerProcess: {
            pid: process.pid,
            startedAtUtc,
            on: (event, listener) => process.on(event, listener),
            removeListener: (event, listener) =>
              process.removeListener(event, listener),
          },
          electronApp: app as unknown as ShowElectronAppAdapter,
        }),
      );
    } catch {
      return 1;
    }
  },
);
