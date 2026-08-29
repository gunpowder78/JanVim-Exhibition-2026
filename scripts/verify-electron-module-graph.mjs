import { readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const controllerDistRoot = join(repositoryRoot, "apps", "controller", "dist", "src");
const adapterPaths = [
  join(controllerDistRoot, "g2-runtime-adapters.js"),
  join(controllerDistRoot, "show-runtime-adapters.js"),
];
const maximumGraphModules = 256;
const TypeScriptSourceExtension = /\.(?:ts|tsx|mts|cts)(?:[?#].*)?$/iu;
const staticImport =
  /(?:^|[;\n\r])\s*(?:import|export)\s+(?:(?:[^"'`;]|\r?\n)*?\s+from\s+)?["']([^"']+)["']/gu;
const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu;

function importedSpecifiers(source) {
  return [
    ...Array.from(source.matchAll(staticImport), (match) => match[1]),
    ...Array.from(source.matchAll(dynamicImport), (match) => match[1]),
  ];
}

function assertInsideControllerDist(path) {
  const pathFromRoot = relative(controllerDistRoot, path);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Emitted module escaped controller dist: ${path}`);
  }
}

function verifyEmittedGraph(entryPaths) {
  const pending = [...entryPaths];
  const visited = new Set();

  while (pending.length > 0) {
    const modulePath = resolve(pending.pop());
    assertInsideControllerDist(modulePath);
    if (visited.has(modulePath)) continue;
    if (visited.size >= maximumGraphModules) {
      throw new Error(`Emitted module graph exceeds ${maximumGraphModules} modules`);
    }
    visited.add(modulePath);

    const source = readFileSync(modulePath, "utf8");
    for (const specifier of importedSpecifiers(source)) {
      if (TypeScriptSourceExtension.test(specifier)) {
        throw new Error(
          `TypeScript source extension remains in emitted import: ${modulePath} -> ${specifier}`,
        );
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;

      const dependencyPath = resolve(dirname(modulePath), specifier);
      assertInsideControllerDist(dependencyPath);
      if ([".js", ".mjs", ".cjs"].includes(extname(dependencyPath).toLowerCase())) {
        pending.push(dependencyPath);
      }
    }
  }
}

verifyEmittedGraph(adapterPaths);

for (const adapterPath of adapterPaths) {
  await import(pathToFileURL(adapterPath).href);
}

process.stdout.write(
  `${JSON.stringify({
    schema: 1,
    status: "compiled-g2-and-show-module-graphs-verified",
  })}\n`,
);
