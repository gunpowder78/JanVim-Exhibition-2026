import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const MANIFEST_NAME = "package-manifest.json";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_PAYLOAD_FILES = 100_000;
const MAX_TREE_ENTRIES = 200_000;
const MAX_PATH_BYTES = 4_096;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;

function fail(reason) {
  throw new Error(reason);
}

function assertExactKeys(value, keys, reason) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(reason);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) fail(reason);
}

function assertPlainDirectory(path, reason) {
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink()) fail(reason);
}

function normalizeRoot(root) {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) {
    fail("package-root-invalid");
  }
  const normalized = resolve(root);
  assertPlainDirectory(normalized, "package-root-invalid");
  return normalized;
}

function packagePath(root, absolutePath) {
  const rel = relative(root, absolutePath);
  if (
    rel.length === 0 ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) fail("package-path-invalid");
  return rel.split(sep).join("/");
}

function validateManifestPath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    /[\0\r\n]/u.test(path)
  ) fail("manifest-path-invalid");
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    fail("manifest-path-invalid");
  }
  if (segments.length === 1 && segments[0] === MANIFEST_NAME) {
    fail("manifest-self-reference");
  }
  return path;
}

function payloadFiles(root) {
  const files = [];
  const pending = [root];
  let treeEntries = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    assertPlainDirectory(directory, "package-reparse-rejected");
    const children = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      treeEntries += 1;
      if (treeEntries > MAX_TREE_ENTRIES) fail("package-tree-count-exceeded");
      const absolute = join(directory, child.name);
      const status = lstatSync(absolute);
      if (status.isSymbolicLink()) fail("package-reparse-rejected");
      if (status.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!status.isFile()) fail("package-file-type-invalid");
      const path = packagePath(root, absolute);
      if (path === MANIFEST_NAME) continue;
      files.push({ absolute, path: validateManifestPath(path), bytes: status.size });
      if (files.length > MAX_PAYLOAD_FILES) fail("package-file-count-exceeded");
    }
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const folded = new Set();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (folded.has(key)) fail("package-path-case-collision");
    folded.add(key);
  }
  return files;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function describePayload(root) {
  const files = payloadFiles(root);
  const entries = [];
  for (const file of files) {
    const sha256 = await hashFile(file.absolute);
    const after = lstatSync(file.absolute);
    if (!after.isFile() || after.isSymbolicLink() || after.size !== file.bytes) {
      fail("package-file-changed-during-hash");
    }
    entries.push({ path: file.path, bytes: file.bytes, sha256 });
  }
  return entries;
}

function readManifest(root) {
  const path = join(root, MANIFEST_NAME);
  const status = lstatSync(path);
  if (!status.isFile() || status.isSymbolicLink() || status.size > MAX_MANIFEST_BYTES) {
    fail("package-manifest-invalid");
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_MANIFEST_BYTES) fail("package-manifest-invalid");
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    fail("package-manifest-invalid");
  }
  assertExactKeys(value, ["schema", "files"], "package-manifest-invalid");
  if (value.schema !== 1 || !Array.isArray(value.files) || value.files.length > MAX_PAYLOAD_FILES) {
    fail("package-manifest-invalid");
  }
  const folded = new Set();
  let previous;
  for (const entry of value.files) {
    assertExactKeys(entry, ["path", "bytes", "sha256"], "package-manifest-entry-invalid");
    validateManifestPath(entry.path);
    if (
      !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
      typeof entry.sha256 !== "string" || !HASH_PATTERN.test(entry.sha256)
    ) fail("package-manifest-entry-invalid");
    if (previous !== undefined && previous >= entry.path) fail("package-manifest-order-invalid");
    previous = entry.path;
    const key = entry.path.toLowerCase();
    if (folded.has(key)) fail("package-manifest-duplicate-path");
    folded.add(key);
  }
  return { path, bytes, value };
}

export async function createPackageManifest(rootPath) {
  const root = normalizeRoot(rootPath);
  const manifestPath = join(root, MANIFEST_NAME);
  try {
    lstatSync(manifestPath);
    fail("package-manifest-already-exists");
  } catch (error) {
    if (error?.message === "package-manifest-already-exists") throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const files = await describePayload(root);
  const bytes = Buffer.from(`${JSON.stringify({ schema: 1, files })}\n`, "utf8");
  if (bytes.byteLength > MAX_MANIFEST_BYTES) fail("package-manifest-too-large");
  const temporary = join(root, `.${MANIFEST_NAME}-${randomBytes(8).toString("hex")}.tmp`);
  writeFileSync(temporary, bytes, { flag: "wx" });
  renameSync(temporary, manifestPath);
  return {
    status: "package-manifest-created",
    files: files.length,
    manifestBytes: bytes.byteLength,
    manifestSha256: hashBytes(bytes),
  };
}

export async function verifyPackageManifest(rootPath) {
  const root = normalizeRoot(rootPath);
  const manifest = readManifest(root);
  const actual = await describePayload(root);
  if (actual.length !== manifest.value.files.length) fail("package-payload-set-mismatch");
  for (let index = 0; index < actual.length; index += 1) {
    const expected = manifest.value.files[index];
    const observed = actual[index];
    if (
      observed.path !== expected.path ||
      observed.bytes !== expected.bytes ||
      observed.sha256 !== expected.sha256
    ) fail("package-payload-identity-mismatch");
  }
  return {
    status: "package-manifest-verified",
    files: actual.length,
    manifestBytes: manifest.bytes.byteLength,
    manifestSha256: hashBytes(manifest.bytes),
  };
}

function parseCli(argv) {
  if (
    argv.length !== 3 ||
    !["create", "verify"].includes(argv[0]) ||
    argv[1] !== "--root" ||
    typeof argv[2] !== "string" || argv[2].length === 0
  ) fail("package-manifest-arguments-invalid");
  return { command: argv[0], root: argv[2] };
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const result = options.command === "create"
    ? await createPackageManifest(options.root)
    : await verifyPackageManifest(options.root);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invoked = process.argv[1] === undefined ? "" : pathToFileURL(resolve(process.argv[1])).href;
if (import.meta.url === invoked) {
  main().catch(() => {
    process.stderr.write("package-manifest-failed\n");
    process.exitCode = 1;
  });
}
