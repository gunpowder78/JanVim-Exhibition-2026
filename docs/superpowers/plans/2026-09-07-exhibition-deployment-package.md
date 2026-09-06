# Exhibition Deployment Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one hash-verified Windows package that automatically starts the three-screen artwork, presents JianShan topmost on SCREEN-3 as black-background/white-bird, and stops normally with `Ctrl+Shift+S`.

**Architecture:** Preserve the accepted Site Mix v2 as the baseline, add an explicit controller start policy plus a session-scoped Electron global stop shortcut, and keep JianShan unchanged. A bounded PowerShell launcher creates a fresh joint session, starts sound, generates a private JianShan TOML, places only the newly launched JianShan window, then starts the Show automatically. A manifest-backed builder creates a copyable runtime snapshot with package-local Node.js and external mutable site configuration.

**Tech Stack:** TypeScript 6, Electron 44, Vitest 4, PowerShell 7.6, Node.js 22.23, Windows user32 APIs, SuperCollider 3.14.1, JSON, TOML text transformation.

**Spec:** `docs/superpowers/specs/2026-09-07-exhibition-deployment-package-design.md`

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\sound-flock-ingress-v1` on `feat/sound-flock-ingress-v1`.
- Preserve the immutable JanVim artifact; never modify JanVim product source or user Neovim configuration.
- Preserve the accepted JianShan executable at 9,799,168 bytes and SHA-256 `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`.
- Preserve the JianShan safe template at 6,238 bytes and SHA-256 `510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae`.
- Do not read, print, copy, commit, or package flock descriptor contents or tokens.
- Package installation root is exactly `D:\github\JanVim-Exhibition-Deploy`.
- Mutable site state remains under `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config`; run evidence remains under the rehearsal parent.
- The deployment uses three Windows extended displays and a freshly confirmed schema-2 `production-3` map.
- JianShan source, simulation, camera, MediaPipe, and rendering code remain unchanged.
- No global keyboard injection or coordinate clicking is permitted.
- Every wait, output, retry, log, process lookup, and cleanup path has a finite bound.
- Do not add offline, forced-recovery, HP-performance, hot-plug repair, service, watchdog, MSI, or unattended-operation work.
- Do not push, merge, or publish without a separate user instruction.

---

### Task 0: Preserve the accepted Site Mix v2 baseline

**Files:**
- Commit existing tracked and untracked Site Mix v2 files already present in the worktree.
- Modify test fixtures only: `tests/content-profiles.test.ts`, `tests/select-show-profile.test.ts`, `tests/first-loop.test.ts`, `tests/recovery.test.ts`, `tests/start-show.test.ts`, `apps/controller/tests/controller-main.test.ts`, `apps/controller/tests/g2-runtime-adapters.test.ts`, `apps/controller/tests/run-telemetry.test.ts`
- Do not modify: `docs/superpowers/specs/2026-09-07-exhibition-deployment-package-design.md`
- Verify external: `D:\VirtualData\JanVim-Exhibition-Rehearsals\joint-session-20260906T151629220Z-6176c30955c0\attended-hardware-acceptance.json`

**Interfaces:**
- Consumes: accepted attended receipt with `outcome: "pass"` and two fresh runs.
- Produces: a clean, committed Site Mix v2 source baseline before deployment changes begin.

- [ ] **Step 1: Verify the external acceptance receipt without reading any descriptor**

```powershell
$receipt = 'D:\VirtualData\JanVim-Exhibition-Rehearsals\joint-session-20260906T151629220Z-6176c30955c0\attended-hardware-acceptance.json'
$item = Get-Item -LiteralPath $receipt -Force
$parsed = Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
if ($item.Length -ne 5741) { throw 'attended-receipt-size-mismatch' }
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $receipt).Hash.ToLowerInvariant() -cne '58d916dbfa907f29a5d0580c2290abe1578774e468c593647158a2a0eae6559e') { throw 'attended-receipt-hash-mismatch' }
if ($parsed.outcome -cne 'pass') { throw 'attended-receipt-outcome-mismatch' }
```

Expected: no output and exit code 0.

- [ ] **Step 2: Record and review the exact pre-existing change set**

Run:

```powershell
git status --short
git diff --check
```

Expected: only the already accepted Site Mix v2 files listed in the design-session handoff; `git diff --check` exits 0. Stop if `.operator`, `.superpowers`, a descriptor, token, run root, or unrelated file appears.

- [ ] **Step 3: Verify the accepted source and bundle before preserving it**

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Expected: all four commands exit 0, and the Electron verifier reports 547,650 bytes with SHA-256 `bb63c48dcf63756392e730224b2cbe929b00feafa1c2738ea608f5b9764f4b90`.

- [ ] **Step 3a: Decouple legacy behavioral fixtures from the active long-paper manifest**

If the full gate reports missing legacy `cue-*` IDs because `content/fixture/show.manifest.json` is the accepted `songfeng-source-r8` long-paper profile, keep that active manifest unchanged. Make legacy behavioral tests explicitly load the locked `p0-baseline` manifest, initialize selector/launcher fixtures from that baseline, and make the content gate require the active manifest to byte-match any reviewed locked profile. Confirm the original failure first, then rerun all affected suites and the full gate.

- [ ] **Step 4: Stage only the reviewed Site Mix v2 files**

Use this exact reviewed list, excluding the already committed design specification and implementation plan:

```powershell
$reviewedSiteMixPaths = @(
  'apps/controller/src/show-run-coordinator.ts'
  'apps/controller/src/show-runtime-adapters.ts'
  'apps/controller/src/show-sound-client.ts'
  'apps/controller/src/show-surface-group.ts'
  'apps/controller/tests/show-run-coordinator.test.ts'
  'apps/controller/tests/show-runtime-adapters.test.ts'
  'apps/controller/tests/show-sound-client.test.ts'
  'apps/controller/tests/controller-main.test.ts'
  'apps/controller/tests/g2-runtime-adapters.test.ts'
  'apps/controller/tests/run-telemetry.test.ts'
  'apps/secondary-screen/src/model.ts'
  'apps/secondary-screen/src/ready-page.ts'
  'apps/secondary-screen/src/scene-controller.ts'
  'apps/secondary-screen/src/styles.css'
  'apps/secondary-screen/tests/scene-controller.test.ts'
  'content/fixture/show.manifest.json'
  'docs/operations/2026-09-06-joint-rehearsal-quickstart.md'
  'docs/operations/2026-09-06-site-sound-mix-v2-agent-sync.md'
  'docs/superpowers/plans/2026-09-06-site-sound-mix-v2-candidate.md'
  'packages/show-schema/src/index.ts'
  'packages/show-schema/src/renderer-event.ts'
  'packages/show-schema/tests/renderer-runtime.test.ts'
  'scripts/start-show.ps1'
  'sound/README.md'
  'sound/flock-protocol.mjs'
  'sound/osc.mjs'
  'sound/policy.scd'
  'sound/real-input.mjs'
  'sound/run.mjs'
  'sound/service.scd'
  'sound/site-mix.mjs'
  'sound/synths.scd'
  'sound/tests/flock-input.check.mjs'
  'sound/tests/flock-service.check.mjs'
  'sound/tests/flock-transport.check.mjs'
  'sound/tests/osc.check.mjs'
  'sound/tests/policy.scd'
  'sound/tests/real-input.check.mjs'
  'sound/tests/render.scd'
  'sound/tests/site-mix.check.mjs'
  'sound/tests/wav.check.mjs'
  'tests/content-profiles.test.ts'
  'tests/electron-build-smoke.test.ts'
  'tests/first-loop.test.ts'
  'tests/recovery.test.ts'
  'tests/select-show-profile.test.ts'
  'tests/start-show.test.ts'
)
git add -- $reviewedSiteMixPaths
$staged = @(git diff --cached --name-only)
$unexpected = @(Compare-Object -ReferenceObject @($reviewedSiteMixPaths | Sort-Object) -DifferenceObject @($staged | Sort-Object))
if ($unexpected.Count -ne 0) { throw 'site-mix-staged-set-mismatch' }
git diff --cached --check
```

Expected: the staged set exactly equals the reviewed array and the cached diff check exits 0.

- [ ] **Step 5: Commit the accepted baseline**

```powershell
git commit -m "feat(sound): preserve attended site mix v2"
```

Expected: one commit; `git status --short` is empty.

---

### Task 1: Add the explicit automatic start policy

**Files:**
- Modify: `apps/controller/src/show-command.ts`
- Modify: `apps/controller/tests/show-command.test.ts`
- Modify: `apps/controller/tests/show-electron-command.test.ts`
- Modify: `apps/controller/tests/show-runtime-adapters.test.ts`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`
- Modify: `sound/joint-rehearsal.ps1`
- Modify: `sound/tests/joint-rehearsal.check.mjs`

**Interfaces:**
- Produces: `ShowStartPolicy = "Operator" | "Automatic"` and required `ShowCommand.startPolicy`.
- Produces: PowerShell `-StartPolicy Operator|Automatic`, defaulting to `Operator`.
- Produces: Electron argument `--start-policy=operator|automatic`.

- [ ] **Step 1: Add failing command-parser tests**

Add these cases to `apps/controller/tests/show-command.test.ts`:

```ts
it("defaults existing callers to operator start", () => {
  expect(parseShowCommand(validArguments("show"), repositoryRoot).startPolicy)
    .toBe("Operator");
});

it("accepts only the explicit automatic start policy", () => {
  expect(parseShowCommand(
    [...validArguments("show"), "--start-policy=automatic"],
    repositoryRoot,
  ).startPolicy).toBe("Automatic");
  expect(() => parseShowCommand(
    [...validArguments("show"), "--start-policy=auto"],
    repositoryRoot,
  )).toThrow(/start policy/i);
  expect(() => parseShowCommand(
    [...validArguments("show"), "--start-policy=automatic", "--start-policy=operator"],
    repositoryRoot,
  )).toThrow(/duplicate/i);
});
```

Update existing exact-object expectations to include `startPolicy: "Operator"`.

- [ ] **Step 2: Run the parser test and confirm red**

Run:

```powershell
npx vitest run apps/controller/tests/show-command.test.ts
```

Expected: FAIL because `startPolicy` and `--start-policy` are not implemented.

- [ ] **Step 3: Implement strict parsing with a compatibility default**

Add to `show-command.ts`:

```ts
export type ShowStartPolicy = "Operator" | "Automatic";

function parseStartPolicy(value: string): ShowStartPolicy {
  if (value === "operator") return "Operator";
  if (value === "automatic") return "Automatic";
  throw new Error("Show start policy is invalid");
}
```

Add `startPolicy: ShowStartPolicy` to `ShowCommand`, add `start-policy` to `KNOWN_FLAGS`, and return:

```ts
const startPolicy = flags.has("start-policy")
  ? parseStartPolicy(flags.get("start-policy")!)
  : "Operator";
```

- [ ] **Step 4: Add failing PowerShell launcher tests**

Extend `tests/start-show.test.ts` and `sound/tests/joint-rehearsal.check.mjs` to assert:

```text
start-show.ps1 default -> --start-policy=operator
start-show.ps1 -StartPolicy Automatic -> --start-policy=automatic
joint-rehearsal Show -StartPolicy Automatic -> forwards Automatic
joint-rehearsal non-Show action with Automatic -> rejected
```

- [ ] **Step 5: Run the launcher tests and confirm red**

Run:

```powershell
npx vitest run tests/start-show.test.ts
node sound/tests/joint-rehearsal.check.mjs
```

Expected: FAIL because the PowerShell parameters and Electron argument do not exist.

- [ ] **Step 6: Implement PowerShell plumbing**

Add to `scripts/start-show.ps1`:

```powershell
[ValidateSet('Operator', 'Automatic')]
[string]$StartPolicy = 'Operator'
```

Map it once:

```powershell
$startPolicyFlag = if ($StartPolicy -ceq 'Automatic') { 'automatic' } else { 'operator' }
```

Append exactly one argument:

```powershell
"--start-policy=$startPolicyFlag"
```

Add the same validated parameter to `sound/joint-rehearsal.ps1` and reject non-default use outside `Action Show`. Its ValidateOnly call explicitly uses `Operator`; its live Show call receives the caller's policy.

- [ ] **Step 7: Run focused tests**

```powershell
npx vitest run apps/controller/tests/show-command.test.ts tests/start-show.test.ts
node sound/tests/joint-rehearsal.check.mjs
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- apps/controller/src/show-command.ts apps/controller/tests/show-command.test.ts apps/controller/tests/show-electron-command.test.ts apps/controller/tests/show-runtime-adapters.test.ts scripts/start-show.ps1 tests/start-show.test.ts sound/joint-rehearsal.ps1 sound/tests/joint-rehearsal.check.mjs
git commit -m "feat(show): add explicit automatic start policy"
```

---

### Task 2: Start automatically and bind the global normal-stop shortcut

**Files:**
- Create: `apps/controller/src/show-global-shortcut.ts`
- Create: `apps/controller/tests/show-global-shortcut.test.ts`
- Modify: `apps/controller/src/show-run-coordinator.ts`
- Modify: `apps/controller/src/show-electron-command.ts`
- Modify: `apps/controller/src/show-runtime-adapters.ts`
- Modify: `apps/controller/src/electron-main.ts`
- Modify: `apps/controller/tests/show-run-coordinator.test.ts`
- Modify: `apps/controller/tests/show-electron-command.test.ts`

**Interfaces:**
- Produces: `ShowRunCoordinator.requestAutomaticStart(): boolean`.
- Produces: `ShowRunCoordinator.requestOperatorStop(): boolean`.
- Produces: `bindShowStopShortcut(adapter, listener): (() => void) | undefined`.
- Produces: `ShowElectronCommandAdapters.bindOperatorStopShortcut(listener)`.
- Consumes: `ShowCommand.startPolicy` from Task 1.

- [ ] **Step 1: Add failing coordinator tests**

Add tests proving that `requestAutomaticStart()`:

```ts
expect(await coordinator.boot()).toEqual({ ready: true });
expect(coordinator.requestAutomaticStart()).toBe(true);
expect(coordinator.requestAutomaticStart()).toBe(false);
expect(coordinator.diagnostics().startedLoops).toBe(1);
```

Add tests proving `requestOperatorStop()` delegates to the existing stop path and repeated requests do not create a second shutdown.

- [ ] **Step 2: Run coordinator tests and confirm red**

```powershell
npx vitest run apps/controller/tests/show-run-coordinator.test.ts -t "automatic|operator stop"
```

Expected: FAIL because the two public methods do not exist.

- [ ] **Step 3: Implement the two narrow coordinator methods**

In `ShowRunCoordinator`, make the renderer `start` case delegate to a shared private start gate, then expose:

```ts
public requestAutomaticStart(): boolean {
  return this.requestReadyStart("automatic");
}

public requestOperatorStop(): boolean {
  return this.handleStopAction();
}
```

`requestReadyStart` must retain the existing `state === "ready"`, `operatorArmed`, and exactly-once checks. Its source is used only for bounded diagnostics; it must not create a second state machine.

- [ ] **Step 4: Add failing shortcut unit tests**

Create `show-global-shortcut.test.ts` with a fake adapter:

```ts
const callbacks = new Map<string, () => void>();
const adapter = {
  register: vi.fn((key: string, callback: () => void) => {
    callbacks.set(key, callback);
    return true;
  }),
  unregister: vi.fn((key: string) => callbacks.delete(key)),
};
const stop = vi.fn();
const dispose = bindShowStopShortcut(adapter, stop);
expect(adapter.register).toHaveBeenCalledWith("Control+Shift+S", expect.any(Function));
callbacks.get("Control+Shift+S")!();
callbacks.get("Control+Shift+S")!();
expect(stop).toHaveBeenCalledTimes(2);
dispose!();
dispose!();
expect(adapter.unregister).toHaveBeenCalledTimes(1);
```

Also assert that `register` returning `false` yields `undefined` and never calls `unregister`.

- [ ] **Step 5: Run shortcut tests and confirm red**

```powershell
npx vitest run apps/controller/tests/show-global-shortcut.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 6: Implement the shortcut binder**

Create `show-global-shortcut.ts` with:

```ts
export const SHOW_STOP_ACCELERATOR = "Control+Shift+S";

export interface GlobalShortcutAdapter {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export function bindShowStopShortcut(
  adapter: GlobalShortcutAdapter,
  listener: () => void,
): (() => void) | undefined {
  if (!adapter.register(SHOW_STOP_ACCELERATOR, listener)) return undefined;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    adapter.unregister(SHOW_STOP_ACCELERATOR);
  };
}
```

- [ ] **Step 7: Add failing Electron dispatcher tests**

Extend the harness in `show-electron-command.test.ts` with `requestAutomaticStart`, `requestOperatorStop`, a captured shortcut listener, and a disposer. Prove:

```ts
Automatic -> shortcut binds before boot, automatic start is called once after successful boot
Operator -> shortcut binds, automatic start is not called
shortcut callback -> requestOperatorStop is called
registration unavailable -> exit code 3, no automatic start, bounded emergency cleanup
all terminal paths -> shortcut disposer is called once
```

- [ ] **Step 8: Run dispatcher tests and confirm red**

```powershell
npx vitest run apps/controller/tests/show-electron-command.test.ts
```

Expected: FAIL because the adapter and coordinator methods are absent.

- [ ] **Step 9: Implement dispatcher composition**

Add the following members to the command interfaces:

```ts
requestAutomaticStart(): boolean;
requestOperatorStop(): boolean;
bindOperatorStopShortcut(listener: () => void): (() => void) | undefined;
```

In `runShowElectronCommand`, bind the shortcut before `boot()`. Return exit code `3` if it is unavailable, and still complete the existing bounded emergency cleanup. After a successful boot:

```ts
if (command.startPolicy === "Automatic" && !coordinator.requestAutomaticStart()) {
  return 1;
}
```

Dispose the shortcut exactly once in `finally`, after terminal completion has been observed.

Compose the real adapter in `electron-main.ts` by importing Electron's `globalShortcut` and `bindShowStopShortcut`; keep `createShowRuntimeAdapters` responsible only for runtime and lifecycle adapters. Use a small exported runtime-adapter type so the spread composition remains type-safe.

- [ ] **Step 10: Run focused controller tests**

```powershell
npx vitest run apps/controller/tests/show-global-shortcut.test.ts apps/controller/tests/show-electron-command.test.ts apps/controller/tests/show-run-coordinator.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add -- apps/controller/src/show-global-shortcut.ts apps/controller/tests/show-global-shortcut.test.ts apps/controller/src/show-run-coordinator.ts apps/controller/src/show-electron-command.ts apps/controller/src/show-runtime-adapters.ts apps/controller/src/electron-main.ts apps/controller/tests/show-run-coordinator.test.ts apps/controller/tests/show-electron-command.test.ts
git commit -m "feat(show): add automatic start and global normal stop"
```

---

### Task 3: Show the shortcut beneath the Stop button

**Files:**
- Modify: `apps/secondary-screen/src/model.ts`
- Modify: `apps/secondary-screen/src/ready-page.ts`
- Modify: `apps/secondary-screen/src/scene-controller.ts`
- Modify: `apps/secondary-screen/src/styles.css`
- Modify: `apps/secondary-screen/tests/scene-controller.test.ts`

**Interfaces:**
- Produces: `[data-stop-shortcut-hint]` with exact text `快捷停止：Ctrl + Shift + S`.
- Preserves: existing `STOP SHOW` button action and visibility rules.

- [ ] **Step 1: Add the failing DOM test**

```ts
const hint = root.querySelector<HTMLElement>("[data-stop-shortcut-hint]");
expect(hint?.textContent).toBe("快捷停止：Ctrl + Shift + S");
expect(hint?.hidden).toBe(true);
controller.apply(statusEvent("running"));
expect(hint?.hidden).toBe(false);
expect(hint?.previousElementSibling?.getAttribute("data-action")).toBe("stop-show");
```

Also verify it becomes hidden with the Stop button in terminal states.

- [ ] **Step 2: Run the DOM test and confirm red**

```powershell
npx vitest run apps/secondary-screen/tests/scene-controller.test.ts -t "shortcut"
```

Expected: FAIL because the hint is absent.

- [ ] **Step 3: Implement the hint without changing the button action**

Create a `span`, set `dataset.stopShortcutHint = ""`, set the exact text, append it immediately after `stopButton`, return it in the page element model, and toggle its `hidden` property from the same state decision that toggles `stopButton`.

Add compact CSS under the existing operator action styles; do not move or resize the sound-mix controls.

- [ ] **Step 4: Run secondary-screen tests**

```powershell
npx vitest run apps/secondary-screen/tests/scene-controller.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- apps/secondary-screen/src/model.ts apps/secondary-screen/src/ready-page.ts apps/secondary-screen/src/scene-controller.ts apps/secondary-screen/src/styles.css apps/secondary-screen/tests/scene-controller.test.ts
git commit -m "feat(show): display the global stop shortcut"
```

---

### Task 4: Generate the private JianShan live configuration

**Files:**
- Create: `deployment/operator/lib/jianshan-config.mjs`
- Create: `tests/deployment-jianshan-config.test.ts`

**Interfaces:**
- Produces: `renderJianShanLiveConfig(templateText, descriptorPath): string`.
- Produces CLI: `node jianshan-config.mjs --template PATH --descriptor PATH --output PATH`.
- Consumes only the descriptor path; never reads descriptor contents.

- [ ] **Step 1: Write strict failing configuration tests**

Use a compact fixture containing exactly one `[audio]`, `[osc]`, and `[flock_input]` section. Assert the result contains:

```toml
[audio]
enabled = false

[osc]
enabled = false

[flock_input]
enabled = true
descriptor_path = "D:/VirtualData/JanVim-Exhibition-Rehearsals/joint-sound-test/flock-input.json"
send_hz = 10
v_ref = 4.0

[display]
invert_colors = true
bird_color_preset = "contrast"
```

Add rejection tests for duplicate target sections, an existing `[display]`, duplicate target keys, missing keys, relative descriptor paths, quotes/newlines in the path, input over 32,768 bytes, and an existing output file.

- [ ] **Step 2: Run tests and confirm red**

```powershell
npx vitest run tests/deployment-jianshan-config.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement a section-aware bounded transformer**

Implement line-by-line section tracking. Modify only the exact `enabled` key in `[audio]`, `[osc]`, and `[flock_input]`, plus the three exact flock keys. Require one match per target. Normalize the validated Windows descriptor path to forward slashes and append the one new `[display]` section. Preserve UTF-8 without BOM and LF endings.

The CLI must use exclusive creation (`flag: "wx"`) and must not include descriptor contents in stdout, stderr, or errors. On success it prints only:

```json
{"status":"jianshan-live-config-written","bytes":0,"sha256":"64-lowercase-hex"}
```

where `bytes` is the actual positive output size.

- [ ] **Step 4: Run focused tests**

```powershell
npx vitest run tests/deployment-jianshan-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- deployment/operator/lib/jianshan-config.mjs tests/deployment-jianshan-config.test.ts
git commit -m "feat(deploy): generate the JianShan live configuration"
```

---

### Task 5: Place the exact JianShan window on SCREEN-3

**Files:**
- Create: `scripts/place-jianshan-window.ps1`
- Create: `tests/place-jianshan-window.test.ts`

**Interfaces:**
- Produces PowerShell parameters: `ChildProcessId`, `ExpectedStartedAtUtc`, `X`, `Y`, `Width`, `Height`, `TimeoutMs`.
- Produces one bounded JSON receipt containing PID, HWND, requested/actual bounds, `maximized`, `topmost`, `clickThrough`, and `noActivate`.

- [ ] **Step 1: Create a failing real-window fixture test**

Follow the existing `tests/window-close-helper.test.ts` fixture pattern: start one temporary visible Windows form, capture its PID and UTC start identity, invoke the new helper with a 10-second test timeout, parse its one-line JSON receipt, and assert:

```ts
expect(receipt.pid).toBe(fixture.pid);
expect(receipt.matchedWindowCount).toBe(1);
expect(receipt.maximized).toBe(true);
expect(receipt.topmost).toBe(true);
expect(receipt.clickThrough).toBe(false);
expect(receipt.noActivate).toBe(false);
```

Add cases for wrong start identity, no window, two eligible owned windows, and a 100 ms timeout. Each must fail without touching a different fixture process.

- [ ] **Step 2: Run tests and confirm red**

```powershell
npx vitest run tests/place-jianshan-window.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the isolated user32 helper**

Model bounded enumeration on `scripts/place-janvim-window.ps1`, but use a new interop class name. Add only these required APIs: `EnumWindows`, `GetWindowThreadProcessId`, `IsWindowVisible`, `GetWindow`, `GetClientRect`, `GetWindowRect`, `GetWindowLongPtrW`, `SetWindowPos`, `ShowWindowAsync`, and `IsZoomed`.

Use:

```text
GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x00000008
WS_EX_TRANSPARENT = 0x00000020
WS_EX_NOACTIVATE = 0x08000000
SW_MAXIMIZE = 3
HWND_TOPMOST = -1
SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW = 0x0043
```

Verify the PID start identity both before enumeration and immediately before placement. First move the window to the requested SCREEN-3 bounds, then maximize it, then set topmost. Reject transparent or no-activate styles before returning success.

- [ ] **Step 4: Run placement tests**

```powershell
npx vitest run tests/place-jianshan-window.test.ts
```

Expected: PASS with no orphan fixture process.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/place-jianshan-window.ps1 tests/place-jianshan-window.test.ts
git commit -m "feat(deploy): place JianShan topmost on screen 3"
```

---

### Task 6: Add the one-command attended launcher

**Files:**
- Create: `deployment/config/site-defaults.json`
- Create: `deployment/operator/lib/Exhibition.Deployment.psm1`
- Create: `deployment/operator/Start-Exhibition.ps1`
- Create: `deployment/operator/Stop-Exhibition.ps1`
- Create: `deployment/operator/Configure-Displays.ps1`
- Create: `tests/deployment-operator.test.ts`
- Modify: `scripts/start-show.ps1`
- Modify: `tests/start-show.test.ts`
- Modify: `sound/start-sound.ps1`
- Modify: `sound/stop-sound.ps1`
- Modify: `sound/joint-rehearsal.ps1`
- Modify: `sound/tests/integration.mjs`
- Modify: `sound/tests/joint-rehearsal.check.mjs`

**Interfaces:**
- Produces optional `-NodeExecutable` on all deployment-called launchers.
- Produces `Read-ProductionDisplayMap(path)` returning the unique SCREEN-3 bounds.
- Produces `New-ExhibitionLaunchPlan(packageRoot, displayMapPath, durationSeconds)`.
- Produces a fixed external pointer at `site-config\active-deployment.json` containing no token.

- [ ] **Step 1: Add failing explicit-Node tests**

Assert that each launcher accepts an absolute package-local Node executable, verifies exact version `v22.23.0`, rejects relative/reparse/missing/wrong-version paths, and uses the explicit path even when another `node.exe` is on PATH. Existing callers without the parameter retain their current behavior.

- [ ] **Step 2: Run explicit-Node tests and confirm red**

```powershell
npx vitest run tests/start-show.test.ts
node sound/tests/integration.mjs
node sound/tests/joint-rehearsal.check.mjs
```

Expected: FAIL because `-NodeExecutable` is not implemented.

- [ ] **Step 3: Implement the explicit Node boundary**

Add this optional parameter to `start-show.ps1`, `start-sound.ps1`, `stop-sound.ps1`, and `joint-rehearsal.ps1`:

```powershell
[string]$NodeExecutable
```

When supplied, require a fully qualified plain leaf, reject reparse traversal, and execute `--version` with the existing bounded process policy. When absent, preserve current discovery behavior. `joint-rehearsal.ps1` forwards the value to Sound, ValidateOnly, Show, and StopSound.

- [ ] **Step 4: Add failing deployment module tests**

Create fixture maps and assert:

```text
schema=2, mappingStatus=confirmed, mode=production-3, exactly one SCREEN-3 -> accepted
missing/duplicate SCREEN-3 -> rejected
schema 1, preview-1, unknown fields, invalid bounds, zero dimensions, oversized JSON -> rejected
active ownership record containing token/descriptor fields -> rejected
active ownership record outside the rehearsal parent -> rejected
```

Assert `New-ExhibitionLaunchPlan` orders components as `sound`, `jianshan`, `show` and sets `StartPolicy=Automatic`, `Listen=true`, and duration 3,600 seconds.

- [ ] **Step 5: Run deployment module tests and confirm red**

```powershell
npx vitest run tests/deployment-operator.test.ts
```

Expected: FAIL because the module and scripts do not exist.

- [ ] **Step 6: Implement site defaults and pure planning**

Write `deployment/config/site-defaults.json` exactly as bounded non-secret configuration:

```json
{"schema":1,"packageRoot":"D:\\github\\JanVim-Exhibition-Deploy","rehearsalParent":"D:\\VirtualData\\JanVim-Exhibition-Rehearsals","siteConfigRoot":"D:\\VirtualData\\JanVim-Exhibition-Rehearsals\\site-config","audioOutputDevice":"Windows WASAPI : Headphones (Senary Audio)","durationSeconds":3600}
```

Implement strict JSON property, path, integer, and bound validation in `Exhibition.Deployment.psm1`. Export only the functions used by the three operator scripts and tests.

- [ ] **Step 7: Implement `Configure-Displays.ps1`**

Create a fresh direct child under the rehearsal parent, invoke `app\scripts\configure-displays.ps1`, require successful schema-2 `production-3` output, then atomically write the confirmed map to `site-config\display-map.json`. Never edit package files.

- [ ] **Step 8: Implement `Start-Exhibition.ps1`**

Use this exact state sequence with bounded waits:

```text
verify package and prerequisites
prepare fresh joint session
start Sound -Listen in a child PowerShell
wait at most 45 seconds for ready.json and flock-input.json
generate the private JianShan TOML by path only
start JianShan with JIANSHAN_CONFIG_PATH set only in its child environment
place/maximize/topmost the exact JianShan PID within 15 seconds
start joint Show with StartPolicy Automatic in a monitored child PowerShell
wait at most 45 seconds for its run lease and record the exact controller identity
wait for normal Show child completion
map Show exit code 3 to the dedicated diagnostic show-stop-shortcut-unavailable
close exact JianShan identity and wait at most 5 seconds
wait at most 10 seconds for clean sound summary
remove the active pointer and print one bounded completion JSON object
```

Write `active-deployment.json` atomically before Show launch. It contains schema, run root, session file path, and PID/start-time/executable triples for the sound wrapper, JianShan, Show wrapper, and—after the bounded run-lease read—the controller. It contains no descriptor path or token. On partial failure, clean up in reverse order with exact identity checks.

- [ ] **Step 9: Implement `Stop-Exhibition.ps1` as a technical fallback**

Read only the fixed active pointer, validate every identity, request sound stop through `stop-sound.ps1`, close the exact JianShan window, and request controller window closure using the recorded PID/start identity. Wait for the Show wrapper and controller before using exact-identity termination as the final bounded fallback. Do not enumerate by process name and do not search historical run roots.

- [ ] **Step 10: Run focused operator tests**

```powershell
npx vitest run tests/deployment-operator.test.ts tests/start-show.test.ts
node sound/tests/integration.mjs
node sound/tests/joint-rehearsal.check.mjs
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add -- deployment/config/site-defaults.json deployment/operator/lib/Exhibition.Deployment.psm1 deployment/operator/Start-Exhibition.ps1 deployment/operator/Stop-Exhibition.ps1 deployment/operator/Configure-Displays.ps1 tests/deployment-operator.test.ts scripts/start-show.ps1 tests/start-show.test.ts sound/start-sound.ps1 sound/stop-sound.ps1 sound/joint-rehearsal.ps1 sound/tests/integration.mjs sound/tests/joint-rehearsal.check.mjs
git commit -m "feat(deploy): add the attended one-command launcher"
```

---

### Task 7: Build and verify the copyable package

**Files:**
- Create: `deployment/operator/lib/package-manifest.mjs`
- Create: `deployment/operator/Verify-Deployment.ps1`
- Create: `deployment/build-deployment-package.ps1`
- Create: `tests/deployment-package.test.ts`

**Interfaces:**
- Produces: manifest schema 1 with sorted `{ path, bytes, sha256 }` payload entries.
- Produces CLI commands `create` and `verify` in `package-manifest.mjs`.
- Produces one versioned package directory, one ZIP archive, and one external handoff receipt.

- [ ] **Step 1: Write failing manifest tests**

Build a temporary package fixture and assert create/verify success. Then independently assert rejection of:

```text
missing payload
extra payload
changed bytes
duplicate manifest path
unsorted manifest entries
absolute path
../ escape
case-folded duplicate
file or directory reparse point
payload count above 100,000
manifest above 16 MiB
```

Assert `package-manifest.json` is excluded from its own payload list and its hash is written to the external handoff receipt.

- [ ] **Step 2: Run manifest tests and confirm red**

```powershell
npx vitest run tests/deployment-package.test.ts
```

Expected: FAIL because the manifest module does not exist.

- [ ] **Step 3: Implement bounded manifest create/verify**

Use `lstat`, bounded iterative traversal, ordinal case-folded uniqueness, SHA-256 streaming, and stable forward-slash relative paths. The CLI prints one compact JSON result and never follows links. Verification compares the exact set of payload files excluding only root `package-manifest.json`.

- [ ] **Step 4: Implement `Verify-Deployment.ps1`**

The verifier must:

```text
require package root D:\github\JanVim-Exhibition-Deploy
run manifest verification with package-local Node v22.23.0
run the existing immutable JanVim verifier
verify JianShan EXE/template/DLL/model identities
verify PowerShell 7.6.5 and SuperCollider 3.14.1 fixed paths
verify the exact WASAPI device through an isolated bounded no-sound SuperCollider probe
verify at least one present Windows PnP imaging device in the Camera or Image class
verify the external schema-2 production-3 display map
print one Chinese PASS/FAIL table and a final DEPLOYMENT_VERIFY_PASS marker
```

It does not start camera capture, GUI rendering, or audible synthesis.

- [ ] **Step 5: Implement the package builder**

`build-deployment-package.ps1` requires a clean worktree and explicit JianShan candidate plus Node runtime paths. It copies this exact app allowlist into `app`:

```text
AGENTS.md
README.md
eslint.config.js
janvim-artifact.lock.json
package.json
package-lock.json
tsconfig.json
apps
content
docs
node_modules
nvim
packages
runtime
scripts
show
sound
```

It copies the identified JianShan runtime into `runtime\jianshan`, package Node `node.exe` plus its LICENSE into `tools\node`, and deployment operator/config/docs into their target directories. It rejects `.git`, `.worktrees`, `.operator`, `.superpowers`, descriptor names, tokens, run roots, and reparse points.

After copying, create and verify `package-manifest.json`, make the ZIP, and write an external receipt containing schema, source commit, package directory, archive path, manifest bytes/hash, archive bytes/hash, Electron identity, JanVim identity, JianShan identity, Node identity, and `acceptance: "awaiting-mini-pc-attended-acceptance"`.

- [ ] **Step 6: Run package tests**

```powershell
npx vitest run tests/deployment-package.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- deployment/operator/lib/package-manifest.mjs deployment/operator/Verify-Deployment.ps1 deployment/build-deployment-package.ps1 tests/deployment-package.test.ts
git commit -m "feat(deploy): build and verify the copy package"
```

---

### Task 8: Freeze the new Electron identity and write deployment documents

**Files:**
- Modify: `scripts/start-show.ps1`
- Modify: `tests/electron-build-smoke.test.ts`
- Create: `deployment/docs/README-DEPLOYMENT.md`
- Create: `deployment/docs/DAILY-OPERATOR-CARD.md`
- Create: `deployment/docs/TROUBLESHOOTING.md`
- Modify: `README.md`

**Interfaces:**
- Produces: one reviewed Electron bundle byte size and SHA-256 used by launcher and tests.
- Produces: three bounded operator documents matching the implemented entry points.

- [ ] **Step 1: Build and capture the new bundle identity**

```powershell
npm run build
$bundle = 'apps\controller\dist\main\electron-main.js'
[pscustomobject]@{
  Bytes = (Get-Item -LiteralPath $bundle).Length
  Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bundle).Hash.ToLowerInvariant()
}
```

Expected: build exits 0; record the actual positive byte count and 64-character lowercase hash.

- [ ] **Step 2: Update only the reviewed identity gates**

Replace the old 547,650-byte / `bb63c48d...` identity in the reviewed block of `scripts/start-show.ps1` and the exact expected identity in `tests/electron-build-smoke.test.ts`. Do not rewrite historical candidate receipts or historical rehearsal reports.

- [ ] **Step 3: Write the three deployment documents**

`README-DEPLOYMENT.md` covers exact prerequisite versions/paths, archive hash comparison, extraction to the fixed root, `Verify-Deployment.ps1`, display configuration, audio/camera permissions, and first start.

`DAILY-OPERATOR-CARD.md` contains only:

```text
power and cable check
Verify-Deployment.ps1
Start-Exhibition.ps1
expected automatic start and C-screen state
Ctrl+Shift+S normal stop
STOP SHOW mouse fallback
reboot-and-retry recovery
one-hour attended session limit
```

`TROUBLESHOOTING.md` maps exact diagnostics to operator actions for display mapping, wrong C-screen placement, lost topmost state, hidden pointer, camera permission, GPU startup, SuperCollider path/device, shortcut collision, stale active pointer, and partial cleanup. It must not instruct staff to delete leases, tokens, descriptors, source files, or broad process names.

- [ ] **Step 4: Add the package entry to the root README**

Link the design, implementation plan, builder, and deployment document. Label the package as attended three-screen deployment and explicitly exclude offline, forced-recovery, HP-performance, and unattended claims.

- [ ] **Step 5: Run focused identity and documentation checks**

```powershell
npx vitest run tests/electron-build-smoke.test.ts tests/deployment-package.test.ts tests/deployment-operator.test.ts
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- scripts/start-show.ps1 tests/electron-build-smoke.test.ts deployment/docs/README-DEPLOYMENT.md deployment/docs/DAILY-OPERATOR-CARD.md deployment/docs/TROUBLESHOOTING.md README.md
git commit -m "docs(deploy): freeze the attended deployment handoff"
```

---

### Task 9: Run full verification and assemble the transfer archive

**Files:**
- Verify all committed implementation files.
- Generate only external artifacts beneath `D:\VirtualData\JanVim-Exhibition-Rehearsals`.

**Interfaces:**
- Produces: final package directory, ZIP, external handoff receipt, manifest identity, and Electron identity.

- [ ] **Step 1: Install exactly locked JavaScript dependencies**

```powershell
npm ci
```

Expected: exit 0 with the lock file unchanged.

- [ ] **Step 2: Run all repository gates**

```powershell
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Expected: all exit 0. This is automated verification only; do not label it physical display, camera, sound, offline, recovery, or performance acceptance.

- [ ] **Step 3: Confirm clean source and protected identities**

```powershell
git status --short
git diff --exit-code
git diff --cached --exit-code
```

Expected: clean. Recheck immutable JanVim, JianShan EXE/template, content lock, poem, and SuperCollider service identities against the committed gates.

- [ ] **Step 4: Build the external package and archive**

Invoke `deployment/build-deployment-package.ps1` with:

```text
source repository = current clean worktree
JianShan candidate = D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c\runtime
Node executable = C:\Users\hxj\AppData\Local\hermes\node\node.exe
output parent = D:\VirtualData\JanVim-Exhibition-Rehearsals
```

Expected: one new versioned directory, ZIP, and external receipt. No existing package or fallback is overwritten.

- [ ] **Step 5: Install once at the fixed root and verify there**

Require `D:\github\JanVim-Exhibition-Deploy` to be absent (or moved aside by the operator as a recoverable backup), extract the newly built archive exactly there, and run its `operator\Verify-Deployment.ps1` with the external handoff receipt. The verifier must continue to reject every other package root. Expected final marker:

```text
DEPLOYMENT_VERIFY_PASS
```

- [ ] **Step 6: Report the implementation handoff**

Report source HEAD, package/archive paths, bytes and hashes, manifest bytes/hash, Electron bundle bytes/hash, all automated gate counts, exact excluded claims, and the remaining attended checklist. Do not push.

---

### Task 10: Perform attended acceptance on the current PC and Mini PC

**Files:**
- Generate external operator evidence only; do not modify package payload or Git files.

**Interfaces:**
- Consumes: the verified extracted deployment package.
- Produces: attended observations for the current PC and Mini PC.

- [ ] **Step 1: Current-PC launch acceptance**

Run `Configure-Displays.ps1` if the current confirmed map is not selected, then run `Start-Exhibition.ps1`. Confirm automatic start, long writeback, cursor pluck, live flock wind, C-screen topmost black/white rendering, visible pointer, and click input.

- [ ] **Step 2: Current-PC shortcut acceptance**

Give JianShan focus and press `Ctrl+Shift+S`. Confirm the normal Show result, joint smooth fade, no revival, JianShan closure, clean sound summary, and no remaining owned process.

- [ ] **Step 3: Copy and verify on the Mini PC**

Compare the ZIP hash to the external handoff receipt, extract to `D:\github\JanVim-Exhibition-Deploy`, install only the documented third-party prerequisites, configure three displays, and obtain `DEPLOYMENT_VERIFY_PASS`.

- [ ] **Step 4: Mini-PC first launch acceptance**

Repeat the seven visible/audible checks from Step 1 and the shortcut stop from Step 2. Record only attended observations; no offline, forced-fault, or HP-performance action is performed.

- [ ] **Step 5: Mini-PC reboot acceptance**

Reboot Windows normally, run `Verify-Deployment.ps1`, and start again. Confirm the same automatic C-screen presentation and normal stop. This proves staff can recover by reboot and restart; it is not a forced-recovery endurance claim.

- [ ] **Step 6: Final delivery decision**

If both machines pass, mark the external deployment receipt `attended-pass` without editing the transfer archive. If either fails, preserve logs, keep the current fallback active, and report the exact failed prerequisite or stage.
