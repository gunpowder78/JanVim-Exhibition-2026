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
const maximumLexerNesting = 128;
const emittedExtensions = new Set([".js", ".mjs", ".cjs"]);
const TypeScriptSourceExtension = /\.(?:ts|tsx|mts|cts)(?:[?#].*)?$/iu;
const identifierStart = /[A-Z_a-z$]/u;
const identifierContinue = /[\dA-Z_a-z$]/u;
const regexPrefixKeywords = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);
const controlHeaderKeywords = new Set(["catch", "for", "if", "switch", "while", "with"]);
const blockBeforeBraceKeywords = new Set(["catch", "do", "else", "finally", "try"]);
const punctuators = [
  ">>>=",
  "===",
  "!==",
  ">>>",
  "**=",
  "&&=",
  "||=",
  "??=",
  "...",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "++",
  "--",
  "<<",
  ">>",
  "**",
  "&&",
  "||",
  "??",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "?.",
];

function malformedJavaScript(modulePath, detail) {
  throw new Error(`Malformed emitted JavaScript: ${modulePath}: ${detail}`);
}

function regexCanStartAfter(token) {
  if (token === undefined) return true;
  if (token.type === "identifier") return regexPrefixKeywords.has(token.value);
  if (["number", "regex", "string", "template"].includes(token.type)) return false;
  if (token.value === "}") {
    if (token.braceKind === "block") return true;
    if (token.braceKind === "expression") return false;
    return undefined;
  }
  if (["]", "++", "--"].includes(token.value)) return false;
  if (token.value === ")") return token.allowsRegexAfter === true;
  return true;
}

function classifyOpeningBrace(previousToken) {
  if (previousToken === undefined) return "block";
  if (previousToken.value === ")" || previousToken.value === "=>") return "block";
  if (
    previousToken.type === "identifier" &&
    blockBeforeBraceKeywords.has(previousToken.value)
  ) {
    return "block";
  }
  if (previousToken.value === ":") return "ambiguous";
  if ([";", "{", "}"].includes(previousToken.value)) return "block";
  if (regexCanStartAfter(previousToken) === true) return "expression";
  return "ambiguous";
}

function* lexJavaScript(source, modulePath) {
  let index = 0;
  let templateNesting = 0;

  function readString(quote) {
    const start = index;
    index += 1;
    const contentStart = index;
    let escaped = false;
    while (index < source.length) {
      const character = source[index];
      if (character === quote) {
        const value = escaped ? undefined : source.slice(contentStart, index);
        index += 1;
        return { type: "string", value, escaped, start };
      }
      if (character === "\\") {
        escaped = true;
        index += 1;
        if (index >= source.length) {
          malformedJavaScript(modulePath, "unterminated string literal");
        }
        if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
        index += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        malformedJavaScript(modulePath, "newline in string literal");
      }
      index += 1;
    }
    malformedJavaScript(modulePath, "unterminated string literal");
  }

  function readRegex() {
    const start = index;
    index += 1;
    let inCharacterClass = false;
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "\r" || character === "\n") {
        malformedJavaScript(modulePath, "unterminated regular expression literal");
      }
      if (character === "[") {
        inCharacterClass = true;
        index += 1;
        continue;
      }
      if (character === "]" && inCharacterClass) {
        inCharacterClass = false;
        index += 1;
        continue;
      }
      if (character === "/" && !inCharacterClass) {
        index += 1;
        while (index < source.length && identifierContinue.test(source[index])) index += 1;
        return { type: "regex", value: "regex", start };
      }
      index += 1;
    }
    malformedJavaScript(modulePath, "unterminated regular expression literal");
  }

  function* readTemplate() {
    const start = index;
    index += 1;
    templateNesting += 1;
    if (templateNesting > maximumLexerNesting) {
      malformedJavaScript(modulePath, "template nesting limit exceeded");
    }
    try {
      while (index < source.length) {
        const character = source[index];
        if (character === "\\") {
          index += 2;
          continue;
        }
        if (character === "`") {
          index += 1;
          return { type: "template", value: "template", start };
        }
        if (character === "$" && source[index + 1] === "{") {
          index += 2;
          yield* scanCode(true);
          continue;
        }
        index += 1;
      }
      malformedJavaScript(modulePath, "unterminated template literal");
    } finally {
      templateNesting -= 1;
    }
  }

  function* scanCode(stopAtTemplateExpression) {
    const delimiters = [];
    const pendingClassBodyDepths = new Set();
    let previousToken;
    while (index < source.length) {
      const character = source[index];
      if (/\s/u.test(character)) {
        index += 1;
        continue;
      }
      if (index === 0 && character === "#" && source[index + 1] === "!") {
        const lineEnd = source.indexOf("\n", index + 2);
        index = lineEnd < 0 ? source.length : lineEnd + 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "/") {
        const lineEnd = source.indexOf("\n", index + 2);
        index = lineEnd < 0 ? source.length : lineEnd + 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const commentEnd = source.indexOf("*/", index + 2);
        if (commentEnd < 0) malformedJavaScript(modulePath, "unterminated block comment");
        index = commentEnd + 2;
        continue;
      }
      if (character === '"' || character === "'") {
        const token = readString(character);
        token.precededByMemberAccess = false;
        previousToken = token;
        yield token;
        continue;
      }
      if (character === "`") {
        const token = yield* readTemplate();
        token.precededByMemberAccess = false;
        previousToken = token;
        yield token;
        continue;
      }
      if (character === "/") {
        const regexAllowed = regexCanStartAfter(previousToken);
        if (regexAllowed === undefined) {
          malformedJavaScript(modulePath, "ambiguous slash after closing brace");
        }
        if (regexAllowed) {
          const token = readRegex();
          token.precededByMemberAccess = false;
          previousToken = token;
          yield token;
          continue;
        }
      }
      if (identifierStart.test(character)) {
        const start = index;
        index += 1;
        while (index < source.length && identifierContinue.test(source[index])) index += 1;
        const token = {
          type: "identifier",
          value: source.slice(start, index),
          start,
          precededByMemberAccess:
            previousToken?.type === "punctuator" &&
            (previousToken.value === "." || previousToken.value === "?."),
        };
        if (
          token.value === "class" &&
          !token.precededByMemberAccess
        ) {
          pendingClassBodyDepths.add(delimiters.length);
        }
        previousToken = token;
        yield token;
        continue;
      }
      if (character === "\\") {
        throw new Error(`Unsupported identifier escape: ${modulePath}`);
      }
      if (/\d/u.test(character)) {
        const start = index;
        index += 1;
        while (index < source.length && /[\dA-Z_a-z.]/u.test(source[index])) index += 1;
        const token = { type: "number", value: source.slice(start, index), start };
        previousToken = token;
        yield token;
        continue;
      }

      let value = punctuators.find((candidate) => source.startsWith(candidate, index));
      if (value === undefined) value = character;
      const start = index;
      index += value.length;
      if (["(", "[", "{"].includes(value)) {
        if (delimiters.length >= maximumLexerNesting) {
          malformedJavaScript(modulePath, "delimiter nesting limit exceeded");
        }
        let braceKind;
        if (value === "{") {
          if (pendingClassBodyDepths.delete(delimiters.length)) {
            braceKind = "block";
          } else {
            braceKind = classifyOpeningBrace(previousToken);
          }
        }
        delimiters.push({
          value,
          braceKind,
          allowsRegexAfter:
            value === "(" &&
            previousToken?.type === "identifier" &&
            controlHeaderKeywords.has(previousToken.value),
        });
      } else if ([")", "]", "}"].includes(value)) {
        if (value === "}" && stopAtTemplateExpression && delimiters.length === 0) {
          return;
        }
        const expectedOpening = { ")": "(", "]": "[", "}": "{" }[value];
        const opening = delimiters.pop();
        if (opening?.value !== expectedOpening) {
          malformedJavaScript(modulePath, `unmatched ${value}`);
        }
        for (const depth of pendingClassBodyDepths) {
          if (depth > delimiters.length) pendingClassBodyDepths.delete(depth);
        }
        const token = {
          type: "punctuator",
          value,
          start,
          allowsRegexAfter: value === ")" && opening.allowsRegexAfter,
          braceKind: value === "}" ? opening.braceKind : undefined,
        };
        previousToken = token;
        yield token;
        continue;
      }
      if ([",", ":", ";"].includes(value)) {
        pendingClassBodyDepths.delete(delimiters.length);
      }
      const token = { type: "punctuator", value, start };
      previousToken = token;
      yield token;
    }
    if (stopAtTemplateExpression) {
      malformedJavaScript(modulePath, "unterminated template expression");
    }
    if (delimiters.length > 0) {
      malformedJavaScript(modulePath, "unterminated delimiter");
    }
  }

  yield* scanCode(false);
}

function createTokenCursor(tokens) {
  let lookahead;
  return {
    peek() {
      if (lookahead === undefined) lookahead = tokens.next();
      return lookahead.done ? undefined : lookahead.value;
    },
    take() {
      const token = this.peek();
      lookahead = undefined;
      return token;
    },
  };
}

function requireToken(cursor, type, value, modulePath, syntax) {
  const token = cursor.take();
  if (token?.type !== type || (value !== undefined && token.value !== value)) {
    malformedJavaScript(modulePath, syntax);
  }
  return token;
}

function moduleSpecifierFrom(token, modulePath) {
  if (token?.type !== "string") {
    malformedJavaScript(modulePath, "module specifier is not a string literal");
  }
  if (token.escaped) {
    throw new Error(`Unsupported escaped module specifier: ${modulePath}`);
  }
  return token.value;
}

function consumeDelimited(cursor, opening, closing, modulePath, syntax) {
  requireToken(cursor, "punctuator", opening, modulePath, syntax);
  let depth = 1;
  while (depth > 0) {
    const token = cursor.take();
    if (token === undefined) malformedJavaScript(modulePath, syntax);
    if (token.type !== "punctuator") continue;
    if (token.value === opening) depth += 1;
    if (token.value === closing) depth -= 1;
  }
}

function parseNamespaceImport(cursor, modulePath) {
  requireToken(cursor, "punctuator", "*", modulePath, "invalid namespace import");
  requireToken(cursor, "identifier", "as", modulePath, "invalid namespace import");
  requireToken(cursor, "identifier", undefined, modulePath, "invalid namespace import");
}

function parseStaticImport(cursor, firstToken, modulePath) {
  if (firstToken === undefined) {
    malformedJavaScript(modulePath, "incomplete static import declaration");
  }
  if (firstToken.type === "punctuator" && firstToken.value === "*") {
    parseNamespaceImport(cursor, modulePath);
  } else if (firstToken.type === "punctuator" && firstToken.value === "{") {
    consumeDelimited(cursor, "{", "}", modulePath, "invalid named import");
  } else if (firstToken.type === "identifier") {
    cursor.take();
    if (cursor.peek()?.type === "punctuator" && cursor.peek().value === ",") {
      cursor.take();
      const secondary = cursor.peek();
      if (secondary?.type === "punctuator" && secondary.value === "*") {
        parseNamespaceImport(cursor, modulePath);
      } else if (secondary?.type === "punctuator" && secondary.value === "{") {
        consumeDelimited(cursor, "{", "}", modulePath, "invalid named import");
      } else {
        malformedJavaScript(modulePath, "invalid secondary import binding");
      }
    }
  } else {
    malformedJavaScript(modulePath, "invalid static import declaration");
  }
  requireToken(cursor, "identifier", "from", modulePath, "static import lacks from");
  return moduleSpecifierFrom(cursor.take(), modulePath);
}

function parseLiteralCall(cursor, modulePath, kind, specifiers) {
  requireToken(cursor, "punctuator", "(", modulePath, `invalid ${kind} call`);
  const token = cursor.take();
  if (token?.type !== "string") {
    throw new Error(`Unsupported ambiguous ${kind}: ${modulePath}`);
  }
  const specifier = moduleSpecifierFrom(token, modulePath);
  specifiers.push(specifier);
  if (cursor.peek()?.type === "punctuator" && cursor.peek().value === ")") {
    cursor.take();
    return;
  }
  if (
    kind === "dynamic import" &&
    cursor.peek()?.type === "punctuator" &&
    cursor.peek().value === ","
  ) {
    cursor.take();
    scanDynamicImportOptions(cursor, modulePath, specifiers);
    return;
  }
  throw new Error(`Unsupported ambiguous ${kind}: ${modulePath}`);
}

function scanDynamicImportOptions(cursor, modulePath, specifiers) {
  const delimiters = [];
  while (true) {
    const token = cursor.take();
    if (token === undefined) {
      throw new Error(`Unsupported ambiguous dynamic import: ${modulePath}`);
    }
    if (consumeModuleEdge(token, cursor, modulePath, specifiers)) continue;
    if (token.type !== "punctuator") continue;
    if (["(", "[", "{"].includes(token.value)) {
      if (delimiters.length >= maximumLexerNesting) {
        malformedJavaScript(modulePath, "dynamic import option nesting limit exceeded");
      }
      delimiters.push(token.value);
      continue;
    }
    if ([")", "]", "}"].includes(token.value)) {
      if (token.value === ")" && delimiters.length === 0) return;
      const expectedOpening = { ")": "(", "]": "[", "}": "{" }[token.value];
      if (delimiters.pop() !== expectedOpening) {
        malformedJavaScript(modulePath, "invalid dynamic import options");
      }
      continue;
    }
    if (token.value === "," && delimiters.length === 0) {
      throw new Error(`Unsupported ambiguous dynamic import: ${modulePath}`);
    }
  }
}

function consumeModuleEdge(token, cursor, modulePath, specifiers) {
  if (
    token.type === "identifier" &&
    token.value === "import" &&
    !token.precededByMemberAccess
  ) {
    const next = cursor.peek();
    if (next?.type === "punctuator" && next.value === ".") {
      cursor.take();
      requireToken(cursor, "identifier", "meta", modulePath, "invalid import.meta");
    } else if (next?.type === "punctuator" && next.value === "(") {
      parseLiteralCall(cursor, modulePath, "dynamic import", specifiers);
    } else if (next?.type === "string") {
      specifiers.push(moduleSpecifierFrom(cursor.take(), modulePath));
    } else {
      specifiers.push(parseStaticImport(cursor, next, modulePath));
    }
    return true;
  }
  if (
    token.type === "identifier" &&
    token.value === "export" &&
    !token.precededByMemberAccess
  ) {
    const next = cursor.peek();
    if (next?.type === "punctuator" && next.value === "*") {
      cursor.take();
      if (cursor.peek()?.type === "identifier" && cursor.peek().value === "as") {
        cursor.take();
        requireToken(cursor, "identifier", undefined, modulePath, "invalid export namespace");
      }
      requireToken(cursor, "identifier", "from", modulePath, "export lacks from");
      specifiers.push(moduleSpecifierFrom(cursor.take(), modulePath));
    } else if (next?.type === "punctuator" && next.value === "{") {
      consumeDelimited(cursor, "{", "}", modulePath, "invalid named export");
      if (cursor.peek()?.type === "identifier" && cursor.peek().value === "from") {
        cursor.take();
        specifiers.push(moduleSpecifierFrom(cursor.take(), modulePath));
      }
    }
    return true;
  }
  if (
    token.type === "identifier" &&
    token.value === "require" &&
    !token.precededByMemberAccess &&
    cursor.peek()?.type === "punctuator" &&
    cursor.peek().value === "("
  ) {
    parseLiteralCall(cursor, modulePath, "require", specifiers);
    return true;
  }
  return false;
}

function discoverModuleSpecifiers(source, modulePath) {
  const cursor = createTokenCursor(lexJavaScript(source, modulePath));
  const specifiers = [];
  while (cursor.peek() !== undefined) {
    const token = cursor.take();
    consumeModuleEdge(token, cursor, modulePath, specifiers);
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
