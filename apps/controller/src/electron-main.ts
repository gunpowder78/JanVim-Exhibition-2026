import { resolve } from "node:path";

import { app, BrowserWindow, ipcMain, screen } from "electron";

import { parseG2Command } from "./g2-command.js";
import { runElectronCommand } from "./electron-command.js";
import { runElectronLifecycle } from "./electron-lifecycle.js";
import {
  createElectronCommandAdapters,
  type G2BrowserWindowConstructor,
} from "./g2-runtime-adapters.js";

void runElectronLifecycle(
  app,
  async () => {
    try {
      const repositoryRoot = resolve(app.getAppPath(), "..", "..");
      const command = parseG2Command(process.argv.slice(2), repositoryRoot);
      return await runElectronCommand(
        command,
        createElectronCommandAdapters({
          repositoryRoot,
          BrowserWindow: BrowserWindow as unknown as G2BrowserWindowConstructor,
          ipcMain,
          screen,
        }),
      );
    } catch {
      return 1;
    }
  },
);
