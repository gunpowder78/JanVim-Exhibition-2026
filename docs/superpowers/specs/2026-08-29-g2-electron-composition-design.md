# G2 real Electron composition and monitor-rehearsal design

**Date:** 2026-08-29  
**Status:** Approved in chat for design documentation  
**Scope:** One real 90-second causal loop on two physical monitors standing in for the projectors

## Problem

The repository already has tested display routing, PID-only JanVim launch and placement,
loopback bridge, deterministic scheduler, cue dispatcher, secondary renderer, and 90-second
fixture loop. They are not connected to a real Electron lifecycle. The current controller
`main.ts` exports domain classes only; it does not call `app.whenReady()`, create a
`BrowserWindow`, launch the frozen JanVim artifact, or advance the real monotonic loop.

G2 therefore needs a minimal production composition root. A test-only harness or two unrelated
windows would not prove the causal chain and must not be reported as G2.

## Goals

- Run the frozen `v0.10.1-gmk.4` artifact and the real secondary Electron renderer.
- Preserve the startup order defined by the four-day plan.
- Require one explicit local Start action after every prerequisite is ready.
- Replay exactly one 90-second fixture loop for G2, including one real editor write-back and
  reset to the original poem hash.
- Keep the run deterministic, offline, bounded, and isolated from JanVim product source and the
  user's Neovim configuration.
- Produce enough bounded evidence to decide G2 without claiming projector, offline, recovery, or
  soak acceptance.

## Non-goals

- Do not implement Task 9 restart supervision, three-loop soak, packaging, or incident UI.
- Do not confirm the checked-in projector display map using monitor identities.
- Do not add formulas, matrix effects, images, or final six-minute content.
- Do not add global keyboard injection, coordinate clicking, arbitrary Ex/Lua commands, or live
  network content.
- Do not modify JanVim product source, the three protected TempCache directories, source media,
  the source poem, or user Neovim configuration.

## Chosen approach

Add a thin Electron entry around a separately testable runtime composition module, plus a
G2-specific PowerShell launcher. The launcher and runtime accept an external rehearsal display
map. The checked-in `show/display-map.json` remains `unconfirmed` until the two real projectors
are available.

This is preferred over a rehearsal-only fake orchestrator because it exercises the actual
BrowserWindow, preload, bridge, JanVim process, and renderer. It is preferred over implementing
all of Task 9 now because G2 should close the first causal loop before recovery and soak work.

## Components

### Electron entry

`apps/controller/src/electron-main.ts` is the only module with top-level Electron lifecycle
effects. It waits for Electron readiness, obtains `screen`, `BrowserWindow`, `ipcMain`, and `app`
adapters, then delegates to the runtime composition. A fatal startup result sets a nonzero exit
code after bounded cleanup. Re-activation does not create extra show windows.

The controller package `main` field points to the compiled Electron entry. Domain classes remain
importable without importing Electron, so existing unit tests stay headless.

### Runtime composition

`apps/controller/src/runtime-composition.ts` owns one G2 run and receives filesystem, process,
Electron-window, clock, timer, and logging adapters. It composes existing production modules
rather than duplicating their logic.

The composition instantiates the existing `ShowController`. Its `awaitAgentStatus` dependency
waits for the bridge agent and calls `DeterministicShowLoop.prepare()`, so the controller cannot
become armed before the baseline-buffer ACK has been validated. Its `beginMonotonicLoop`
dependency calls `DeterministicShowLoop.start()` and starts the bounded tick/deadline timers.

Its startup order is fixed:

1. Resolve only repository-relative show/runtime/content paths and the explicit external
   rehearsal paths supplied by the launcher.
2. Run the real artifact/runtime verifier with a 30-second timeout and an 8-KiB limit for each
   output stream.
3. Parse and validate the fixture manifest, poem hash, artifact lock, and external display map.
4. Enumerate exactly two Electron displays and route them through `routeDisplays`.
5. Open the frameless, sandboxed secondary BrowserWindow on the configured secondary display.
6. Start `BridgeServer` on `127.0.0.1` with a fresh in-memory token.
7. Launch `runtime/janvim/janvim-core.exe` with the frozen show config, fixture poem, private
   `runtime/user-root`, bridge port, and token.
8. Place only the returned child PID on the configured primary rectangle and validate the JSON
   placement receipt.
9. Wait for the authenticated show agent and successfully prepare the temporary nofile buffer.
10. Send a renderer status event marking the local Start control ready.

Any failure stops this sequence, logs a stable reason, and never starts the timeline. If the
secondary window already exists, it displays a blocked status for 15 seconds before bounded
cleanup and a nonzero exit. A failure before that window exists is logged and cleaned up
immediately without guessing a fallback display.

### Renderer event and local Start control

The existing preload continues to expose only `onShowEvent` and `requestStart`. The fixed show
event channel accepts a strict union of validated cue events and bounded controller-status events;
it never exposes filesystem, shell, token, port, or arbitrary IPC invocation.

The ready page gains one local Start button. It is disabled while booting or blocked, enabled only
after the agent prepare ACK succeeds, and disabled immediately after one click. The existing
`bindLocalStartRequest` origin check remains authoritative, so requests from any non-local frame
are ignored. A blocked reason is rendered as a short fixed-code status, not an exception dump.

### Real monotonic loop

The composition creates `DeterministicShowLoop` with `performance.now()` as the sole show clock.
Renderer cues are sent to the secondary window over the fixed show-event channel. Editor actions
go only through `BridgeServer.dispatch`; the same cue sent to the renderer produces the Key
Overlay.

A non-overlapping 16-ms timer calls `advance()`. The hard deadline is exactly
`loopDurationMs + 10_000` (100 seconds for the fixture), which prevents an unbounded rehearsal.
After the reset ACK restores the original poem hash and `completedLoops` becomes one, the timer is
stopped before the next loop can emit a cue. The secondary surface reports
`complete-awaiting-close` and remains visible for manual inspection.

### Display-map capture and confirmation

The G2 launcher exposes four mutually exclusive modes: `Capture`, `Confirm`, `ValidateOnly`, and
`Run`. `Capture` starts Electron for at most 15 seconds, enumerates display IDs, bounds, and scale
factors, writes a candidate map with `mappingStatus: "unconfirmed"` to the external rehearsal
directory, and exits. It never edits `show/display-map.json`.

The operator compares that candidate with the already observed Windows topology and explicitly
passes distinct `PrimaryDisplayId` and `SecondaryDisplayId` values to `Confirm`. That mode chooses
only entries already present in the captured candidate, recomputes both geometry hashes, and
atomically writes `mappingStatus: "confirmed"`. `ValidateOnly` and `Run` accept only that confirmed
external map with matching hashes. The resulting map and its SHA-256 are included in the rehearsal
evidence. The same procedure must be repeated later for the real projectors.

### Process lifecycle and shutdown

The composition retains the exact JanVim child object and listens for its exit. During the one-loop
G2 acceptance, the operator closes the JanVim frontend with Alt+F4 after reset. A natural
`CloseRequested`/`frontend_shutdown_graceful` exit causes the controller to stop the loop, close
the bridge and secondary window, flush evidence, and exit zero.

The post-loop manual-close window is 60 seconds. If the child does not exit in that interval, the
controller calls `kill()` only on the retained exact child, waits at most another five seconds,
marks the rehearsal failed, and exits nonzero. Unexpected JanVim exit, secondary-window
destruction, agent loss, missed reset, or deadline expiry also fails closed. Automatic restart is
deferred to Task 9.

### Logs and evidence

The launcher requires an external rehearsal directory. `BoundedLog` records structured controller
events with the bridge token redacted, using its existing 8-MiB file and 32-MiB total limits.
Child stdout and stderr are each capped at 8 MiB and stored separately. The run record includes:

- external display map, resolution, scale, and map hash;
- artifact tag, commit, byte sizes, and SHA-256 values from the lock;
- manifest/config hashes and selected `orthogonal` layout;
- requested and actual JanVim rectangle;
- completed loop count, cue timing drift summary, reset result, and shutdown result;
- operator notes and explicit `physicalProjectorsTested: false`.

No evidence file contains the bridge token or user configuration paths.

### 2026-08-29 monitor-rehearsal amendment

The first real-monitor attempt showed that the approved `dynamic` A/B configuration enters
`orthogonal_after_fallback` after the Plugin Lab agent prepares its nofile buffer and writes the
fallback warning to stderr. Because G2 requires zero stderr and the artifact/product source is
immutable, the show-only configuration now selects the already human-tested `orthogonal` engine
explicitly. The JanVim artifact bytes, source poem, show agent, and user Neovim configuration remain
unchanged.

## Interfaces and files

Expected implementation files are:

- add `apps/controller/src/electron-main.ts`;
- add `apps/controller/src/runtime-composition.ts`;
- add focused controller tests for composition and lifecycle;
- update `apps/controller/package.json` to point at the real entry;
- extend the preload event schema without adding a third exposed API method;
- update the secondary ready page/main wiring and their tests;
- add `scripts/start-g2-rehearsal.ps1` with capture, confirm, validate-only, and one-loop run modes;
- add a bounded PowerShell behavior test for the launcher.

The existing `main.ts`, bridge, process launcher, window placer, display router, scheduler, cue
dispatcher, and scene controller remain the behavioral core.

## Testing strategy

Every production behavior starts with a failing test.

1. Composition tests with fakes assert exact startup order, no spawn after failed validation, no
   timeline before a valid local request, one-loop cutoff, hard deadline, and cleanup exactly once.
2. Renderer/preload tests assert strict status validation, disabled/enabled Start states, one-shot
   request behavior, and rejection of remote or malformed payloads.
3. Launcher tests execute the real PowerShell script against controlled fixture paths and fake
   Electron results. They cover external-map-only writes, explicit confirmation, finite timeouts,
   rejected unconfirmed/mismatched maps, and protected-directory rejection.
4. Existing first-loop, bridge, process, placement, display, schema, and offline-package tests stay
   green.
5. Repository verification remains `npm ci`, typecheck, full tests, lint, build,
   `verify-runtime.ps1`, core SHA-256, and `git diff --check`.

## G2 manual acceptance

The monitor rehearsal passes G2 only when the operator confirms all six plan requirements in one
real run:

1. The primary surface is the real JanVim window.
2. The secondary result completes before primary cursor/edit movement begins.
3. Key Overlay and the real semantic editor action agree.
4. Inserted text is visible and unclipped.
5. Reset restores the original poem after 90 seconds with no residual buffer content.
6. Closing JanVim yields a natural frontend shutdown record.

This establishes G2 on two-monitor simulation only. It does not satisfy the final requirement for
three loops on two physical projectors, an offline run, or forced-restart recovery.
