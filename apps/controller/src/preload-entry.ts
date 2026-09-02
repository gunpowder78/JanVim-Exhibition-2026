import { contextBridge, ipcRenderer } from "electron";

import { installPreload } from "./preload.js";

installPreload(contextBridge, ipcRenderer);
