import typescript from "../node_modules/typescript/lib/typescript.js";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { isAbsolute, join, relative, sep } from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const mainDistRoot = join(repositoryRoot, "apps", "controller", "dist", "main");
const electronMainPath = join(mainDistRoot, "electron-main.js");
const electronMainRelativePath =
  "apps/controller/dist/main/electron-main.js";
const maximumBundleBytes = 16 * 1024 * 1024;
const maximumAstNodes = maximumBundleBytes + 2;
const maximumRuntimeImports = 64;
const maximumRuntimeImportCharacters = 128;
const maximumConstantStringDepth = 8;
const maximumConstantStringNodes = 32;
const maximumConstantStringBytes = 128;
const dangerousDynamicLoaderNames = new Set([
  "createRequire",
  "eval",
  "getBuiltinModule",
  "require",
]);

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertInsideRoot(path, root) {
  const pathFromRoot = relative(root, path);
  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Electron-main bundle escaped dist/main: ${path}`);
  }
}

function readBoundedBundle(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing Electron-main bundle: ${path}`);
  }
  const descriptor = openSync(path, "r");
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes <= maximumBundleBytes) {
      const remainingBytes = maximumBundleBytes + 1 - totalBytes;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remainingBytes));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.byteLength, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      totalBytes += bytesRead;
    }
  } finally {
    closeSync(descriptor);
  }
  if (totalBytes < 1 || totalBytes > maximumBundleBytes) {
    throw new Error(
      `Electron-main bundle size is outside the finite bound: ${path}`,
    );
  }
  return Buffer.concat(chunks, totalBytes);
}

function parseJavaScript(source, modulePath) {
  const sourceFile = typescript.createSourceFile(
    modulePath,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    const diagnostic = sourceFile.parseDiagnostics[0];
    const detail = typescript.flattenDiagnosticMessageText(
      diagnostic.messageText,
      " ",
    );
    throw new Error(`Malformed Electron-main bundle: ${detail}`);
  }
  return sourceFile;
}

function addRuntimeImport(runtimeImports, specifier) {
  if (
    typeof specifier !== "string" ||
    specifier.length < 1 ||
    specifier.length > maximumRuntimeImportCharacters
  ) {
    throw new Error("Electron-main runtime import is outside the finite bound");
  }
  if (specifier === "electron") {
    runtimeImports.add(specifier);
    return;
  }
  if (specifier.startsWith("node:") && isBuiltin(specifier)) {
    runtimeImports.add(specifier);
    return;
  }
  throw new Error(`Unsupported Electron-main runtime import: ${specifier}`);
}

function evaluateConstantString(node) {
  let evaluatedNodes = 0;

  function evaluate(candidate, depth) {
    evaluatedNodes += 1;
    if (
      depth > maximumConstantStringDepth ||
      evaluatedNodes > maximumConstantStringNodes
    ) {
      throw new Error(
        "Electron-main constant string expression exceeds the finite bound",
      );
    }

    let value;
    if (typescript.isStringLiteralLike(candidate)) {
      value = candidate.text;
    } else if (typescript.isParenthesizedExpression(candidate)) {
      value = evaluate(candidate.expression, depth + 1);
    } else if (typescript.isTemplateExpression(candidate)) {
      evaluatedNodes += 1 + candidate.templateSpans.length * 2;
      if (evaluatedNodes > maximumConstantStringNodes) {
        throw new Error(
          "Electron-main constant string expression exceeds the finite bound",
        );
      }
      value = candidate.head.text;
      for (const span of candidate.templateSpans) {
        const substitution = evaluate(span.expression, depth + 1);
        if (substitution === undefined) return undefined;
        value += substitution + span.literal.text;
      }
    } else if (
      typescript.isBinaryExpression(candidate) &&
      candidate.operatorToken.kind === typescript.SyntaxKind.PlusToken
    ) {
      const left = evaluate(candidate.left, depth + 1);
      const right = evaluate(candidate.right, depth + 1);
      if (left === undefined || right === undefined) return undefined;
      value = left + right;
    } else {
      return undefined;
    }

    if (Buffer.byteLength(value, "utf8") > maximumConstantStringBytes) {
      throw new Error(
        "Electron-main constant string exceeds the finite byte bound",
      );
    }
    return value;
  }

  return evaluate(node, 0);
}

function dangerousDynamicLoaderName(node) {
  if (
    typescript.isIdentifier(node) &&
    dangerousDynamicLoaderNames.has(node.text)
  ) {
    return node.text;
  }
  if (
    typescript.isPropertyAccessExpression(node) &&
    dangerousDynamicLoaderNames.has(node.name.text)
  ) {
    return node.name.text;
  }
  if (typescript.isElementAccessExpression(node)) {
    const propertyName = evaluateConstantString(node.argumentExpression);
    if (dangerousDynamicLoaderNames.has(propertyName)) return propertyName;
  }
  return undefined;
}

function isReflectGetCall(node) {
  return (
    typescript.isCallExpression(node) &&
    node.arguments.length >= 2 &&
    typescript.isPropertyAccessExpression(node.expression) &&
    typescript.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Reflect" &&
    node.expression.name.text === "get"
  );
}

function isProcessOrModuleLoaderTarget(node) {
  if (typescript.isParenthesizedExpression(node)) {
    return isProcessOrModuleLoaderTarget(node.expression);
  }
  if (
    typescript.isIdentifier(node) &&
    (node.text === "process" || node.text === "module")
  ) {
    return true;
  }
  return (
    typescript.isCallExpression(node) &&
    dangerousDynamicLoaderName(node.expression) !== undefined
  );
}

function dangerousReflectGetLoaderName(node) {
  if (!isReflectGetCall(node)) return undefined;
  const propertyName = evaluateConstantString(node.arguments[1]);
  if (dangerousDynamicLoaderNames.has(propertyName)) return propertyName;
  if (isProcessOrModuleLoaderTarget(node.arguments[0])) {
    return "Reflect.get process/module loader target";
  }
  return undefined;
}

function assertNoDynamicLoaderBypass(node) {
  const dangerousName =
    dangerousDynamicLoaderName(node) ?? dangerousReflectGetLoaderName(node);
  if (dangerousName !== undefined) {
    throw new Error(
      `Unsupported Electron-main dynamic loader reference: ${dangerousName}`,
    );
  }
}

function inspectRuntimeImports(source, modulePath) {
  const sourceFile = parseJavaScript(source, modulePath);
  const pending = [sourceFile];
  const runtimeImports = new Set();
  let nodeCount = 1;

  while (pending.length > 0) {
    const node = pending.pop();
    assertNoDynamicLoaderBypass(node);
    if (typescript.isImportDeclaration(node)) {
      if (!typescript.isStringLiteral(node.moduleSpecifier)) {
        throw new Error("Electron-main import specifier is not a string");
      }
      addRuntimeImport(runtimeImports, node.moduleSpecifier.text);
    } else if (
      typescript.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined
    ) {
      if (!typescript.isStringLiteral(node.moduleSpecifier)) {
        throw new Error("Electron-main export specifier is not a string");
      }
      addRuntimeImport(runtimeImports, node.moduleSpecifier.text);
    } else if (typescript.isCallExpression(node)) {
      if (node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
        throw new Error("Unsupported Electron-main dynamic import");
      }
    }

    const children = [];
    typescript.forEachChild(node, (child) => {
      if (nodeCount >= maximumAstNodes) {
        throw new Error(
          `Electron-main AST exceeds ${maximumAstNodes} nodes`,
        );
      }
      nodeCount += 1;
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }

  const sorted = [...runtimeImports].sort();
  if (sorted.length < 1 || sorted.length > maximumRuntimeImports) {
    throw new Error("Electron-main runtime import count is outside the finite bound");
  }
  return sorted;
}

function verifyBundle() {
  const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
  const canonicalMainDistRoot = realpathSync.native(mainDistRoot);
  const canonicalElectronMainPath = realpathSync.native(electronMainPath);
  assertInsideRoot(canonicalElectronMainPath, canonicalMainDistRoot);
  const canonicalRelativePath = relative(
    canonicalRepositoryRoot,
    canonicalElectronMainPath,
  ).split(sep).join("/");
  if (canonicalRelativePath !== electronMainRelativePath) {
    throw new Error(
      `Electron-main bundle path is not canonical: ${canonicalRelativePath}`,
    );
  }

  const bytes = readBoundedBundle(canonicalElectronMainPath);
  const runtimeImports = inspectRuntimeImports(
    bytes.toString("utf8"),
    canonicalElectronMainPath,
  );
  return {
    schema: 2,
    status: "compiled-electron-main-bundle-verified",
    files: [
      {
        relativePath: electronMainRelativePath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    ],
    runtimeImports,
  };
}

try {
  process.stdout.write(`${JSON.stringify(verifyBundle())}\n`);
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
