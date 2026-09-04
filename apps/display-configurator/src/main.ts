import { mountDisplayConfigurator } from "./model.js";
import "./styles.css";

declare global {
  interface Window {
    janvimDisplayConfigurator?: Parameters<typeof mountDisplayConfigurator>[1];
  }
}

const api = window.janvimDisplayConfigurator;
if (api === undefined) {
  throw new Error("Display configurator preload API is unavailable");
}

void mountDisplayConfigurator(document, api);
