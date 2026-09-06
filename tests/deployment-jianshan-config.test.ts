import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterAll, describe, expect, it } from "vitest";

import { renderJianShanLiveConfig } from "../deployment/operator/lib/jianshan-config.mjs";

const DESCRIPTOR =
  "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\joint-sound-test\\flock-input.json";
const TEMPLATE = [
  "# safe exhibition template",
  "[audio]",
  "enabled = true",
  "",
  "[osc]",
  "enabled = true",
  "",
  "[flock_input]",
  "enabled = false",
  'descriptor_path = ""',
  "send_hz = 5",
  "v_ref = 3.0",
  "",
  "[camera]",
  "enabled = true",
  "",
].join("\n");

const tempRoot = mkdtempSync(join(tmpdir(), "janvim-jianshan-config-"));

afterAll(() => {
  const resolved = resolve(tempRoot);
  if (!resolved.startsWith(resolve(tmpdir()))) {
    throw new Error("test-temp-root-invalid");
  }
  rmSync(resolved, { recursive: true, force: true });
});

describe("JianShan private live configuration", () => {
  it("changes only bounded sound ingress keys and appends black/white display settings", () => {
    const rendered = renderJianShanLiveConfig(TEMPLATE, DESCRIPTOR);

    expect(rendered).toContain("[audio]\nenabled = false");
    expect(rendered).toContain("[osc]\nenabled = false");
    expect(rendered).toContain(
      [
        "[flock_input]",
        "enabled = true",
        'descriptor_path = "D:/VirtualData/JanVim-Exhibition-Rehearsals/joint-sound-test/flock-input.json"',
        "send_hz = 10",
        "v_ref = 4.0",
      ].join("\n"),
    );
    expect(rendered).toContain("[camera]\nenabled = true");
    expect(
      rendered.endsWith(
        '[display]\ninvert_colors = true\nbird_color_preset = "contrast"\n',
      ),
    ).toBe(true);
    expect(rendered).not.toContain("\r");
    expect(rendered.charCodeAt(0)).not.toBe(0xfeff);
  });

  it.each(["audio", "osc", "flock_input"])(
    "rejects a duplicate [%s] section",
    (section) => {
      expect(() =>
        renderJianShanLiveConfig(`${TEMPLATE}[${section}]\n`, DESCRIPTOR),
      ).toThrow("jianshan-template-section-invalid");
    },
  );

  it("rejects an existing display section", () => {
    expect(() =>
      renderJianShanLiveConfig(`${TEMPLATE}[display]\n`, DESCRIPTOR),
    ).toThrow("jianshan-template-display-section-present");
  });

  it.each([
    ["audio enabled", "[audio]\nenabled = true", "[audio]\nenabled = true\nenabled = true"],
    [
      "flock descriptor",
      'descriptor_path = ""',
      'descriptor_path = ""\ndescriptor_path = ""',
    ],
  ])("rejects duplicate target key: %s", (_label, from, to) => {
    expect(() =>
      renderJianShanLiveConfig(TEMPLATE.replace(from, to), DESCRIPTOR),
    ).toThrow("jianshan-template-key-invalid");
  });

  it.each([
    "[audio]\nenabled = true\n",
    "[osc]\nenabled = true\n",
    "enabled = false\n",
    'descriptor_path = ""\n',
    "send_hz = 5\n",
    "v_ref = 3.0\n",
  ])("rejects a missing required target key", (line) => {
    expect(() =>
      renderJianShanLiveConfig(TEMPLATE.replace(line, ""), DESCRIPTOR),
    ).toThrow(/jianshan-template-(section|key)-invalid/);
  });

  it.each([
    "relative\\flock-input.json",
    'D:\\bad"name\\flock-input.json',
    "D:\\bad\nname\\flock-input.json",
  ])("rejects an unsafe descriptor path", (descriptorPath) => {
    expect(() =>
      renderJianShanLiveConfig(TEMPLATE, descriptorPath),
    ).toThrow("jianshan-descriptor-path-invalid");
  });

  it("rejects template input beyond 32,768 UTF-8 bytes", () => {
    expect(() =>
      renderJianShanLiveConfig(`${TEMPLATE}${"x".repeat(32_769)}`, DESCRIPTOR),
    ).toThrow("jianshan-template-too-large");
  });

  it("writes one exclusive output and prints only its bounded receipt", () => {
    const script = resolve("deployment/operator/lib/jianshan-config.mjs");
    const template = join(tempRoot, "success", "template.toml");
    const output = join(tempRoot, "success", "live.toml");
    mkdirSync(dirname(template), { recursive: true });
    writeFileSync(template, TEMPLATE, "utf8");

    const result = spawnSync(
      process.execPath,
      [script, "--template", template, "--descriptor", DESCRIPTOR, "--output", output],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split(/\r?\n/u);
    expect(lines).toHaveLength(1);
    const receipt = JSON.parse(lines[0]!) as Record<string, unknown>;
    const bytes = readFileSync(output);
    expect(receipt).toEqual({
      status: "jianshan-live-config-written",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("fails closed without replacing an existing output", () => {
    const script = resolve("deployment/operator/lib/jianshan-config.mjs");
    const template = join(tempRoot, "existing", "template.toml");
    const output = join(tempRoot, "existing", "live.toml");
    mkdirSync(dirname(template), { recursive: true });
    writeFileSync(template, TEMPLATE, "utf8");
    writeFileSync(output, "keep", "utf8");

    const result = spawnSync(
      process.execPath,
      [script, "--template", template, "--descriptor", DESCRIPTOR, "--output", output],
      { encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain(DESCRIPTOR);
    expect(readFileSync(output, "utf8")).toBe("keep");
  });
});
