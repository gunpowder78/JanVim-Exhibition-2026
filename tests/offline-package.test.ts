import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

const EXPECTED_TAG = "v0.10.1-gmk.4";
const EXPECTED_COMMIT = "e95633101d93f8448b0f906e918b5d836ab95273";
const ARCHIVE_NAME = "JanVim-win-x64.zip";
const PROVENANCE_NAME = "JanVim-win-x64.provenance.json";
const BUILD_LOG_NAME = "JanVim-win-x64.build.log";
const MINIMUM_CORE_BYTES = 1_048_576;
const repositoryRoot = process.cwd();
const temporaryRoots: string[] = [];

const protectedDirectoryNames = [
  "janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504",
  "janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d",
  "janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb",
] as const;

interface FixtureOptions {
  coreBytes?: number;
  omit?: "core" | "runtime-lua" | "artifact-config";
}

interface OfflineFixture {
  root: string;
  payload: string;
  archive: string;
  checksum: string;
  provenance: string;
  buildLog: string;
  showConfig: string;
}

interface ScriptResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolvedRoot = resolve(root);
    expect(basename(resolvedRoot)).toMatch(/^exhibition-offline-/);
    expect(resolvedRoot.toLowerCase().startsWith(resolve(tmpdir()).toLowerCase())).toBe(true);
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
});

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function writeText(path: string, text: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function writeBinary(path: string, bytes: number, value: number): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, Buffer.alloc(bytes, value));
}

function createZip(payload: string, archive: string): void {
  const command =
    "Compress-Archive -Path (Join-Path $env:JANVIM_TEST_ZIP_SOURCE '*') -DestinationPath $env:JANVIM_TEST_ZIP_TARGET -CompressionLevel NoCompression";
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1_048_576,
    env: {
      ...process.env,
      JANVIM_TEST_ZIP_SOURCE: payload,
      JANVIM_TEST_ZIP_TARGET: archive,
    },
  });
  expect(result.error).toBeUndefined();
  expect(`${result.stdout}${result.stderr}`).toBe("");
  expect(result.status).toBe(0);
}

function stageProductionScripts(root: string): void {
  const scripts = ["prepare-janvim-runtime.ps1", "verify-runtime.ps1"] as const;
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const script of scripts) {
    const source = join(repositoryRoot, "scripts", script);
    expect(existsSync(source), `${script} must exist before behavior tests can pass`).toBe(true);
    cpSync(source, join(root, "scripts", script));
  }
}

function writeShowConfig(path: string, layoutEngine = "dynamic"): void {
  writeText(
    path,
    [
      "[cursor]",
      'vfx_type = "classic"',
      "",
      "[fonts]",
      'fallback_paths = ["../runtime/janvim/assets/fonts/private/FiraCodeNerdFontMono-Regular.ttf"]',
      "",
      "[layout]",
      `engine = "${layoutEngine}"`,
      ...(layoutEngine === "dynamic"
        ? ['dynamic_profile = "../runtime/janvim/assets/layout-profiles/computer-mixed.toml"']
        : []),
      "column_width = 20.0",
      "column_gap = 4.0",
      "glyph_advance = 24.0",
      "",
      "[typography]",
      'english_layout = "sideways"',
      "",
      "[neovim]",
      'startup_profile = "plugin-lab"',
      'colorscheme = "catppuccin-mocha"',
      "",
      "[window]",
      "start_maximized = true",
      "",
      "[backend]",
      'endpoint = "auto"',
      "connect_timeout_ms = 3000",
      "handshake_timeout_ms = 3000",
      "request_timeout_ms = 1000",
      "plugin_load_timeout_ms = 5000",
      "shutdown_timeout_ms = 3000",
      "retry_interval_ms = 100",
      "",
    ].join("\n"),
  );
}

function writeProvenance(fixture: OfflineFixture, overrides: Record<string, unknown> = {}): void {
  const core = join(fixture.payload, "janvim-core.exe");
  const runtimeLua = join(fixture.payload, "runtime", "lua", "janvim.lua");
  const artifactConfig = join(fixture.payload, "assets", "config.toml");
  const record = {
    schema: 1,
    kind: "isolated-tag-rebuild",
    sourceRepository: "https://github.com/gunpowder78/JanVim.git",
    tag: EXPECTED_TAG,
    commit: EXPECTED_COMMIT,
    archive: ARCHIVE_NAME,
    archiveBytes: statSync(fixture.archive).size,
    archiveSha256: sha256(fixture.archive),
    checksumSha256: sha256(fixture.checksum),
    coreSha256: existsSync(core) ? sha256(core) : "0".repeat(64),
    runtimeLuaSha256: existsSync(runtimeLua) ? sha256(runtimeLua) : "0".repeat(64),
    artifactConfigSha256: existsSync(artifactConfig)
      ? sha256(artifactConfig)
      : "0".repeat(64),
    evidenceReference: `build-log-sha256:${sha256(fixture.buildLog)}`,
    ...overrides,
  };
  writeText(fixture.provenance, `${JSON.stringify(record, null, 2)}\n`);
}

function makeFixture(options: FixtureOptions = {}): OfflineFixture {
  const root = mkdtempSync(join(tmpdir(), "exhibition-offline-"));
  temporaryRoots.push(root);
  writeText(join(root, "AGENTS.md"), "# JanVim Exhibition 2026 agent instructions\n");
  writeText(join(root, "package.json"), '{"name":"janvim-exhibition-2026","private":true}\n');
  stageProductionScripts(root);
  cpSync(join(repositoryRoot, "nvim"), join(root, "nvim"), { recursive: true });

  const payload = join(root, "evidence", "payload");
  const archive = join(root, "evidence", ARCHIVE_NAME);
  const checksum = `${archive}.sha256`;
  const provenance = join(root, "evidence", PROVENANCE_NAME);
  const buildLog = join(root, "evidence", BUILD_LOG_NAME);
  const showConfig = join(root, "show", "janvim-show.toml");

  if (options.omit !== "core") {
    writeBinary(join(payload, "janvim-core.exe"), options.coreBytes ?? MINIMUM_CORE_BYTES, 0x51);
  }
  writeBinary(join(payload, "janvim-watchdog.exe"), 4_096, 0x52);
  writeBinary(join(payload, "nvim-win64", "bin", "nvim.exe"), 4_096, 0x53);
  if (options.omit !== "runtime-lua") {
    writeText(join(payload, "runtime", "lua", "janvim.lua"), "return { fixture = true }\n");
  }
  if (options.omit !== "artifact-config") {
    writeText(join(payload, "assets", "config.toml"), '[layout]\nengine = "dynamic"\n');
  }
  writeText(join(payload, "assets", "nvim", "init.lua"), "return true\n");
  writeText(
    join(payload, "assets", "layout-profiles", "computer-mixed.toml"),
    "schema = 1\n",
  );
  writeBinary(
    join(payload, "assets", "fonts", "private", "FiraCodeNerdFontMono-Regular.ttf"),
    4_096,
    0x54,
  );
  writeShowConfig(showConfig);
  writeText(
    buildLog,
    [
      `JANVIM_SOURCE_TAG=${EXPECTED_TAG}`,
      `JANVIM_SOURCE_COMMIT=${EXPECTED_COMMIT}`,
      "JANVIM_BUILD_STEP_OK=cargo-fmt",
      "JANVIM_BUILD_STEP_OK=cargo-test",
      "JANVIM_BUILD_STEP_OK=cargo-clippy",
      "JANVIM_BUILD_STEP_OK=guard-deps",
      "JANVIM_BUILD_STEP_OK=package-windows",
      "",
    ].join("\n"),
  );

  createZip(payload, archive);
  writeText(checksum, `${sha256(archive)}  ${ARCHIVE_NAME}\n`);
  const fixture = { root, payload, archive, checksum, provenance, buildLog, showConfig };
  writeProvenance(fixture);
  return fixture;
}

function runScript(root: string, script: string, args: readonly string[] = []): ScriptResult {
  const result = spawnSync(
    "pwsh",
    ["-NoProfile", "-NonInteractive", "-File", join(root, "scripts", script), ...args],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1_048_576,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

function prepareFromArchive(fixture: OfflineFixture, layoutEngine = "dynamic"): ScriptResult {
  return runScript(fixture.root, "prepare-janvim-runtime.ps1", [
    "-SourceArchive",
    fixture.archive,
    "-ProvenancePath",
    fixture.provenance,
    "-LayoutEngine",
    layoutEngine,
  ]);
}

function output(result: ScriptResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function expectFailure(result: ScriptResult, reason: RegExp): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(output(result)).toMatch(reason);
}

describe("offline JanVim artifact scripts", () => {
  it("contains only repository-relative targets, finite archive bounds, and no forbidden source operations", () => {
    const prepare = readFileSync(
      join(repositoryRoot, "scripts", "prepare-janvim-runtime.ps1"),
      "utf8",
    );
    const verify = readFileSync(join(repositoryRoot, "scripts", "verify-runtime.ps1"), "utf8");
    const combined = `${prepare}\n${verify}`;
    const ignoredPaths = readFileSync(join(repositoryRoot, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .filter(Boolean);

    expect(prepare).toMatch(/Join-Path\s+\$PSScriptRoot\s+['"]\.\.['"]/i);
    expect(prepare).toMatch(/Join-Path\s+\$runtimeParent\s+['"]janvim['"]/i);
    expect(prepare).not.toMatch(/\[string\]\s*\$Destination/i);
    expect(combined).not.toMatch(/git\s+checkout-index/i);
    expect(combined).not.toMatch(/Remove-Item[^\r\n]*(SourceArchive|SourceDirectory)/i);
    expect(combined).not.toMatch(/Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/i);
    for (const protectedName of protectedDirectoryNames) {
      expect(combined.toLowerCase()).not.toContain(protectedName);
    }
    for (const bound of ["MaximumArchiveBytes", "MaximumExpandedBytes", "MaximumEntryCount"]) {
      expect(prepare).toContain(bound);
    }
    expect(ignoredPaths).toContain("runtime/janvim/");
    expect(ignoredPaths).toContain("runtime/user-root/");
  });

  it("prepares an archive into this repository only, writes a real lock atomically, and verifies it", () => {
    const fixture = makeFixture();
    const sourceArchiveBefore = sha256(fixture.archive);
    const sourcePayloadBefore = sha256(join(fixture.payload, "janvim-core.exe"));
    const prepared = prepareFromArchive(fixture);

    expect(prepared.error).toBeUndefined();
    expect(output(prepared)).toMatch(/runtime-prepared/i);
    expect(prepared.status).toBe(0);
    const runtimeRoot = join(fixture.root, "runtime", "janvim");
    const lockPath = join(fixture.root, "janvim-artifact.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;

    expect(lock).toMatchObject({
      schema: 1,
      sourceRepository: "D:/github/JanVim",
      tag: EXPECTED_TAG,
      commit: EXPECTED_COMMIT,
      archive: ARCHIVE_NAME,
      archiveSha256: sourceArchiveBefore,
      coreSha256: sourcePayloadBefore,
      configSha256: sha256(fixture.showConfig),
      layoutEngine: "dynamic",
      role: "primary-projector",
      provenanceKind: "isolated-tag-rebuild",
      provenanceRecord: PROVENANCE_NAME,
      evidenceRecord: BUILD_LOG_NAME,
      evidenceSha256: sha256(fixture.buildLog),
    });
    for (const [key, value] of Object.entries(lock)) {
      if (key.endsWith("Sha256")) {
        expect(value).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(existsSync(join(runtimeRoot, "janvim-core.exe"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "runtime", "lua", "janvim.lua"))).toBe(true);
    expect(existsSync(join(runtimeRoot, "assets", "config.toml"))).toBe(true);
    expect(existsSync(join(runtimeRoot, ARCHIVE_NAME))).toBe(true);
    expect(existsSync(join(runtimeRoot, `${ARCHIVE_NAME}.sha256`))).toBe(true);
    expect(existsSync(join(runtimeRoot, PROVENANCE_NAME))).toBe(true);
    expect(existsSync(join(runtimeRoot, BUILD_LOG_NAME))).toBe(true);
    expect(
      existsSync(
        join(
          fixture.root,
          "runtime",
          "user-root",
          "plugin-lab",
          "local",
          "janvim-exhibition",
          "lua",
          "janvim_exhibition",
          "init.lua",
        ),
      ),
    ).toBe(true);
    const pluginLabInit = readFileSync(
      join(fixture.root, "runtime", "user-root", "plugin-lab", "config", "init.lua"),
      "utf8",
    );
    expect(pluginLabInit).toMatch(/return\s+\{/);
    expect(pluginLabInit).toContain("vim.env.JANVIM_USER_ROOT");
    expect(pluginLabInit).not.toContain("JANVIM_EXHIBITION_USER_ROOT");
    expect(pluginLabInit).toContain('require("janvim_exhibition").setup()');

    const verified = runScript(fixture.root, "verify-runtime.ps1");
    expect(verified.error).toBeUndefined();
    expect(verified.status).toBe(0);
    expect(output(verified)).toMatch(/runtime-verified/i);
    expect(sha256(fixture.archive)).toBe(sourceArchiveBefore);
    expect(sha256(join(fixture.payload, "janvim-core.exe"))).toBe(sourcePayloadBefore);
    expect(
      existsSync(join(fixture.root, "outside", "runtime", "janvim", "janvim-core.exe")),
    ).toBe(false);
    expect(
      existsSync(join(fixture.root, ".janvim-artifact.lock.test.tmp")),
    ).toBe(false);
    expect(
      readFileSync(join(fixture.root, "AGENTS.md"), "utf8"),
    ).toBe("# JanVim Exhibition 2026 agent instructions\n");
  }, 10_000);

  it("accepts a portable directory only when its separate provenance archive has identical required bytes", () => {
    const fixture = makeFixture();
    const prepared = runScript(fixture.root, "prepare-janvim-runtime.ps1", [
      "-SourceDirectory",
      fixture.payload,
      "-ProvenanceArchive",
      fixture.archive,
      "-ProvenancePath",
      fixture.provenance,
      "-LayoutEngine",
      "dynamic",
    ]);

    expect(prepared.error).toBeUndefined();
    expect(prepared.status).toBe(0);
    expect(output(prepared)).toMatch(/runtime-prepared/i);
    expect(runScript(fixture.root, "verify-runtime.ps1").status).toBe(0);
  });

  it("prepares the selected orthogonal runtime from the checked-in show config", () => {
    const fixture = makeFixture();
    cpSync(join(repositoryRoot, "show", "janvim-show.toml"), fixture.showConfig);

    const prepared = prepareFromArchive(fixture, "orthogonal");
    expect(prepared.error).toBeUndefined();
    expect(prepared.status, output(prepared)).toBe(0);
    const lock = JSON.parse(
      readFileSync(join(fixture.root, "janvim-artifact.lock.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(lock.layoutEngine).toBe("orthogonal");
    expect(runScript(fixture.root, "verify-runtime.ps1").status).toBe(0);
  });

  it("prepares and verifies the orthogonal physical A/B branch without a dynamic profile", () => {
    const fixture = makeFixture();
    writeShowConfig(fixture.showConfig, "orthogonal");

    const prepared = prepareFromArchive(fixture, "orthogonal");
    expect(prepared.error).toBeUndefined();
    expect(prepared.status).toBe(0);
    const lock = JSON.parse(
      readFileSync(join(fixture.root, "janvim-artifact.lock.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(lock.layoutEngine).toBe("orthogonal");
    expect(runScript(fixture.root, "verify-runtime.ps1").status).toBe(0);
  });

  it.each([
    ["core", /janvim-core-missing/i],
    ["runtime-lua", /runtime-lua-missing/i],
    ["artifact-config", /artifact-config-missing/i],
  ] as const)("rejects a source missing %s before touching the runtime", (omit, reason) => {
    const fixture = makeFixture({ omit });
    expectFailure(prepareFromArchive(fixture), reason);
    expect(existsSync(join(fixture.root, "runtime", "janvim"))).toBe(false);
    expect(existsSync(join(fixture.root, "janvim-artifact.lock.json"))).toBe(false);
  });

  it("rejects the 18-byte core class before touching the runtime", () => {
    const fixture = makeFixture({ coreBytes: 18 });
    expectFailure(prepareFromArchive(fixture), /core-too-small/i);
    expect(existsSync(join(fixture.root, "runtime", "janvim"))).toBe(false);
    expect(existsSync(join(fixture.root, "janvim-artifact.lock.json"))).toBe(false);
  });

  it("rejects provenance with any non-exact identity or non-lowercase digest", () => {
    const fixture = makeFixture();
    const original = JSON.parse(readFileSync(fixture.provenance, "utf8")) as Record<
      string,
      unknown
    >;
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ tag: "v0.10.1-gmk.5" }, /provenance-tag-mismatch/i],
      [{ commit: "0".repeat(40) }, /provenance-commit-mismatch/i],
      [{ archiveSha256: String(original.archiveSha256).toUpperCase() }, /hash-format/i],
      [{ archiveBytes: Number(original.archiveBytes) + 1 }, /archive-size-mismatch/i],
    ];

    for (const [mutation, reason] of cases) {
      writeText(fixture.provenance, `${JSON.stringify({ ...original, ...mutation }, null, 2)}\n`);
      expectFailure(prepareFromArchive(fixture), reason);
      expect(existsSync(join(fixture.root, "runtime", "janvim"))).toBe(false);
      expect(existsSync(join(fixture.root, "janvim-artifact.lock.json"))).toBe(false);
    }
  });

  it("requires the actual isolated-build log and matches its digest before copying", () => {
    const missing = makeFixture();
    unlinkSync(missing.buildLog);
    expectFailure(prepareFromArchive(missing), /build-evidence-missing/i);
    expect(existsSync(join(missing.root, "runtime", "janvim"))).toBe(false);

    const mutated = makeFixture();
    writeText(mutated.buildLog, "mutated build evidence\n");
    expectFailure(prepareFromArchive(mutated), /build-evidence-hash-mismatch/i);
    expect(existsSync(join(mutated.root, "runtime", "janvim"))).toBe(false);
  });

  it("rejects checksum disagreement, an unconfirmed show layout, and an existing runtime", () => {
    const badChecksum = makeFixture();
    writeText(badChecksum.checksum, `${"0".repeat(64)}  ${ARCHIVE_NAME}\n`);
    expectFailure(prepareFromArchive(badChecksum), /archive-checksum-mismatch/i);

    const unconfirmed = makeFixture();
    writeShowConfig(unconfirmed.showConfig, "unconfirmed");
    expectFailure(prepareFromArchive(unconfirmed), /show-layout-unconfirmed/i);

    const occupied = makeFixture();
    const sentinel = join(occupied.root, "runtime", "janvim", "sentinel.txt");
    writeText(sentinel, "preserve me\n");
    expectFailure(prepareFromArchive(occupied), /runtime-target-already-exists/i);
    expect(readFileSync(sentinel, "utf8")).toBe("preserve me\n");
  });

  it("rejects any TempCache janvim-prefixed source path before resolving it", () => {
    const fixture = makeFixture();
    const blockedArchive = join(
      "D:\\VirtualData\\TempCache",
      "janvim-do-not-resolve-test-sentinel",
      ARCHIVE_NAME,
    );
    const result = runScript(fixture.root, "prepare-janvim-runtime.ps1", [
      "-SourceArchive",
      blockedArchive,
      "-ProvenancePath",
      fixture.provenance,
      "-LayoutEngine",
      "dynamic",
    ]);

    expectFailure(result, /protected-temp-source-rejected/i);
    expect(output(result)).not.toMatch(/source-archive-missing/i);
  });

  it("fails verification for missing runtime files and every mutated locked hash", () => {
    const fixture = makeFixture();
    expect(prepareFromArchive(fixture).status).toBe(0);
    const runtimeRoot = join(fixture.root, "runtime", "janvim");
    const lockPath = join(fixture.root, "janvim-artifact.lock.json");
    const originalLockText = readFileSync(lockPath, "utf8");
    const originalLock = JSON.parse(originalLockText) as Record<string, unknown>;
    const requiredFiles: Array<[string, RegExp]> = [
      [join(runtimeRoot, "janvim-core.exe"), /janvim-core-missing/i],
      [join(runtimeRoot, "runtime", "lua", "janvim.lua"), /runtime-lua-missing/i],
      [join(runtimeRoot, "assets", "config.toml"), /artifact-config-missing/i],
      [join(runtimeRoot, BUILD_LOG_NAME), /build-evidence-missing/i],
      [fixture.showConfig, /show-config-missing/i],
    ];

    for (const [path, reason] of requiredFiles) {
      const bytes = readFileSync(path);
      unlinkSync(path);
      expectFailure(runScript(fixture.root, "verify-runtime.ps1"), reason);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, bytes);
    }

    const mutations: Array<[string, unknown, RegExp]> = [
      ["tag", "v0.10.1-gmk.5", /lock-tag-mismatch/i],
      ["commit", "0".repeat(40), /lock-commit-mismatch/i],
      ["archiveSha256", "0".repeat(64), /archive-hash-mismatch/i],
      ["coreSha256", "0".repeat(64), /core-hash-mismatch/i],
      ["runtimeLuaSha256", "0".repeat(64), /runtime-lua-hash-mismatch/i],
      ["artifactConfigSha256", "0".repeat(64), /artifact-config-hash-mismatch/i],
      ["configSha256", "0".repeat(64), /show-config-hash-mismatch/i],
      ["evidenceSha256", "0".repeat(64), /build-evidence-hash-mismatch/i],
      ["archiveSha256", String(originalLock.archiveSha256).toUpperCase(), /hash-format/i],
    ];
    for (const [field, value, reason] of mutations) {
      writeText(lockPath, `${JSON.stringify({ ...originalLock, [field]: value }, null, 2)}\n`);
      expectFailure(runScript(fixture.root, "verify-runtime.ps1"), reason);
    }
    writeText(lockPath, originalLockText);

    const corePath = join(runtimeRoot, "janvim-core.exe");
    const originalCore = readFileSync(corePath);
    writeFileSync(corePath, Buffer.concat([originalCore, Buffer.from([0x00])]));
    expectFailure(runScript(fixture.root, "verify-runtime.ps1"), /core-(size|hash)-mismatch/i);
    writeFileSync(corePath, originalCore);

    const originalConfig = readFileSync(fixture.showConfig, "utf8");
    writeText(fixture.showConfig, `${originalConfig}# mutation\n`);
    expectFailure(runScript(fixture.root, "verify-runtime.ps1"), /show-config-hash-mismatch/i);
    writeText(fixture.showConfig, originalConfig);
    expect(runScript(fixture.root, "verify-runtime.ps1").status).toBe(0);
  }, 30_000);

  it("rejects a forged build log even when provenance and lock hashes are self-consistent", () => {
    const fixture = makeFixture();
    expect(prepareFromArchive(fixture).status).toBe(0);
    const runtimeRoot = join(fixture.root, "runtime", "janvim");
    const runtimeBuildLog = join(runtimeRoot, BUILD_LOG_NAME);
    const runtimeProvenance = join(runtimeRoot, PROVENANCE_NAME);
    const lockPath = join(fixture.root, "janvim-artifact.lock.json");

    writeText(runtimeBuildLog, "fabricated but internally rehashed evidence\n");
    const evidenceHash = sha256(runtimeBuildLog);
    const provenance = JSON.parse(readFileSync(runtimeProvenance, "utf8")) as Record<
      string,
      unknown
    >;
    provenance.evidenceReference = `build-log-sha256:${evidenceHash}`;
    writeText(runtimeProvenance, `${JSON.stringify(provenance, null, 2)}\n`);
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, unknown>;
    lock.evidenceSha256 = evidenceHash;
    lock.provenanceReference = provenance.evidenceReference;
    lock.provenanceSha256 = sha256(runtimeProvenance);
    writeText(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

    expectFailure(
      runScript(fixture.root, "verify-runtime.ps1"),
      /build-evidence-(source-identity|step)-missing/i,
    );
  });
});
