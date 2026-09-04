import { contextBridge, ipcRenderer } from "electron";

import { installDisplayConfigPreload } from "./display-config-preload.js";

installDisplayConfigPreload(contextBridge, ipcRenderer, globalThis.location.href);
