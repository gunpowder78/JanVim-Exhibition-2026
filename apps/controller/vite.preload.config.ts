import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type UserConfig } from "vite";

export const PRELOAD_BUNDLE_NAME = "preload.cjs";

const controllerRoot = dirname(fileURLToPath(import.meta.url));

export function createPreloadBuildConfig(
  outputDirectory = resolve(controllerRoot, "dist", "preload"),
): UserConfig {
  return {
    build: {
      copyPublicDir: false,
      emptyOutDir: true,
      lib: {
        entry: resolve(controllerRoot, "src", "preload-entry.ts"),
        fileName: () => PRELOAD_BUNDLE_NAME,
        formats: ["cjs"],
      },
      minify: false,
      outDir: outputDirectory,
      reportCompressedSize: false,
      rollupOptions: {
        external: ["electron"],
        output: {
          codeSplitting: false,
        },
      },
      target: "node22",
    },
  };
}

export default defineConfig(createPreloadBuildConfig());
