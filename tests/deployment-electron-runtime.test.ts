import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repository = process.cwd();
const modulePath = join(repository, "deployment/operator/lib/Exhibition.Deployment.psm1");
const inventory = JSON.parse(readFileSync(join(repository, "deployment/config/electron-runtime.lock.json"), "utf8")) as {
  files: Array<{ path: string; bytes: number; sha256: string }>;
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + "\\")) throw new Error("unsafe-test-root");
    rmSync(root, { recursive: true, force: true });
  }
});

function psQuote(value: string) { return `'${value.replaceAll("'", "''")}'`; }

function check(appRoot: string) {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", [
    "$ErrorActionPreference='Stop'",
    `Import-Module ${psQuote(modulePath)} -Force`,
    `try { $value=Assert-DeploymentElectronRuntime -AppRoot ${psQuote(appRoot)}; @{accepted=$true;value=$value} | ConvertTo-Json -Compress } catch { @{accepted=$false;reason=$_.Exception.Message} | ConvertTo-Json -Compress }`,
  ].join("\n")], { encoding: "utf8", timeout: 20_000, windowsHide: true });
  expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  return JSON.parse(result.stdout) as { accepted: boolean; reason?: string; value?: { version: string; files: number } };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "janvim-electron-required-"));
  roots.push(root);
  const appRoot = join(root, "app");
  const electron = join(appRoot, "node_modules/electron");
  for (const entry of inventory.files) {
    const path = join(electron, "dist", entry.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "fixture");
  }
  writeFileSync(join(electron, "path.txt"), "electron.exe");
  writeFileSync(join(electron, "package.json"), '{"version":"44.0.0"}\n');
  writeFileSync(join(electron, "dist/version"), "44.0.0");
  return { root, appRoot, electron };
}

describe("required packaged Electron runtime", () => {
  it("accepts the complete installed runtime without launching Electron", () => {
    expect(check(repository)).toMatchObject({ accepted: true, value: { version: "44.0.0", files: 73 } });
  });

  it.each([
    "path.txt", "dist/electron.exe", "dist/resources.pak", "dist/icudtl.dat",
    "dist/locales/zh-CN.pak", "dist/resources/default_app.asar", "dist/version",
  ])("rejects a missing %s even when every listed manifest file matches", (missing) => {
    const value = fixture();
    rmSync(join(value.electron, missing));
    const manifestTool = join(repository, "deployment/operator/lib/package-manifest.mjs");
    for (const operation of ["create", "verify"]) {
      const result = spawnSync(process.execPath, [manifestTool, operation, "--root", value.root], {
        encoding: "utf8", timeout: 20_000, windowsHide: true,
      });
      expect(result.status, result.stderr).toBe(0);
    }
    expect(check(value.appRoot)).toEqual({ accepted: false, reason: `electron-runtime-file-missing:${missing}` });
  });

  it.each([
    ["path.txt", "different.exe", "electron-runtime-launcher-invalid"],
    ["dist/version", "43.0.0", "electron-runtime-version-invalid"],
    ["package.json", '{"version":["44.0.0"]}', "electron-runtime-version-invalid"],
  ])("rejects invalid %s metadata", (relative, contents, reason) => {
    const value = fixture();
    writeFileSync(join(value.electron, relative), contents);
    expect(check(value.appRoot)).toEqual({ accepted: false, reason });
  });

  it("rejects same-length runtime bytes that differ from the official archive", () => {
    const value = fixture();
    writeFileSync(join(value.electron, "dist/LICENSE"), Buffer.alloc(1096));
    expect(check(value.appRoot)).toEqual({
      accepted: false, reason: "electron-runtime-identity-mismatch:dist/LICENSE",
    });
  });
});
