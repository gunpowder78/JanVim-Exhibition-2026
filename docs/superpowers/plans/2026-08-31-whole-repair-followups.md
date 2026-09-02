# Whole-Repair Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every Critical and Important finding from the whole-repair review without changing artwork scope, then produce an independently reviewed, reproducible dual-monitor G3 acceptance candidate.

**Architecture:** Preserve one deterministic controller clock and the existing primary-JanVim/secondary-Web split. Make acceptance evidence run-wide, make runtime ownership transactional, bind secondary recovery to the actual renderer lifetime, and freeze one statically verifiable Electron-main bundle before the launcher admits it.

**Tech Stack:** TypeScript 6, Electron 44, Vite 8/Rollup, Vitest 4, PowerShell 7, Zod 4, Node 22.23.0.

**Spec:** `docs/specs/2026-08-28-dual-projector-generative-performance-design.md`, `docs/plans/2026-08-28-four-day-dual-projector-delivery.md`, and the findings recorded in `.superpowers/sdd/2026-08-30-task14-review-repairs/progress.md`.

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\task1` on `feat/task1-workflow`.
- Do not modify the JanVim product repository, any JanVim worktree, user Neovim configuration, source poem/media, the three incident-protected directories, or the checked-in unconfirmed display map.
- Consume JanVim only through the immutable identity in `janvim-artifact.lock.json`.
- Do not start a real show, inject global keyboard/mouse input, rotate displays, alter networking, kill real processes, or claim physical-projector acceptance during implementation.
- Before every production behavior change, add a deterministic failing test and capture the intended RED. Use fake time; every wait, list, retry, read, log, and cleanup remains finitely bounded.
- One fresh implementation worker per task. After its focused GREEN and commit, use a fresh independent reviewer; the controller then repeats the stated verification before the next task begins.
- Keep commits additive. Do not amend, reset, rewrite, or merge unrelated user changes.
- Do not run a pathless full suite inside a repair task. The complete suite belongs only to the final gate after all scoped tasks and reviews pass.

## Task R1: Preserve Run-Wide Acceptance Failures

**Finding:** Critical C1. The retained three-loop and eight-network-snapshot tails can age an earlier Show-mode violation out of the evidence record, allowing a later pass.

**Files:**

- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/src/show-run-coordinator.test.ts`
- Modify: `apps/controller/src/show-run-evidence.ts`
- Modify: `apps/controller/src/show-run-evidence.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/src/show-runtime-adapters.test.ts`
- Modify: `tests/recovery.test.ts`
- Modify only if its strict parser requires the schema bump: `scripts/start-show.ps1`
- Modify only if launcher evidence fixtures require it: `tests/start-show.test.ts`

### R1.1 RED: prove old failures age out

Add deterministic coordinator/evidence regressions that demonstrate all three unsafe sequences:

1. Startup offline, first completed loop online, enough later offline samples to evict that online sample, shutdown offline.
2. First completed loop has an incomplete resource sample, followed by enough clean loops to evict it from the three-loop tail.
3. First completed loop grows a runtime counter, followed by enough clean loops to evict it from the three-loop tail.

Assert the current implementation can incorrectly construct a passing terminal Show record. Run only the affected test files and record the expected failures in the progress ledger.

### R1.2 GREEN: add schema-2 run aggregates

Change only the show-run evidence schema from version 1 to version 2. Do not change unrelated renderer, display-map, lease, media, or artifact schemas.

Extend `CoordinatorAggregate` and `RunAggregateEvidence` with safe, nonnegative, run-wide counters:

- `resourceIncompleteLoopCount`
- `runtimeCountGrowthLoopCount`

Retain `offlineSampleCount` and `onlineSampleCount`, but make their schema-2 meaning explicitly run-wide. Increment all four counters before any retained-tail trimming occurs.

Schema invariants:

- `Soak3`: aggregate network and loop-violation counters must exactly equal the retained complete run.
- `Show`: each aggregate counter must be at least the corresponding retained-tail count.
- A passing record requires `onlineSampleCount === 0`, `resourceIncompleteLoopCount === 0`, and `runtimeCountGrowthLoopCount === 0`.
- `offlineSampleCount + onlineSampleCount` must equal the controller's bounded run-wide sample total appropriate to the completed lifecycle, not merely the tail length.
- `offlineVerified` must derive from run-wide counters.
- Schema 1 must not be silently interpreted with schema-2 semantics or accepted as fresh current-run proof.

Keep retained tails bounded at their current sizes for diagnostics.

### R1.3 Verify, document, commit

Run:

```powershell
npx vitest run apps/controller/src/show-run-coordinator.test.ts apps/controller/src/show-run-evidence.test.ts apps/controller/src/show-runtime-adapters.test.ts tests/recovery.test.ts
npm run typecheck
npm run lint
```

Update strict PowerShell fixtures only when the RED proves the schema boundary requires it. Commit exact R1 files with message `fix: preserve run-wide show acceptance failures`.

Fresh review must explicitly replay the three age-out sequences and confirm no schema-1 ambiguity remains. The controller repeats the focused commands before R2.

## Task R2: Make Surface Adoption and Session Cleanup Transactional

**Findings:** Important I1 and I2. A secondary can be assigned before listener registration succeeds, and a failed bridge close is absent from cleanup settlement, allowing replacement while the old bridge remains owned.

**Files:**

- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/src/show-run-coordinator.test.ts`
- Modify only if the real adapter exposes a missing close invariant: `apps/controller/src/show-runtime-adapters.ts`
- Modify only if needed for that invariant: `apps/controller/src/show-runtime-adapters.test.ts`

### R2.1 RED: enumerate ownership failures

Add table-driven deterministic tests for listener-registration failure at every candidate-adoption path:

- boot
- retained-session secondary recovery
- hold/recovery after secondary loss
- full session replacement
- operator restart with no retained surface

For each path, force either `onEvent` or `onDestroyed` registration to throw. Assert the candidate is closed, never published as current, has no leaked listener/disposer, and cannot leave the controller actionable with an unbound surface.

Add cleanup regressions for bridge close rejection and timeout. Assert replacement does not proceed and a shutdown/evidence result cannot claim full settlement.

### R2.2 GREEN: atomic adoption and complete settlement

Introduce one coordinator helper that stages both secondary listener registrations and the candidate surface. Publish the surface and its complete disposer set atomically only after every registration succeeds. On failure, dispose successful registrations and close the unpublished candidate exactly once. Apply this helper at all five adoption paths and to rebind-only paths.

Extend `SessionCleanupResult` with `bridgeClosed`. Define full settlement as:

```text
childSettled && leaseRemoved && bridgeClosed
```

Do not clear the owning session, advance replacement, or report actionable readiness while any component remains unsettled. Retain ownership so bounded shutdown/recovery can retry. A failed/timed-out bridge close must flow into existing shutdown failure/evidence fields rather than being swallowed.

Keep cleanup coalesced and bounded; do not add an unbounded retry loop.

### R2.3 Verify and commit

Run:

```powershell
npx vitest run apps/controller/src/show-run-coordinator.test.ts apps/controller/src/show-runtime-adapters.test.ts
npm run typecheck
npm run lint
```

Commit exact R2 files with message `fix: retain surface and bridge ownership transactionally`.

Fresh review must inspect every candidate-adoption call site and trace bridge ownership through recovery, replacement, and final shutdown. The controller repeats the focused commands before R3.

## Task R3: Bind Recovery to Renderer Lifetime and Start Identity

**Finding:** Important I3. Killing an Electron renderer emits `render-process-gone`, not necessarily `BrowserWindow.closed`; PID-only operator evidence is vulnerable to PID reuse.

**Files:**

- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/src/show-runtime-adapters.test.ts`
- Modify: `tests/recovery.test.ts`
- Modify: `docs/operations/rehearsal-runbook.md`
- Modify: `docs/operations/incident-log-template.md`

### R3.1 RED: renderer loss and identity ambiguity

Add real-adapter contract tests that prove:

- `render-process-gone` invokes the existing `onDestroyed` lifecycle even while the BrowserWindow remains open.
- A later `closed` event does not notify twice.
- An intentional controller close does not schedule recovery.
- Listener cleanup removes the native `render-process-gone` handler.
- Renderer start-time inspection failure, renderer PID change during inspection, loss during inspection, or abort prevents surface publication.
- A successful `secondary-opened` log contains strict `rendererPid` and `rendererStartedAtUtc` identity.

Add runbook contract tests that reject a current-run `secondary-opened` record lacking start identity, reject mismatched `Get-Process` start time, and still tolerate a structurally valid legacy record only when it cannot match the current run/generation.

### R3.2 GREEN: one-shot loss latch and exact identity

Register a WebContents `render-process-gone` listener before navigation. Route it and BrowserWindow `closed` through one idempotent loss latch. Suppress recovery notifications after an intentional controller close and remove native listeners during disposal.

After navigation succeeds, obtain the renderer PID and inspect its UTC start time with the existing bounded PowerShell process-identity primitive. Recheck abort/loss state and PID before publishing. Log `secondary-opened` with:

- run/controller identity
- generation
- renderer PID
- renderer start time in strict UTC ISO format

Keep renderer identity in the strict log, not in the lease. Update the recovery runbook so an operator must compare both PID and StartTime immediately before a scoped renderer fault. Current matching legacy records fail closed; unrelated historical legacy records may be ignored after bounded structural validation.

### R3.3 Verify and commit

Run:

```powershell
npx vitest run apps/controller/src/show-runtime-adapters.test.ts tests/recovery.test.ts
npm run typecheck
npm run lint
```

Commit exact R3 files with message `fix: bind secondary recovery to renderer lifetime identity`.

Fresh review must compare the adapter contract with Electron's renderer-loss semantics and inspect the runbook's current-versus-historical record handling. The controller repeats the focused commands before R4.

## Task R4: Freeze One Complete Static Electron-Main Artifact

**Finding:** Critical C2. The current graph verifier ignores bare-package imports and dynamically imports adapters before launcher claims, so the admitted artifact omits `zod` and `@janvim-exhibition/show-schema` and executes unclaimed code.

**Files:**

- Create: `apps/controller/vite.main.config.ts`
- Modify: `package.json`
- Modify: `apps/controller/package.json`
- Modify: `packages/show-schema/package.json`
- Modify mechanically with npm: `package-lock.json`
- Modify: `scripts/verify-electron-module-graph.mjs`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/electron-build-smoke.test.ts`
- Modify: `tests/start-show.test.ts`
- Modify if strict launch contracts reference the old path: `tests/g2-launcher.test.ts`
- Modify if offline packaging asserts the old graph: `tests/offline-package.test.ts`

### R4.1 RED: prove dependency and pre-claim gaps

Add tests that fail against the current verifier/launcher:

- A fixture with an undeclared bare import is rejected rather than skipped.
- A sentinel adapter module is never executed by verification.
- The real production Electron-main artifact is one bundle and has no reachable unclaimed package files/chunks.
- The launcher freezes the exact Node executable before version check and graph verification; mutation/replacement before or during verification fails closed.
- The strict manifest accepts exactly the one main bundle and a finite list of permitted runtime externals.

### R4.2 GREEN: bundle packages and verify without execution

Create a dedicated Vite Electron-main ESM build that:

- bundles controller code, `@janvim-exhibition/show-schema`, and `zod` into one deterministic `apps/controller/dist/main/electron-main.js` artifact;
- externalizes only exact `electron` and validated built-in `node:` module specifiers;
- disables code splitting, minification, compressed-size reporting, and source-map output;
- empties only `dist/main` and emits no dynamic chunks.

Correct workspace package topology:

- controller declares the correct `file:../../packages/show-schema` dependency and direct `zod` dependency;
- show-schema declares runtime `zod` under `dependencies`, not only `devDependencies`;
- regenerate `package-lock.json` with the pinned npm dependency graph.

Replace the verifier's dynamic adapter imports with pure static AST verification. It must reject relative/chunk imports in the one-file artifact, reject any bare import except exact `electron`, reject non-built-in or ambiguous `node:` imports, reject `require`, and emit a strict bounded manifest containing the single file hash/size and sorted finite runtime externals.

Update the launcher to:

- require the new bundle path and package `main` value;
- stop requiring a separate show-adapter entry;
- open frozen claims on the verifier, parser/runtime metadata, and resolved exact Node executable before invoking Node;
- require schema-2 one-bundle graph output and hash-claim the bundle before Electron starts;
- preserve all existing watchdog, cleanup, and finite-output bounds.

### R4.3 Verify and commit

Run:

```powershell
npm ci
npx vitest run tests/electron-build-smoke.test.ts tests/start-show.test.ts tests/g2-launcher.test.ts tests/offline-package.test.ts
npm run typecheck
npm run lint
npm run build
```

Inspect the emitted manifest and prove there is exactly one main artifact and no verifier side effect. Commit exact R4 files with message `fix: freeze one bundled electron main artifact`.

Fresh architecture/security review must trace every runtime import and every launcher claim from disk to Electron start. The controller repeats the focused commands and checks a clean status before the final gate.

## Final Whole-Repair Review and Automated Gate

Use a fresh reviewer over `bd898cb541ab246fa2b0fcceba723a1bbc544273..HEAD`. Require an explicit closure decision for C1, C2, I1, I2, and I3, plus a new Critical/Important scan. Repair any new blocker with the same RED-first, fresh-review process before continuing.

Then run from the task1 worktree:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
git status --short
```

Additionally verify:

- immutable JanVim artifact identity and protected-tree hashes are unchanged;
- checked-in display map is still unconfirmed;
- no product source, user config, source poem/media, incident-protected directory, or forbidden process/network automation was added;
- compiled Electron manifest is one statically verified, claimed main bundle;
- all evidence/recovery resources remain finite;
- the final worktree is clean.

Record exact commands, counts, hashes, commit IDs, and review decisions in `.superpowers/sdd/2026-08-30-task14-review-repairs/progress.md`.

## G3 and G4 Handoff

After the automated gate, stop before any physical action and hand the user a short dual-monitor checklist. With the user present:

1. Confirm the actual DISPLAY1/DISPLAY2 mapping and write only the rehearsal-specific confirmed map, never silently changing the checked-in placeholder.
2. Run three consecutive monitor-simulation loops, one offline loop, and one exact-identity forced renderer-restart recovery.
3. Record mapping, resolution, scale, rotation, artifact/content hashes, loop count, drift, reset result, recovery result, and operator notes.
4. Require visual confirmation that start/reset controls work, cue overlays align with the editor, generated text is removed by reset, and no stale poetry remains.

This completes G3 only. G4 remains pending until three consecutive loops, an offline run, and a forced-restart rehearsal are repeated on two physical projectors.
