import { join } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const adapterPath = join(
  repositoryRoot,
  "apps",
  "controller",
  "dist",
  "src",
  "g2-runtime-adapters.js",
);

await import(pathToFileURL(adapterPath).href);
process.stdout.write(
  `${JSON.stringify({ schema: 1, status: "compiled-g2-module-graph-verified" })}\n`,
);
