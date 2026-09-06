import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, win32 } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const MAX_TEMPLATE_BYTES = 32_768;
const MAX_DESCRIPTOR_PATH_BYTES = 1_024;
const TARGET_SECTIONS = new Set(["audio", "osc", "flock_input"]);
const REQUIRED_KEYS = new Map([
  ["audio", new Map([["enabled", "false"]])],
  ["osc", new Map([["enabled", "false"]])],
  [
    "flock_input",
    new Map([
      ["enabled", "true"],
      ["descriptor_path", undefined],
      ["send_hz", "10"],
      ["v_ref", "4.0"],
    ]),
  ],
]);

function normalizedDescriptorPath(descriptorPath) {
  if (
    typeof descriptorPath !== "string" ||
    descriptorPath.length === 0 ||
    Buffer.byteLength(descriptorPath, "utf8") > MAX_DESCRIPTOR_PATH_BYTES ||
    !win32.isAbsolute(descriptorPath) ||
    /["\r\n\0]/u.test(descriptorPath)
  ) {
    throw new Error("jianshan-descriptor-path-invalid");
  }
  return win32.normalize(descriptorPath).replaceAll("\\", "/");
}

export function renderJianShanLiveConfig(templateText, descriptorPath) {
  if (
    typeof templateText !== "string" ||
    Buffer.byteLength(templateText, "utf8") > MAX_TEMPLATE_BYTES
  ) {
    throw new Error("jianshan-template-too-large");
  }

  const normalizedDescriptor = normalizedDescriptorPath(descriptorPath);
  const source = templateText.startsWith("\uFEFF")
    ? templateText.slice(1)
    : templateText;
  const lines = source.split(/\r\n|\n|\r/u);
  const sectionCounts = new Map();
  const keyCounts = new Map();
  let section = "";

  const rendered = lines.map((line) => {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1].trim();
      const count = (sectionCounts.get(section) ?? 0) + 1;
      sectionCounts.set(section, count);
      if (section === "display") {
        throw new Error("jianshan-template-display-section-present");
      }
      if (TARGET_SECTIONS.has(section) && count !== 1) {
        throw new Error("jianshan-template-section-invalid");
      }
      return line;
    }

    const required = REQUIRED_KEYS.get(section);
    if (required === undefined) return line;
    const keyMatch = /^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.*)$/u.exec(line);
    if (keyMatch === null || !required.has(keyMatch[2])) return line;

    const identity = `${section}.${keyMatch[2]}`;
    const count = (keyCounts.get(identity) ?? 0) + 1;
    keyCounts.set(identity, count);
    if (count !== 1) throw new Error("jianshan-template-key-invalid");
    const replacement = keyMatch[2] === "descriptor_path"
      ? `"${normalizedDescriptor}"`
      : required.get(keyMatch[2]);
    return `${keyMatch[1]}${keyMatch[2]}${keyMatch[3]}${replacement}`;
  });

  for (const target of TARGET_SECTIONS) {
    if (sectionCounts.get(target) !== 1) {
      throw new Error("jianshan-template-section-invalid");
    }
    for (const key of REQUIRED_KEYS.get(target).keys()) {
      if (keyCounts.get(`${target}.${key}`) !== 1) {
        throw new Error("jianshan-template-key-invalid");
      }
    }
  }

  const base = rendered.join("\n").replace(/\n*$/u, "");
  return `${base}\n\n[display]\ninvert_colors = true\nbird_color_preset = "contrast"\n`;
}

function parseArguments(argv) {
  if (argv.length !== 6) throw new Error("jianshan-config-arguments-invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--template", "--descriptor", "--output"].includes(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      values.has(name)
    ) {
      throw new Error("jianshan-config-arguments-invalid");
    }
    values.set(name, value);
  }
  if (values.size !== 3) throw new Error("jianshan-config-arguments-invalid");
  return {
    template: values.get("--template"),
    descriptor: values.get("--descriptor"),
    output: values.get("--output"),
  };
}

function runCli() {
  const args = parseArguments(process.argv.slice(2));
  const templateStat = statSync(args.template);
  if (!templateStat.isFile() || templateStat.size > MAX_TEMPLATE_BYTES) {
    throw new Error("jianshan-template-too-large");
  }
  const templateBytes = readFileSync(args.template);
  const templateText = new TextDecoder("utf-8", { fatal: true }).decode(
    templateBytes,
  );
  const output = Buffer.from(
    renderJianShanLiveConfig(templateText, args.descriptor),
    "utf8",
  );
  writeFileSync(args.output, output, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    status: "jianshan-live-config-written",
    bytes: output.byteLength,
    sha256: createHash("sha256").update(output).digest("hex"),
  })}\n`);
}

const invokedPath = process.argv[1] === undefined
  ? ""
  : pathToFileURL(resolve(process.argv[1])).href;
if (import.meta.url === invokedPath) {
  try {
    runCli();
  } catch {
    process.stderr.write("jianshan-live-config-failed\n");
    process.exitCode = 1;
  }
}
