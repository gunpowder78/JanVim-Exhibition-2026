# P0.1 Frozen Content Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Every production behavior begins with a focused failing test.

**Goal:** Add three long-form deterministic exhibition profiles plus the accepted P0 rollback,
stage them safely through one selector, and make the existing launcher fail closed unless every
selected byte belongs to the reviewed content lock.

**Architecture:** Static papers and manifests are frozen under `content/p0.1/profiles`. A strict,
byte-pinned `content-lock.json` is interpreted by PowerShell. The selector atomically stages one
approved manifest at the controller's existing fixed path; `start-show.ps1` independently
revalidates and freezes the lock, selected paper, manifest, and poem before launch. No compiled
runtime code changes.

**Tech Stack:** PowerShell 7, JSON, TypeScript/Vitest repository tests, existing show-schema,
Electron 44 build verification.

**Spec:** `docs/superpowers/specs/2026-09-02-p0-1-content-profiles-design.md`

## Global constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\p0-1-content` on
  `feat/p0-1-content-profiles`.
- Never modify the JanVim product repository, immutable artifact, user Neovim configuration,
  source poem/media, accepted P0 worktree, or protected incident directories.
- Keep `content/fixture/show.manifest.json` as the active path and keep `p0-baseline` as rollback.
- Keep all runtime behavior offline, deterministic, bounded, and controlled by the existing clock.
- Do not modify TypeScript, Lua, Electron runtime, bridge protocol, or theme configuration.
- Use LF for every raw-byte-hashed text file.
- Stage only task-listed paths; never use `git add -A`.
- Do not claim completion without fresh full-gate output and exact bundle identity.

---

### Task 1: Specify the frozen content contract with failing tests

**Files:**

- Create: `tests/content-profiles.test.ts`
- Create: `tests/select-show-profile.test.ts`
- Modify: `tests/start-show.test.ts`

- [x] Add tests that require exactly the four approved profile IDs, strict lock property sets,
  canonical relative paths, unique revisions, bounded lock/paper/manifest bytes, and matching
  SHA-256 values.
- [x] Add tests that require each long profile to have 165,000 ms duration, 48–64 paper lines,
  1,400–2,000 Chinese characters, 12–18 inserts, 18–28 moves, bounded insert payloads, and one
  exact final reset; require all manifests to retain the original poem digest.
- [x] Add an LF-attribute test for the lock, profiles, active manifest, artifact lock, and Lua hash
  inputs.
- [x] Add real selector fixture tests for allowed selection, unknown profile rejection, lock/member
  tampering, oversize input rejection, idempotence, and unchanged target after every failure.
- [x] Extend launcher fixture tests so missing, altered, oversize, ambiguous, or path-invalid lock
  state fails before Electron, while every locked active profile validates.
- [x] Run focused tests and record the expected failures caused by absent P0.1 assets/script and the
  launcher's old single-manifest hash contract.

Commit: `test: specify frozen P0.1 content profiles`

### Task 2: Freeze the reviewed papers, manifests, and content lock

**Files:**

- Modify: `.gitattributes`
- Create: `content/p0.1/profiles/p0-baseline/paper.md`
- Create: `content/p0.1/profiles/p0-baseline/show.manifest.json`
- Create: `content/p0.1/profiles/songfeng-source/paper.md`
- Create: `content/p0.1/profiles/songfeng-source/show.manifest.json`
- Create: `content/p0.1/profiles/river-channel/paper.md`
- Create: `content/p0.1/profiles/river-channel/show.manifest.json`
- Create: `content/p0.1/profiles/tower-codebook/paper.md`
- Create: `content/p0.1/profiles/tower-codebook/show.manifest.json`
- Create: `content/p0.1/content-lock.json`

- [x] Write original long-form themed papers with moderate English terminology and no runtime AI.
- [x] Encode the approved 165-second common cue topology with irregular but deterministic move and
  insert timing; preserve all schema and payload limits.
- [x] Copy the accepted active manifest byte-for-byte into the rollback profile and document it in
  a bounded rollback paper.
- [x] Generate exact byte counts and SHA-256 values in the strict content lock.
- [x] Pin every reviewed hash input to LF and run content contract tests to green.

Commit: `feat: freeze P0.1 exhibition content profiles`

### Task 3: Implement atomic profile selection

**Files:**

- Create: `scripts/select-show-profile.ps1`
- Modify: `tests/select-show-profile.test.ts`

- [x] Implement strict repository-marker, lock hash/schema, exact allowlist, path containment,
  member byte/hash, manifest bound, poem hash, and final-reset validation.
- [x] Stage through a unique same-directory temporary file, verify it, atomically replace the
  active manifest, and clean the temporary file in a bounded `finally` path.
- [x] Emit one compressed schema-1 JSON receipt and make repeated selection idempotent.
- [x] Run selector tests to green and confirm failure cases leave the active manifest unchanged.

Commit: `feat: add frozen show profile selector`

### Task 4: Interpret the content lock before every show launch

**Files:**

- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`

- [x] Replace the single hardcoded manifest digest with the pinned lock digest and strict bounded
  lock/member interpretation.
- [x] Require the active manifest to match exactly one allowlisted profile and validate its
  revision, poem digest, cue/action bounds, and terminal reset.
- [x] Add the lock and selected paper to frozen launch claims without changing public arguments,
  compiled controller behavior, or evidence schema.
- [x] Run focused launcher tests to green, including all four profile manifests and fail-before-
  Electron tamper cases.

Commit: `feat: validate locked content profiles at launch`

### Task 5: Full verification, review, and implementation receipt

**Files:**

- Modify: `docs/superpowers/plans/2026-09-02-p0-1-content-profiles.md`
- Create: `docs/operations/p0-1-content-profile-implementation-receipt.md`

- [x] Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`,
  `pwsh -NoProfile -File .\scripts\verify-runtime.ps1`, and `git diff --check`.
- [x] Verify the rebuilt Electron main bundle is exactly 451,940 bytes and SHA-256
  `aad1d8ab03a7bd7bff4d02530da24f832ed7a822cd4739f0c7f7f66a167c4727`.
- [x] Review the complete diff for repository boundaries, accidental compiled-code changes,
  placeholders, unbounded input, and rollback preservation.
- [x] Record commit, profile identities, hashes, gate results, bundle identity, remaining visual
  acceptance scope, and exact profile-selection commands in the implementation receipt.
- [x] Keep the isolated branch/worktree ready for the owner's dual-monitor visual inspection.

Commit: `docs: record P0.1 content profile verification`
