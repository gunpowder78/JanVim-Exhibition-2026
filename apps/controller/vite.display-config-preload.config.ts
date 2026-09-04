import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type UserConfig } from "vite";

export const DISPLAY_CONFIG_PRELOAD_BUNDLE_NAME =
  "display-config-preload.cjs";

const controllerRoot = dirname(fileURLToPath(import.meta.url));

export function createDisplayConfigPreloadBuildConfig(
  outputDirectory = resolve(
    controllerRoot,
    "dist",
    "display-config-preload",
  ),
): UserConfig {
  return {
    build: {
      copyPublicDir: false,
      emptyOutDir: true,
      lib: {
        entry: resolve(
          controllerRoot,
          "src",
          "display-config-preload-entry.ts",
        ),
        fileName: () => DISPLAY_CONFIG_PRELOAD_BUNDLE_NAME,
        formats: ["cjs"],
      },
      minify: false,
      outDir: outputDirectory,
      reportCompressedSize: false,
      rollupOptions: {
        external: ["electron"],
        output: { codeSplitting: false },
      },
      target: "node22",
    },
  };
}

export default defineConfig(createDisplayConfigPreloadBuildConfig());
