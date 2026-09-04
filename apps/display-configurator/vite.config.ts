import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(projectRoot, "index.html"),
        identify: resolve(projectRoot, "identify.html"),
      },
    },
  },
});
