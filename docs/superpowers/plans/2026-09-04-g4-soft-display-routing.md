# G4 Soft Display Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a technician-controlled soft-role display mapping system that runs the accepted show on three explicitly assigned displays or in a clearly classified one-display JanVim preview, without guessing roles or changing Windows topology.

**Architecture:** A checked-in logical layout and an external GUI-generated schema-2 map feed one strict resolver. The existing schema-1 dual-display path remains byte-compatible; G4 adds a bounded configuration GUI, a grouped Narrative/Jianshan surface adapter, and an assigned-display topology guard around the existing coordinator.

**Tech Stack:** Electron 44, TypeScript 6, Zod 4, Vite 8, Vitest 4, plain DOM/CSS, PowerShell 7, JSON/SHA-256.

**Spec:** `docs/superpowers/specs/2026-09-04-g4-soft-display-routing-design.md`

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\g4-soft-display-routing` on `feat/g4-soft-display-routing`, based on `d79a929b77e8c4e3a3a8d81ca55404617459afbe`.
- Preserve the accepted `feat/p0-vim-layout-candidate` worktree and its runnable tag/commit; do not merge, push, or edit it.
- Never modify JanVim product source, the immutable packaged artifact, user Neovim configuration, source poem/media, Windows display topology, or protected incident directories.
- Keep schema-1 maps and their ID-bound geometry hash behavior unchanged as `legacy-dual`.
- Support exactly the approved soft roles `SCREEN-1`, `SCREEN-2`, and `SCREEN-3`; extra live displays are bounded, unassigned, and ignored.
- Do not infer roles, auto-open the GUI, auto-remap, auto-reconfigure Windows, auto-resume, or add Jianshan/OSC integration.
- Every file, field, display list, label, ID, timer, listener, IPC payload, window group, and topology reaction must have a finite bound.
- All GUI and artwork pages are local-only, sandboxed, context-isolated, navigation-guarded, and usable with the network disabled.
- Add and observe a deterministic failing test before every production behavior change.
- Do not claim G4 physical acceptance without the final human three-display, one-display, offline, and forced-recovery checks.
- Do not claim completion without fresh full-gate output and recorded Electron bundle bytes/SHA-256.

---

### Task 1: Strict logical layout, schema-2 map, and unified resolver

**Files:**
- Create: `show/display-layout.json`
- Create: `apps/controller/src/display-routing-contract.ts`
- Create: `apps/controller/tests/display-routing-contract.test.ts`
- Modify: `apps/controller/src/display-router.ts`
- Modify: `apps/controller/tests/display-router.test.ts`

**Interfaces:**
- Produces: `SoftDisplayId`, `DisplayMode`, `ShowRuntimeDisplay`, `DisplayMapV2`, `parseDisplayLayout(bytes)`, `parseDisplayMap(bytes)`, `hashDisplayGeometryV2(display)`, `hashDisplayTopology(displays)`, and `resolveDisplayRoute(displays, layout, map)`.
- Preserves: `DisplayMapConfig`, `hashDisplayGeometry()`, and schema-1 `routeDisplays()` behavior for old G2 consumers.
- Route output:

```ts
export type ResolvedDisplayRoute =
  | {
      state: "mapped";
      mode: "legacy-dual" | "production-3" | "single-display-preview";
      roles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>>;
      skippedRoles: readonly SoftDisplayId[];
      unassignedDisplays: readonly ShowRuntimeDisplay[];
    }
  | { state: "configuration-required"; reason: DisplayConfigurationReason };
```

- [x] **Step 1: Write strict contract tests and identify the mutations they catch**

  Use literal fixtures. Require the checked-in layout to contain only the approved roles/modes in
  the approved order. Require schema 2 to reject unknown fields, over-16 topology, over-limit
  IDs/labels, control characters, duplicate IDs/roles, mixed schema-1 fields, bad UTC, unsafe
  rectangles/scales/rotations, wrong layout hash, wrong geometry hash, and wrong topology hash.

  ```ts
  expect(resolveDisplayRoute([screen1, screen2, screen3], layout, map)).toMatchObject({
    state: "mapped",
    mode: "production-3",
    roles: { "SCREEN-1": screen1, "SCREEN-2": screen2, "SCREEN-3": screen3 },
    skippedRoles: [],
  });
  expect(resolveDisplayRoute([screen1], layout, previewMap)).toMatchObject({
    state: "mapped",
    mode: "single-display-preview",
    skippedRoles: ["SCREEN-2", "SCREEN-3"],
  });
  ```

- [x] **Step 2: Run focused tests and verify RED**

  Run:

  ```powershell
  & '.\node_modules\.bin\vitest.cmd' run `
    'apps\controller\tests\display-routing-contract.test.ts' `
    'apps\controller\tests\display-router.test.ts'
  ```

  Expected: FAIL because the schema-2 module, logical layout, and unified resolver do not exist.

- [x] **Step 3: Implement strict parsers and version-specific hashes**

  Parse from bounded `Uint8Array` before JSON conversion. Preserve the legacy hash and add a V2
  canonical array containing ID, bounds, working area, scale, and rotation. Use exact Zod objects,
  literal modes/roles, and clone/freeze public results. `topologySha256` is evidence of the capture;
  routing compares selected fingerprints so unassigned changes do not invalidate assigned roles.

- [x] **Step 4: Implement one resolver without changing legacy semantics**

  Normalize schema 1 to `SCREEN-1`/`SCREEN-2` and mode `legacy-dual`. For schema 2, require exactly
  three distinct bindings in `production-3`, exactly one `SCREEN-1` binding and exactly one live
  display in preview, and return bounded `configuration-required` reasons rather than throwing for
  expected environment mismatch.

- [x] **Step 5: Verify GREEN and legacy mutation coverage**

  Run the two focused files. Also mutate a schema-1 fixture with a third display and confirm the
  existing `display-count-mismatch` result remains covered.

- [x] **Step 6: Commit the independent routing contract**

  ```powershell
  git add -- `
    show/display-layout.json `
    apps/controller/src/display-routing-contract.ts `
    apps/controller/src/display-router.ts `
    apps/controller/tests/display-routing-contract.test.ts `
    apps/controller/tests/display-router.test.ts
  git commit -m 'feat: add G4 soft display routing contract'
  ```

### Task 2: Manual display-configuration GUI and atomic map publication

**Files:**
- Create: `apps/controller/src/display-config-command.ts`
- Create: `apps/controller/src/display-configurator.ts`
- Create: `apps/controller/src/display-config-preload.ts`
- Create: `apps/controller/src/display-config-preload-entry.ts`
- Create: `apps/controller/tests/display-config-command.test.ts`
- Create: `apps/controller/tests/display-configurator.test.ts`
- Create: `apps/controller/tests/display-config-preload.test.ts`
- Create: `apps/controller/vite.display-config-preload.config.ts`
- Create: `apps/display-configurator/package.json`
- Create: `apps/display-configurator/tsconfig.json`
- Create: `apps/display-configurator/vite.config.ts`
- Create: `apps/display-configurator/index.html`
- Create: `apps/display-configurator/identify.html`
- Create: `apps/display-configurator/src/main.ts`
- Create: `apps/display-configurator/src/model.ts`
- Create: `apps/display-configurator/src/identify.ts`
- Create: `apps/display-configurator/src/styles.css`
- Create: `apps/display-configurator/tests/model.test.ts`
- Modify: `apps/controller/src/show-command.ts`
- Modify: `apps/controller/src/electron-main.ts`
- Modify: `apps/controller/tests/show-command.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `scripts/configure-displays.ps1`
- Create: `tests/configure-displays.test.ts`

**Interfaces:**
- Consumes: Task 1 parsers, hashes, and strict role vocabulary.
- Produces: command family `display-config`, `runDisplayConfigurator(command, host)`, dedicated
  `janvimDisplayConfigurator` preload API, and public `configure-displays.ps1`.
- IPC contract:

```ts
type ConfigurationSnapshot = {
  topologySha256: string;
  displays: readonly NumberedDisplay[];
  allowedModes: readonly DisplayMode[];
};
type SaveDisplayMapRequest = {
  topologySha256: string;
  mode: DisplayMode;
  bindings: readonly { softId: SoftDisplayId; displayId: string }[];
};
```

- [x] **Step 1: Add command, GUI-state, IPC, and script behavior tests**

  Prove exact flags/path boundaries, exact sender URL, strict save payloads, empty initial role
  selection, distinct production bindings, preview only at one live display, stale topology save
  rejection, atomic map replacement, refusal when terminal evidence exists, and timer/listener
  cleanup. Renderer model tests must exercise real DOM state rather than mocked markup.

- [x] **Step 2: Run focused tests and verify RED**

  ```powershell
  & '.\node_modules\.bin\vitest.cmd' run `
    'apps\controller\tests\display-config-command.test.ts' `
    'apps\controller\tests\display-configurator.test.ts' `
    'apps\controller\tests\display-config-preload.test.ts' `
    'apps\display-configurator\tests\model.test.ts' `
    'tests\configure-displays.test.ts'
  ```

  Expected: FAIL because no configuration family, renderer, preload, or launcher exists.

- [x] **Step 3: Implement the command and least-privilege main-process runtime**

  Add exact `--display-config-mode=configure`, `--rehearsal-root=...`, and `--display-map=...`
  parsing. Require the map to be the direct child of one rehearsal root. Register only snapshot,
  identify, close-identify, and save handlers; verify sender URL and topology token on every call.
  Atomically write LF JSON through a same-directory temporary file and rename.

- [x] **Step 4: Implement bounded identify cards and the manual form**

  Sort cards by top edge, left edge, then ID and display `1..N`. Open local sandboxed cards only on
  the button action, cap at 16, and close all after 12 seconds or explicit close. Render selectors
  with no default role choices, explain SCREEN purposes and skipped roles, and disable Save until
  the selected mode is valid.

- [x] **Step 5: Add the dedicated preload/build and public launcher**

  Build the configurator preload separately so the Narrative page never receives map-write APIs.
  Append both new Vite builds without changing the existing preload output path. The PowerShell
  launcher checks required files, path boundaries, and source-repository markers before Electron.

- [x] **Step 6: Verify GREEN, build, and commit**

  Run the focused tests, `npm run typecheck`, `npm run lint`, and `npm run build`. Confirm both GUI
  pages and the dedicated preload exist in `dist`, then commit only Task 2 paths.

### Task 3: Three-screen surface group and one-screen visual preview

**Files:**
- Create: `show/jianshan-standby.html`
- Create: `apps/controller/src/show-surface-group.ts`
- Create: `apps/controller/tests/show-surface-group.test.ts`
- Modify: `apps/controller/src/display-router.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `apps/controller/src/g2-runtime-adapters.ts`
- Modify: `apps/controller/tests/g2-runtime-adapters.test.ts`

**Interfaces:**
- Consumes: `ResolvedDisplayRoute` from Task 1.
- Produces: `ShowSurfaceGroup`, which implements the existing `ShowSecondarySurface` contract while
  owning the Narrative window plus optional Jianshan standby window.
- Preserves: the coordinator sees one `ShowSecondarySurface`; its cue clock, presentation events,
  retries, and recovery budgets do not change.

- [x] **Step 1: Add surface-group and adapter integration tests**

  Prove that production opens Narrative on SCREEN-2 and standby on SCREEN-3, sends events only to
  Narrative, closes both idempotently, and reports either unexpected window loss once. Prove legacy
  opens only Narrative. Prove preview uses SCREEN-1 for the deliberate start surface, hides it after
  the accepted Start event, exposes no Narrative/Jianshan artwork, and places JanVim on SCREEN-1.

- [x] **Step 2: Run focused tests and verify RED**

  ```powershell
  & '.\node_modules\.bin\vitest.cmd' run `
    'apps\controller\tests\show-surface-group.test.ts' `
    'apps\controller\tests\show-runtime-adapters.test.ts' `
    'apps\controller\tests\g2-runtime-adapters.test.ts'
  ```

  Expected: FAIL because the G4 surface group and route consumption are absent.

- [x] **Step 3: Implement the static standby and grouped lifecycle**

  Use a script-free deep-background local page with bounded text `见山 / STANDBY`. Generalize only
  the fullscreen window-plan helper needed by both surfaces. Install the existing local-only web
  guards for each page and aggregate close/dispose without changing Narrative IPC.

- [x] **Step 4: Consume resolved roles in Show while preserving G2**

  Freeze and parse `show/display-layout.json` only for schema-2 Show maps. Use resolved role objects
  directly for opening and JanVim placement; do not re-look-up persisted IDs. Leave the schema-1
  G2 parser and its exactly-two behavior unchanged.

- [x] **Step 5: Implement preview visibility behavior**

  Keep the local start surface visible above SCREEN-1 through readiness, then call its bounded
  `hide()` exactly once when Start is accepted. It may continue receiving deterministic cues behind
  JanVim so existing loop accounting remains intact. The visible artwork after Start is JanVim only;
  Stop remains available through SIGINT/controller stop.

- [x] **Step 6: Verify GREEN and commit**

  Run the focused tests and `git diff --check`, then commit Task 3 paths.

### Task 4: Assigned-display topology guard and configuration-required outcome

**Files:**
- Create: `apps/controller/src/display-topology-guard.ts`
- Create: `apps/controller/tests/display-topology-guard.test.ts`
- Modify: `apps/controller/src/show-electron-command.ts`
- Modify: `apps/controller/tests/show-electron-command.test.ts`
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `apps/controller/src/electron-main.ts`

**Interfaces:**
- Produces: `DisplayTopologyGuard` with `start()`, `dispose()`, one 500 ms coalescing timer, and one
  callback reason `display-topology-changed`.
- Extends: `EmergencyStopReason` with `display-topology-changed` and expected startup result with
  `display-configuration-required`.

- [x] **Step 1: Add fake-clock topology and dispatcher tests**

  Exercise all three Electron events, event bursts, dispose-before-tick, extra unassigned changes,
  assigned ID/bounds/work-area/scale/rotation changes, invalid snapshots, and repeated events after
  the first stop. Assert one timer, one route recomputation, one emergency request, and no restart.
  Add command tests proving expected mapping mismatch returns exit 2 while unexpected validation or
  coordinator failures remain exit 1.

- [x] **Step 2: Run focused tests and verify RED**

  ```powershell
  & '.\node_modules\.bin\vitest.cmd' run `
    'apps\controller\tests\display-topology-guard.test.ts' `
    'apps\controller\tests\show-electron-command.test.ts' `
    'apps\controller\tests\show-run-coordinator.test.ts' `
    'apps\controller\tests\show-runtime-adapters.test.ts'
  ```

- [x] **Step 3: Implement expected configuration classification**

  Use a typed/controller-owned error or exact discriminant; do not parse arbitrary host messages.
  ValidateOnly and Show startup return 2 only for the resolver's bounded configuration reasons.
  No artwork process/window may open before a mapped route exists.

- [x] **Step 4: Implement and bind the topology guard**

  Subscribe only after inputs are validated, compare assigned role fingerprints from the frozen
  map, and dispose listeners/timer during every terminal path. Feed the new reason through the
  existing bounded emergency cleanup so poem reset, lease settlement, evidence finalization, and
  no-auto-restart semantics remain owned by the coordinator.

- [x] **Step 5: Verify GREEN and commit**

  Run the four focused files plus `apps/controller/tests/electron-lifecycle.test.ts`, then commit.

### Task 5: Evidence, public Show launcher, and legacy compatibility

**Files:**
- Modify: `apps/controller/src/show-run-evidence.ts`
- Modify: `apps/controller/tests/show-run-evidence.test.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`
- Modify: `tests/electron-build-smoke.test.ts`
- Modify: `docs/operations/rehearsal-runbook.md`
- Modify: `tests/recovery.test.ts`

**Interfaces:**
- Consumes: resolved route, frozen layout/map identities, placeholder and topology diagnostics.
- Produces: optional bounded `routing` evidence for schema-2 maps and launcher termination
  `configuration-required` for controller exit 2.

- [x] **Step 1: Add evidence and launcher tests before implementation**

  Require schema-2 map preflight to be strict and separate from unchanged schema-1 validation.
  Test layout/map byte caps and hashes, configuration exit 2 without watchdog relaunch, no terminal
  success claim, and preserved exit-1 behavior. Require routing evidence literals for production
  and preview, with preview acceptance scope and skipped roles. Prove schema-1 evidence still parses
  and existing launcher fixtures still pass.

- [x] **Step 2: Run focused tests and verify RED**

  ```powershell
  & '.\node_modules\.bin\vitest.cmd' run `
    'apps\controller\tests\show-run-evidence.test.ts' `
    'apps\controller\tests\show-runtime-adapters.test.ts' `
    'tests\start-show.test.ts' `
    'tests\recovery.test.ts'
  ```

- [x] **Step 3: Extend evidence without redefining legacy bytes**

  Add a strict optional routing record only for schema-2 map runs: mode, three SHA-256 identities,
  selected role records, skipped roles, unassigned count, standby use, and topology-stop boolean.
  Keep existing `display.primary`/`display.secondary` fields for readers and omit new routing fields
  from legacy runs.

- [x] **Step 4: Add strict PowerShell schema-2 validation and exit-2 receipt**

  Branch on integer map schema. Retain the existing exact schema-1 property checks verbatim. For
  schema 2, independently enforce exact fields, limits, hashes, role cardinality, and layout digest
  before Electron. If Electron returns 2, publish one bounded JSON receipt with
  `termination:"configuration-required"`, do not create success evidence, and do not relaunch.

- [x] **Step 5: Update operator documentation and release identity through RED**

  Document the manual GUI → ValidateOnly → Show sequence and single-display limitation. Build the
  bundle, record the new bytes/hash, first update the independent smoke-test expectation and observe
  launcher RED, then update only the launcher's reviewed bundle identity.

- [x] **Step 6: Verify focused GREEN and commit**

  Run the four focused files, Electron build smoke, and `git diff --check`, then commit.

### Task 6: Full verification and G4 human handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-04-g4-soft-display-routing.md`
- Create: `docs/operations/g4-soft-display-routing-implementation-receipt.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: fresh automated evidence, exact bundle identity, and bounded three-display/one-display
  operator acceptance instructions.

- [x] **Step 1: Run fresh required gates in order**

  ```powershell
  npm ci
  npm run typecheck
  npm run lint
  npm test
  npm run build
  pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
  pwsh -NoProfile -File .\scripts\verify-runtime.ps1
  git diff --check
  ```

  Reinstall the exact Electron 44 runtime and restore the ignored, verified JanVim runtime after
  `npm ci` if those generated prerequisites are removed. Record every exit code and final test
  count; do not treat prerequisite restoration as a tracked source change.

- [x] **Step 2: Record immutable and generated identities**

  Record HEAD, changed paths, Electron main bundle bytes/SHA-256, Electron executable SHA-256,
  JanVim core SHA-256, logical layout SHA-256, clean worktree status, and proof that the base P0
  worktree remains at `d79a929b77e8c4e3a3a8d81ca55404617459afbe` and clean.

- [x] **Step 3: Write the implementation receipt and operator scripts**

  Include copy-safe one-line PowerShell commands for: fresh-root GUI configuration, ValidateOnly,
  production Show, one-display preview, receipt retrieval, and Stop. Avoid multiline commands that
  can be truncated by the console.

- [x] **Step 4: Perform final branch-wide review**

  Review the complete diff against the design, security boundaries, KISS scope, legacy rollback,
  and test evidence. Address every Critical/Important finding through one reviewed fix wave.

- [x] **Step 5: Record returned human G4 acceptance**

  Ask for one bounded manual window covering: three numbered identify cards; explicit role save;
  simultaneous JanVim/Narrative/《见山》 standby; ignored extra display if available; assigned
  display change causing one safe stop and no restart loop; fresh remap/restart; exactly-one-display
  JanVim-only preview; offline run; and forced JanVim recovery. Keep physical acceptance unclaimed
  until the returned receipts and observations pass.

  Completed on 2026-09-05 with three extended displays plus a separate exactly-one-display
  preview. The operator confirmed every available check, including the safe topology stop, manual
  remap/restart, offline Soak3, and exact-identity JanVim recovery. No fourth display was available,
  so the optional unassigned-extra-display observation was not exercised. Durable evidence remains
  explicitly classified `monitor-simulation` with `physicalProjectorsTested: false`; venue
  projector calibration and physical-projector acceptance remain a separate deployment activity.
