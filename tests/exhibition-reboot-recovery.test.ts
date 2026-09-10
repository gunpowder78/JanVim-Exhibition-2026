import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const modulePath = resolve("deployment/operator/lib/Exhibition.Deployment.psm1");
const boot = "2026-09-09T10:00:00.0000000Z";
const old = "2026-09-08T10:00:00.0000000Z";
const identity = { pid: 4321, startedAtUtc: old, executable: "C:\\Windows\\System32\\old-show.exe" };
const marker = { schema: 1, runRoot: "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\old-run", sessionFile: "D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\old-run\\session.json", soundWrapper: identity, jianshan: identity, showWrapper: identity, controller: identity };

function run(value: unknown, modified = old, archiveExists = false) {
  const root = mkdtempSync(join(tmpdir(), "janvim-reboot-recovery-"));
  const pointer = join(root, "active-deployment.json");
  const archive = join(root, "previous-active-deployment.json");
  const bytes = typeof value === "string" ? value : JSON.stringify(value);
  try {
    if (value !== undefined) { writeFileSync(pointer, bytes); utimesSync(pointer, new Date(modified), new Date(modified)); }
    if (archiveExists) writeFileSync(archive, "preserved evidence");
    const process = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'
      Import-Module ${quote(modulePath)} -Force
      Restore-ExhibitionStartupAfterReboot -Path ${quote(pointer)} -ArchiveRoot ${quote(root)} -BootTimeUtc ([datetime]${quote(boot)}) | ConvertTo-Json -Compress
    `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return { code: process.status, stdout: process.stdout, stderr: process.stderr, pointer: existsSync(pointer) ? readFileSync(pointer, "utf8") : undefined, archive: existsSync(archive) ? readFileSync(archive, "utf8") : undefined, bytes };
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + "\\")) throw new Error("unsafe-test-root");
    rmSync(root, { recursive: true, force: true });
  }
}

describe("startup recovery after power loss using a fixed boot time", () => {
  it("holds the machine-wide launch mutex against another process until shutdown", async () => {
    const keeper = spawn("pwsh", ["-NoProfile", "-NonInteractive", "-Command", `
      $ErrorActionPreference='Stop'; Import-Module ${quote(modulePath)} -Force
      $guard=Enter-ExhibitionLaunchGuard
      try { Write-Output 'guard-ready'; [Console]::Out.Flush(); [void][Console]::In.ReadLineAsync().Wait(10000) }
      finally { $guard.ReleaseMutex(); $guard.Dispose() }
    `], { windowsHide: true });
    try {
      await new Promise<void>((yes, no) => {
        const timer = setTimeout(() => no(new Error("guard-ready-timeout")), 5000);
        keeper.once("exit", () => { clearTimeout(timer); no(new Error("guard-exited-before-ready")); });
        keeper.stdout.on("data", bytes => {
          if (String(bytes).includes("guard-ready")) { clearTimeout(timer); yes(); }
        });
      });
      const contender = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", String.raw`
        $guard=[Threading.Mutex]::new($false,'Global\JanVimExhibitionDeployment')
        $owned=$guard.WaitOne(0)
        try { $owned | ConvertTo-Json -Compress } finally { if($owned){$guard.ReleaseMutex()}; $guard.Dispose() }
      `], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      expect(contender.status, contender.stderr).toBe(0);
      expect(JSON.parse(contender.stdout)).toBe(false);
    } finally {
      keeper.stdin.end("\n");
      if (keeper.exitCode === null) {
        await new Promise<void>(done => {
          const timer = setTimeout(() => { keeper.kill(); done(); }, 3000);
          keeper.once("exit", () => { clearTimeout(timer); done(); });
        });
      }
    }
  }, 15_000);

  it("preserves the exact old marker and clears it when every process belongs to the previous boot", () => {
    const result = run(marker);
    expect(result.code, result.stderr).toBe(0);
    expect(result.pointer).toBeUndefined();
    expect(result.archive).toBe(result.bytes);
    expect(JSON.parse(result.stdout).status).toBe("previous-boot-marker-preserved");
  });
  it("does nothing when there is no active marker", () => {
    const result = run(undefined);
    expect(result.code, result.stderr).toBe(0);
    expect(result.archive).toBeUndefined();
  });
  it.each([
    { value: marker, modified: boot },
    { value: { ...marker, controller: { ...identity, startedAtUtc: boot } }, modified: old },
    { value: { ...marker, controller: { ...identity, startedAtUtc: "2026-09-10T00:00:00.0000000Z" } }, modified: old },
    { value: { ...marker, extra: true }, modified: old },
    { value: "{broken", modified: old },
  ])("retains current-boot, inconsistent, or invalid evidence: %j", ({ value, modified }) => {
    const result = run(value, modified);
    expect(result.code).not.toBe(0);
    expect(result.pointer).toBe(result.bytes);
    expect(result.archive).toBeUndefined();
  });
  it("never overwrites a previous recovery archive", () => {
    const result = run(marker, old, true);
    expect(result.code).not.toBe(0);
    expect(result.pointer).toBe(result.bytes);
    expect(result.archive).toBe("preserved evidence");
  });
});
