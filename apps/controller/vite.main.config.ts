import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const controllerRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: true,
    lib: {
      entry: resolve(controllerRoot, "src", "electron-main.ts"),
      fileName: () => "electron-main.js",
      formats: ["es"],
    },
    minify: false,
    outDir: resolve(controllerRoot, "dist", "main"),
    reportCompressedSize: false,
    rollupOptions: {
      external: (specifier) => {
        if (specifier === "electron") return true;
        if (specifier.startsWith("node:")) {
          if (!isBuiltin(specifier)) {
            throw new Error(`invalid node builtin import: ${specifier}`);
          }
          return true;
        }
        return false;
      },
      output: {
        codeSplitting: false,
      },
    },
    sourcemap: false,
    target: "node22",
  },
});
