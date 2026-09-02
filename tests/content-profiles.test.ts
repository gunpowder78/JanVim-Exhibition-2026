import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { parseShowManifest, type ShowManifest } from "../packages/show-schema/src/index.ts";

const root = process.cwd();
const lockPath = join(root, "content", "p0.1", "content-lock.json");
const poemHash = "b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8";
const profileIds = [
  "p0-baseline",
  "songfeng-source",
  "river-channel",
  "tower-codebook",
] as const;
const longProfileIds = profileIds.slice(1);
const hexHash = /^[0-9a-f]{64}$/u;
const relativePath = /^content\/p0\.1\/profiles\/[a-z0-9-]+\/(?:paper\.md|show\.manifest\.json)$/u;

type LockedFile = { path: string; bytes: number; sha256: string };
type LockedProfile = {
  id: string;
  title: string;
  revision: string;
  paper: LockedFile;
  manifest: LockedFile;
};
type ContentLock = {
  schema: number;
  revision: string;
  poem: LockedFile;
  profiles: LockedProfile[];
};

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function absolute(relative: string): string {
  return join(root, ...relative.split("/"));
}

function readLock(): ContentLock {
  expect(existsSync(lockPath), "content lock must exist").toBe(true);
  expect(statSync(lockPath).size).toBeLessThanOrEqual(32 * 1024);
  return JSON.parse(readFileSync(lockPath, "utf8")) as ContentLock;
}

function expectExactKeys(value: object, expected: readonly string[]): void {
  expect(Object.keys(value).sort()).toEqual([...expected].sort());
}

function lockedProfile(lock: ContentLock, id: string): LockedProfile {
  const profile = lock.profiles.find((candidate) => candidate.id === id);
  expect(profile, `missing locked profile ${id}`).toBeDefined();
  return profile!;
}

describe("P0.1 frozen content profiles", () => {
  it("publishes one strict bounded lock with the exact approved allowlist", () => {
    const lock = readLock();
    expectExactKeys(lock, ["schema", "revision", "poem", "profiles"]);
    expect(lock.schema).toBe(1);
    expect(lock.revision).toMatch(/^20260902-p0\.1-r[0-9]+$/u);
    expect(lock.profiles.map(({ id }) => id)).toEqual(profileIds);
    expect(new Set(lock.profiles.map(({ id }) => id)).size).toBe(profileIds.length);
    expect(new Set(lock.profiles.map(({ revision }) => revision)).size).toBe(profileIds.length);

    expectExactKeys(lock.poem, ["path", "bytes", "sha256"]);
    expect(lock.poem).toMatchObject({
      path: "content/fixture/poem.txt",
      bytes: 64,
      sha256: poemHash,
    });

    for (const profile of lock.profiles) {
      expectExactKeys(profile, ["id", "title", "revision", "paper", "manifest"]);
      expect(profile.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
      expect(profile.title.length).toBeGreaterThan(0);
      expect(profile.revision).toMatch(
        profile.id === "p0-baseline"
          ? /^20260828-[0-9]+$/u
          : /^20260902-[a-z0-9.-]+$/u,
      );
      for (const [kind, file] of [
        ["paper", profile.paper],
        ["manifest", profile.manifest],
      ] as const) {
        expectExactKeys(file, ["path", "bytes", "sha256"]);
        expect(file.path).toMatch(relativePath);
        expect(posix.normalize(file.path)).toBe(file.path);
        expect(file.path.startsWith(`content/p0.1/profiles/${profile.id}/`)).toBe(true);
        expect(file.path.endsWith(kind === "paper" ? "/paper.md" : "/show.manifest.json")).toBe(true);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.bytes).toBeLessThanOrEqual(kind === "paper" ? 32 * 1024 : 128 * 1024);
        expect(file.sha256).toMatch(hexHash);
        const path = absolute(file.path);
        expect(existsSync(path), `${file.path} must exist`).toBe(true);
        expect(statSync(path).size).toBe(file.bytes);
        expect(hash(path)).toBe(file.sha256);
      }
    }
  });

  it("preserves the accepted P0 active manifest as an exact rollback profile", () => {
    const profile = lockedProfile(readLock(), "p0-baseline");
    const active = join(root, "content", "fixture", "show.manifest.json");
    expect(readFileSync(absolute(profile.manifest.path))).toEqual(readFileSync(active));
  });

  it.each(longProfileIds)("bounds the %s paper and deterministic choreography", (id) => {
    const profile = lockedProfile(readLock(), id);
    const paper = readFileSync(absolute(profile.paper.path), "utf8");
    const lines = paper.trimEnd().split("\n");
    const chineseCharacters = paper.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
    expect(lines.length).toBeGreaterThanOrEqual(48);
    expect(lines.length).toBeLessThanOrEqual(64);
    expect(chineseCharacters).toBeGreaterThanOrEqual(1_400);
    expect(chineseCharacters).toBeLessThanOrEqual(2_000);
    expect(paper).toMatch(/entropy|source coding|H\(X\)|mutual information|I\(X;Y\)|channel capacity|noisy channel|codebook|KL divergence|rate-distortion/iu);

    const manifest = parseShowManifest(
      JSON.parse(readFileSync(absolute(profile.manifest.path), "utf8")),
    );
    expect(manifest.loopDurationMs).toBe(165_000);
    expect(manifest.poemSha256).toBe(poemHash);
    expect(manifest.contentRevision).toBe(profile.revision);
    const firstEditorIndex = manifest.cues.findIndex(
      (cue) =>
        cue.kind === "editor-action" && cue.payload.action.type !== "reset",
    );
    const completionIndex = manifest.cues.findIndex(
      (cue) =>
        cue.kind === "token-stream" &&
        cue.target !== "main" &&
        cue.payload.complete === true &&
        typeof cue.payload.text === "string" &&
        cue.payload.text.trim().length > 0,
    );
    const acceptanceIndex = manifest.cues.findIndex(
      (cue) =>
        cue.kind === "token-stream" &&
        cue.target !== "main" &&
        cue.payload.accepted === true &&
        typeof cue.payload.summary === "string" &&
        cue.payload.summary.trim().length > 0,
    );
    expect(firstEditorIndex).toBeGreaterThan(0);
    expect(completionIndex).toBeGreaterThanOrEqual(0);
    expect(acceptanceIndex).toBeGreaterThan(completionIndex);
    expect(firstEditorIndex).toBeGreaterThan(acceptanceIndex);
    const actions = manifest.cues
      .filter((cue) => cue.kind === "editor-action")
      .map((cue) => cue.payload.action);
    const inserts = actions.filter((action) => action.type === "insert");
    const moves = actions.filter((action) => action.type === "move");
    const resets = actions.filter((action) => action.type === "reset");
    expect(inserts.length).toBeGreaterThanOrEqual(12);
    expect(inserts.length).toBeLessThanOrEqual(18);
    expect(moves.length).toBeGreaterThanOrEqual(18);
    expect(moves.length).toBeLessThanOrEqual(28);
    expect(resets).toHaveLength(1);
    expect(inserts.map((action) => action.type === "insert" ? action.text : "").join(""))
      .toBe(`\n\n${paper}`);
    for (const action of inserts) {
      if (action.type !== "insert") throw new Error("unreachable insert narrowing");
      expect(Buffer.byteLength(action.text, "utf8")).toBeLessThanOrEqual(512);
      const intervalMs =
        action.charsPerSecond === 0
          ? 0
          : Math.max(1, Math.floor(1_000 / action.charsPerSecond));
      const durationMs = intervalMs * Array.from(action.text).length;
      expect(
        durationMs,
        `${id} insert at ${action.charsPerSecond} chars/s exceeds the JanVim 1500 ms action cap`,
      ).toBeLessThanOrEqual(1_500);
    }
    const finalCue = manifest.cues.at(-1);
    expect(finalCue).toMatchObject({
      atMs: 165_000,
      target: "main",
      kind: "editor-action",
      payload: { action: { type: "reset" } },
    } satisfies Partial<ShowManifest["cues"][number]>);
  });

  it("forces LF checkout bytes for every reviewed hash input", () => {
    const paths = [
      "janvim-artifact.lock.json",
      "content/fixture/show.manifest.json",
      "content/p0.1/content-lock.json",
      "content/p0.1/profiles/songfeng-source/paper.md",
      "nvim/lua/janvim_exhibition/init.lua",
    ];
    const result = spawnSync("git", ["check-attr", "eol", "--", ...paths], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status, result.stderr).toBe(0);
    for (const path of paths) expect(result.stdout).toContain(`${path}: eol: lf`);
  });
});
