import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const controllerDistRoot = join(repositoryRoot, "apps", "controller", "dist", "src");
const electronMainPath = join(controllerDistRoot, "electron-main.js");
const adapterPaths = [
  join(controllerDistRoot, "g2-runtime-adapters.js"),
  join(controllerDistRoot, "show-runtime-adapters.js"),
];
const maximumGraphModules = 256;
const maximumEmittedModuleBytes = 16 * 1024 * 1024;
const emittedExtensions = new Set([".js", ".mjs", ".cjs"]);
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

function assertInsideRoot(path, root) {
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Emitted module escaped controller dist: ${path}`);
  }
}

function pathKey(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function canonicalPath(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing emitted local module: ${path}`);
  }
  return realpathSync.native(path);
}

function readBoundedModule(path) {
  const descriptor = openSync(path, "r");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes <= maximumEmittedModuleBytes) {
      const remainingBytes = maximumEmittedModuleBytes + 1 - totalBytes;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingBytes));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  if (totalBytes < 1 || totalBytes > maximumEmittedModuleBytes) {
    throw new Error(`Emitted module size is outside the finite bound: ${path}`);
  }
  return Buffer.concat(chunks, totalBytes);
}

function verifyEmittedGraph(entryPath) {
  const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
  const canonicalControllerDistRoot = realpathSync.native(controllerDistRoot);
  const pending = [entryPath];
  const visited = new Set();
  const lexicalPathByCanonicalPath = new Map();
  const files = [];

  while (pending.length > 0) {
    const requestedPath = resolve(pending.pop());
    assertInsideRoot(requestedPath, controllerDistRoot);
    if (!emittedExtensions.has(extname(requestedPath).toLowerCase())) {
      throw new Error(`Unsupported emitted local module extension: ${requestedPath}`);
    }
    const modulePath = canonicalPath(requestedPath);
    assertInsideRoot(modulePath, canonicalControllerDistRoot);
    const canonicalKey = pathKey(modulePath);
    const lexicalKey = pathKey(requestedPath);
    const priorLexicalPath = lexicalPathByCanonicalPath.get(canonicalKey);
    if (priorLexicalPath !== undefined && priorLexicalPath !== lexicalKey) {
      throw new Error(
        `Duplicate canonical emitted module path: ${requestedPath} -> ${modulePath}`,
      );
    }
    lexicalPathByCanonicalPath.set(canonicalKey, lexicalKey);
    if (visited.has(canonicalKey)) continue;
    if (visited.size >= maximumGraphModules) {
      throw new Error(`Emitted module graph exceeds ${maximumGraphModules} modules`);
    }
    visited.add(canonicalKey);

    const bytes = readBoundedModule(modulePath);
    const source = bytes.toString("utf8");
    files.push({
      relativePath: relative(canonicalRepositoryRoot, modulePath).split(sep).join("/"),
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    for (const specifier of importedSpecifiers(source)) {
      if (TypeScriptSourceExtension.test(specifier)) {
        throw new Error(
          `TypeScript source extension remains in emitted import: ${modulePath} -> ${specifier}`,
        );
      }
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue;

      const dependencyPath = resolve(dirname(modulePath), specifier);
      assertInsideRoot(dependencyPath, canonicalControllerDistRoot);
      if (!emittedExtensions.has(extname(dependencyPath).toLowerCase())) {
        throw new Error(
          `Unsupported emitted local module extension: ${modulePath} -> ${specifier}`,
        );
      }
      pending.push(dependencyPath);
    }
  }

  return files.sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
}

const files = verifyEmittedGraph(electronMainPath);

for (const adapterPath of adapterPaths) {
  await import(pathToFileURL(adapterPath).href);
}

process.stdout.write(
  `${JSON.stringify({
    schema: 1,
    status: "compiled-electron-main-graph-verified",
    files,
  })}\n`,
);
