import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: projectRoot,
  build: {
    outDir: "dist",
  },
});
