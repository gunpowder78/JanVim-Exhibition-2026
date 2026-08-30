import typescript from "../node_modules/typescript/lib/typescript.js";

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
const maximumAstNodesPerModule = maximumEmittedModuleBytes + 2;
const emittedExtensions = new Set([".js", ".mjs", ".cjs"]);
const TypeScriptSourceExtension = /\.(?:ts|tsx|mts|cts)(?:[?#].*)?$/iu;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function parseJavaScript(source, modulePath) {
  let sourceFile;
  try {
    sourceFile = typescript.createSourceFile(
      modulePath,
      source,
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.JS,
    );
  } catch (error) {
    throw new Error(`JavaScript parser failed: ${modulePath}: ${errorMessage(error)}`);
  }

  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const detail = typescript.flattenDiagnosticMessageText(
      diagnostic.messageText,
      " ",
    );
    throw new Error(`Malformed emitted JavaScript: ${modulePath}: ${detail}`);
  }
  return sourceFile;
}

function literalCallSpecifier(argument, modulePath, kind) {
  if (argument === undefined || !typescript.isStringLiteralLike(argument)) {
    throw new Error(`Unsupported ambiguous ${kind}: ${modulePath}`);
  }
  return argument.text;
}

function discoverModuleSpecifiers(source, modulePath) {
  const sourceFile = parseJavaScript(source, modulePath);
  const pending = [sourceFile];
  const specifiers = [];
  let nodeCount = 1;

  while (pending.length > 0) {
    const node = pending.pop();

    if (typescript.isImportDeclaration(node)) {
      if (!typescript.isStringLiteral(node.moduleSpecifier)) {
        throw new Error(
          `Malformed emitted JavaScript: ${modulePath}: import module specifier is not a string`,
        );
      }
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      typescript.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined
    ) {
      if (!typescript.isStringLiteral(node.moduleSpecifier)) {
        throw new Error(
          `Malformed emitted JavaScript: ${modulePath}: export module specifier is not a string`,
        );
      }
      specifiers.push(node.moduleSpecifier.text);
    } else if (typescript.isCallExpression(node)) {
      if (node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
        specifiers.push(
          literalCallSpecifier(node.arguments[0], modulePath, "dynamic import"),
        );
      } else if (
        typescript.isIdentifier(node.expression) &&
        node.expression.text === "require"
      ) {
        specifiers.push(
          literalCallSpecifier(node.arguments[0], modulePath, "require"),
        );
      }
    }

    const children = [];
    try {
      typescript.forEachChild(node, (child) => {
        if (nodeCount >= maximumAstNodesPerModule) {
          throw new Error(
            `JavaScript AST exceeds ${maximumAstNodesPerModule} nodes: ${modulePath}`,
          );
        }
        nodeCount += 1;
        children.push(child);
      });
    } catch (error) {
      throw new Error(
        `JavaScript AST traversal failed: ${modulePath}: ${errorMessage(error)}`,
      );
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  return specifiers;
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
    for (const specifier of discoverModuleSpecifiers(source, modulePath)) {
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

async function main() {
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
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
