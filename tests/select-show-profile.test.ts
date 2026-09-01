import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const productionScript = join(repositoryRoot, "scripts", "select-show-profile.ps1");

type Fixture = { root: string; script: string; active: string; cleanup: () => void };

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "janvim-profile-selector-"));
  const script = join(root, "scripts", "select-show-profile.ps1");
  const active = join(root, "content", "fixture", "show.manifest.json");
  mkdirSync(dirname(script), { recursive: true });
  mkdirSync(dirname(active), { recursive: true });
  copyFileSync(productionScript, script);
  copyFileSync(join(repositoryRoot, "AGENTS.md"), join(root, "AGENTS.md"));
  copyFileSync(join(repositoryRoot, "content", "fixture", "poem.txt"), join(root, "content", "fixture", "poem.txt"));
  copyFileSync(join(repositoryRoot, "content", "fixture", "show.manifest.json"), active);
  cpSync(join(repositoryRoot, "content", "p0.1"), join(root, "content", "p0.1"), { recursive: true });
  return { root, script, active, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(value: Fixture, profile: string): SpawnSyncReturns<string> {
  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", value.script, "-Profile", profile], {
    cwd: value.root,
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
}

describe("frozen show profile selector", () => {
  it("atomically selects every allowlisted profile and is idempotent", () => {
    const value = fixture();
    try {
      for (const profile of ["songfeng-source", "river-channel", "tower-codebook", "p0-baseline"]) {
        const selected = run(value, profile);
        expect(selected.status, `${selected.stdout}\n${selected.stderr}`).toBe(0);
        const receipt = JSON.parse(selected.stdout.trim()) as Record<string, unknown>;
        expect(receipt).toMatchObject({ schema: 1, profile, outcome: "applied" });
        expect(receipt.manifestSha256).toBe(hash(value.active));
        expect(receipt.manifestBytes).toBe(statSync(value.active).size);
        const repeated = run(value, profile);
        expect(repeated.status, repeated.stderr).toBe(0);
        expect(JSON.parse(repeated.stdout.trim())).toMatchObject({
          schema: 1,
          profile,
          outcome: "already-active",
        });
      }
    } finally {
      value.cleanup();
    }
  }, 20_000);

  it.each([
    ["unknown profile", "not-reviewed", undefined],
    ["changed lock", "songfeng-source", "lock"],
    ["changed paper", "songfeng-source", "paper"],
    ["changed manifest", "songfeng-source", "manifest"],
    ["oversize lock", "songfeng-source", "oversize"],
  ] as const)("rejects %s without changing the active manifest", (_label, profile, mutation) => {
    const value = fixture();
    try {
      const before = readFileSync(value.active);
      if (mutation === "lock") {
        const path = join(value.root, "content", "p0.1", "content-lock.json");
        writeFileSync(path, `${readFileSync(path, "utf8")} `, "utf8");
      } else if (mutation === "paper") {
        const path = join(value.root, "content", "p0.1", "profiles", "songfeng-source", "paper.md");
        writeFileSync(path, `${readFileSync(path, "utf8")}篡改`, "utf8");
      } else if (mutation === "manifest") {
        const path = join(value.root, "content", "p0.1", "profiles", "songfeng-source", "show.manifest.json");
        writeFileSync(path, `${readFileSync(path, "utf8")} `, "utf8");
      } else if (mutation === "oversize") {
        const path = join(value.root, "content", "p0.1", "content-lock.json");
        writeFileSync(path, Buffer.alloc(32 * 1024 + 1, 0x20));
      }
      const result = run(value, profile);
      expect(result.status, result.stdout).not.toBe(0);
      expect(readFileSync(value.active)).toEqual(before);
    } finally {
      value.cleanup();
    }
  });
});
