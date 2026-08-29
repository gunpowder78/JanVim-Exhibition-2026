# Task 9 recovery, offline operation, and three-loop soak design

- Status: approved by owner on 2026-08-29
- Date: 2026-08-29
- Parent plan: `docs/plans/2026-08-28-four-day-dual-projector-delivery.md`, Task 9
- Binding artwork design: `docs/specs/2026-08-28-dual-projector-generative-performance-design.md`
- Preserved baseline: G2 one-loop monitor rehearsal at commit `8ff4013`

## 1. Goal and acceptance boundary

Task 9 turns the verified one-loop G2 chain into a restartable, offline, continuously looping P0
show runtime. It adds bounded recovery, normal operator controls, three-loop telemetry, an external
controller watchdog, and operational documentation without changing the immutable JanVim product
artifact or weakening G2 evidence.

The first physical acceptance target remains two real monitors simulating projectors. A passing
monitor run records `physicalProjectorsTested: false`. It may establish the desktop portion of G3,
but it cannot establish G4 or replace three loops, one offline loop, and forced recovery on the two
physical projectors.

Every production behavior starts with a failing deterministic test. Automated tests use a fake
monotonic clock and never wait for three wall-clock 90-second loops.

## 2. Fixed boundaries and non-goals

The implementation must:

- remain in `JanVim-Exhibition-2026` and its existing isolated worktree;
- consume JanVim only through `janvim-artifact.lock.json` and the ignored prepared runtime;
- leave the JanVim product repository, user Neovim configuration, source poem, source media, and
  the three protected incident directories unchanged;
- keep `show/display-map.json` unconfirmed until the physical projectors are captured and confirmed;
- keep monitor display IDs only in external rehearsal evidence;
- keep Electron main as the only show clock and recovery state machine;
- use no global keyboard injection, title matching, coordinate clicking, or online service;
- keep every command deadline, retry budget, listener set, sample collection, log, and recovery loop
  finite;
- preserve the G2 command, one-loop composition, manual Alt+F4 acceptance flow, and
  `G2EvidenceRecord` as a compatibility path.

Task 9 does not add final content, formulas, matrices, images, packaging, projector IDs, or any
JanVim Rust/WGPU/product behavior.

## 3. Chosen architecture

The approved architecture is a restartable in-process run coordinator plus a narrow external
controller watchdog.

```text
start-show.ps1
  |- validate exact repository/runtime/build/network inputs
  |- launch exact built Electron command
  `- restart Electron only after unexpected controller exit (1/2/4 seconds, max 3/10 min)
                  |
                  v
ShowRunCoordinator (only run state machine and monotonic clock owner)
  |- RestartBudget(janvim)
  |- RestartBudget(secondary)
  |- SecondarySurfaceSlot
  |- current RunSession generation
  |- RunTelemetry / RunLogBudget
  `- bounded shutdown ladder
          |
          v
RunSession generation N
  |- one loopback BridgeServer and generation guard
  |- one exact JanVim child PID + verified HWND
  |- one bounded stdout/stderr capture allocation
  |- one prepared nofile poem buffer
  `- DeterministicShowLoop + multi-loop driver
```

The existing `CriticalProcessSupervisor` is not wired directly into G2. Its useful restart policy
is reduced to a pure `RestartBudget`, while `ShowRunCoordinator` owns resource replacement and
state transitions. This prevents a policy callback from pretending it can recreate a bridge,
window, buffer, loop, output handles, and listener graph.

The real G2 entry remains available and unchanged in behavior. The new show command selects the
Task 9 coordinator explicitly; it is not an implicit extension of `--g2-mode=run`.

## 4. State model and generation rule

The coordinator state is a closed union:

```text
booting
ready
running
safe-cruise
black-recovering
safe-ready
shutting-down
stopped
```

Only these transitions are allowed:

```text
booting -> ready | safe-ready | shutting-down
ready -> running | shutting-down
running -> safe-cruise | black-recovering | shutting-down
safe-cruise -> black-recovering | safe-ready | shutting-down
black-recovering -> ready | running | safe-ready | shutting-down
safe-ready -> ready | shutting-down
shutting-down -> stopped
```

Every asynchronous callback captures an integer `generationId`. The coordinator increments the
generation before it stops timers or begins resource cleanup. A callback, ACK, close event, timer,
presentation acknowledgement, or helper result whose generation differs from the current one is
ignored and recorded as a bounded stale-generation event. It cannot mutate current state.

Generation invalidation occurs before cleanup so a late ACK cannot continue a half-disposed loop.
The existing `(loopId, cueId)` idempotency remains in force inside one generation.

## 5. Startup and operator modes

`scripts/start-show.ps1` exposes three strict modes:

### 5.1 ValidateOnly

- Verifies exact Node version, built Electron entry, artifact lock/runtime, content/media manifests,
  confirmed external display map, protected-path boundary, and selected network policy.
- Opens no BrowserWindow and starts no JanVim process.
- Returns nonzero for any mismatch.

### 5.2 Soak3

- Requires an external rehearsal root and confirmed external display map.
- Requires offline acceptance unless explicitly marked diagnostic-only.
- Requires one local Start action, then runs exactly three complete loops.
- Automatically performs the bounded normal shutdown after the third reset.
- Writes one strict atomic three-loop evidence record.

### 5.3 Show

- Uses the same validation and runtime but continues loop-by-loop until Stop Show or an unrecoverable
  fault.
- Each loop remains finite. In-memory telemetry retains bounded aggregates and the latest three
  loop summaries only; structured logs rotate under one run-wide budget.
- Stop Show requested during running is recorded once and executes at the next manifest fade/reset
  safe boundary, bounded by the remaining loop duration plus the loop deadline allowance.
- Emergency SIGINT, Electron quit, or window-close begins immediate bounded shutdown from any state.

The secondary preload continues to expose exactly two methods:

```ts
onShowEvent(listener): () => void
sendRendererEvent(
  | { type: "operator-action"; action: "start" | "restart-loop" | "stop-show" }
  | { type: "presentation-ack"; generationId: number; loopId: string; cueId: string }
): void
```

The strict union is validated in the preload and again with the sender URL in Electron main. No
unknown field, filesystem, shell, arbitrary invoke, or unvalidated generic IPC payload is exposed.
G2 Start is carried through the same closed Start action and retains its one-shot semantics.

Restart Loop executes immediately only in ready or black states. Stop Show executes immediately in
ready or black and may be queued once while running. Repeated operator requests are idempotent.

## 6. Session startup

The coordinator uses this exact order:

```text
validate immutable inputs
  -> validate display map and offline policy
  -> create guarded local secondary surface
  -> create loopback bridge
  -> launch hash-verified JanVim with private Plugin Lab root
  -> place the unique PID-bound HWND
  -> wait for agent
  -> prepare and hash-check original poem nofile buffer
  -> enter ready
  -> require local Start
  -> begin the monotonic loop
```

No timeline starts before all validation, placement, agent, buffer, and secondary checks succeed.

## 7. Fault handling

### 7.1 Secondary failure outside a critical editor action

1. Invalidate the active cue generation and stop further cue dispatch.
2. Keep JanVim on the last valid static frame (`safe-cruise`); do not inject keys.
3. Enter `black-recovering`, dispose the old secondary listeners/window once, and create a new local
   guarded black/ready surface.
4. Send reset to the still-healthy JanVim session and require the original poem hash.
5. Generate a fresh loop ID and resume automatically from the loop boundary.

### 7.2 Secondary failure while an editor command is pending

The causal surfaces can no longer be proven aligned. Invalidate the generation, suppress all later
editor commands, and use full session replacement as for agent loss. A late old ACK is ignored.

### 7.3 Agent disconnect, critical ACK failure, or editor interruption

1. Invalidate the generation immediately.
2. Stop the driver/scheduler and suppress every later editor cue.
3. Dispose the old bridge and exact JanVim child through the bounded cleanup path.
4. Apply the JanVim restart budget.
5. Create a new bridge, child, placement, nofile original-poem buffer, and loop ID.
6. Resume automatically only after prepare ACK returns the original poem hash.

No partial checkpoint is read and no old cue is replayed.

### 7.4 JanVim exit

Unexpected child exit follows the same full session replacement. The per-domain restart budget is
1, 2, and 4 seconds within a rolling ten-minute window. The fourth crash enters `safe-ready` and
performs no more automatic restart.

### 7.5 Controller exit

In-process code cannot recover its own death. `start-show.ps1` distinguishes an intentional terminal
exit from an unexpected controller exit. Unexpected exit receives the same 1/2/4-second, maximum
three-in-ten-minutes watchdog budget. Each relaunch has a new run/session identity and returns to
explicit ready; it never automatically resumes a half-observed performance.

Before a JanVim child becomes active, the coordinator atomically writes a bounded, token-free
external run lease containing the run/generation ID, controller PID/start time, JanVim PID/start
time, verified HWND, executable path relative to the frozen runtime, and executable SHA-256. Normal
cleanup removes the lease only after the exact child has settled.

After an unexpected controller exit, the watchdog reads the lease and independently revalidates
the PID creation time, executable location/hash, and HWND-to-PID ownership before sending `WM_CLOSE`.
It waits five seconds, then terminates only that still-identical PID if required and waits five more
seconds. If identity cannot be proved, it neither kills nor relaunches; it writes an incident and
requires operator intervention. This PID-reuse guard prevents a broad process-name cleanup or an
orphan JanVim from overlapping the next run.

The watchdog writes one bounded incident event per attempt and stops after budget exhaustion.

### 7.6 Budget exhaustion

Any exhausted secondary or JanVim budget enters `safe-ready`, exposes a bounded reason code, and
waits for an operator decision. It does not keep retrying.

## 8. Normal and emergency shutdown

Normal Stop Show uses the approved exact-window ladder:

1. Disarm operator actions, invalidate the generation, and stop driver/scheduler.
2. Suppress queued editor work.
3. Keep the bridge open and send the closed-schema agent `shutdown` command with a two-second
   deadline and at most one idempotent retry.
4. Call a show-only close helper with the retained placement receipt's PID and HWND. The helper
   verifies that the HWND still belongs to that PID, is top-level, and is the retained eligible
   window, then sends `WM_CLOSE`. It never searches by title/process name and never sends keys.
5. Wait at most five seconds for natural JanVim child exit and classify its bounded output.
6. If still alive, terminate only the retained exact child and wait at most five additional seconds.
7. Close bridge within five seconds, dispose secondary/listeners/timers once, flush bounded logs,
   and atomically write terminal evidence.

The helper itself has a two-second execution deadline and a 4096-byte output limit. Every stage
continues to the next cleanup stage even if classification or logging fails. Shutdown is idempotent;
concurrent Stop/SIGINT/window-close requests share one cleanup promise.

G2 retains its existing human Alt+F4 acceptance flow. Automatic `WM_CLOSE` is the normal Task 9 show
operation, not a rewrite of the G2 criterion.

## 9. Offline contract

Offline acceptance has two independent layers.

### 9.1 Application layer

- Secondary entry and preload are local `file:` resources.
- Navigation and window creation deny every non-entry URL.
- Electron web requests cancel HTTP, HTTPS, WS, and WSS.
- The bridge binds and validates only IPv4 `127.0.0.1`.
- Production controller source imports no DNS, HTTP, HTTPS, remote fetch, or generic outbound socket
  client. The only network-capable server path is the bounded loopback bridge.
- JanVim runs with the prepared private Plugin Lab root and no user configuration inheritance.

Tests inject prohibited outbound attempts at each application boundary and require rejection. Static
source assertions supplement, but do not replace, runtime guards.

### 9.2 Host layer

The launcher never changes adapters or firewall state. In offline acceptance mode it performs a
read-only network snapshot and rejects an active non-loopback default route or connected external
network profile. The operator disconnects Wi-Fi/Ethernet manually.

Offline state is sampled at startup, every loop boundary, and shutdown. Any online sample sets
`offlineVerified: false`; Soak3 acceptance fails closed. A transient state between samples is outside
the application's measurement claim and is covered operationally by physically disconnected media.

A diagnostic run may explicitly allow connected networking, but its evidence must contain
`offlineVerified: false` and cannot satisfy G3/G4 offline acceptance.

No code creates or removes Windows firewall rules.

## 10. Presentation and timing evidence

G2 `maxDriftMs` remains scheduler-health diagnostics. It is not reused as visible-drift evidence.

For critical cues and reset/ready boundaries, the secondary updates DOM and replies only after a
double `requestAnimationFrame`. The second callback is an application-level proxy that the prior
DOM frame had a paint opportunity. It is not a claim about projector photons.

Renderer presentation acknowledgements carry and validate `generationId`, `loopId`, and `cueId`.
The existing JanVim protocol remains unchanged: its ACK carries `loopId` and `cueId`, while the
generation-aware bridge/session wrapper binds the pending dispatch to the captured generation and
rejects its settlement if that generation is no longer current. All timestamps use the
controller's one monotonic clock.

Task 9 records these metric families:

| Metric | Definition | Acceptance |
|---|---|---|
| `secondaryPresentLatencyMs` | presentation ACK time minus controller dispatch time | critical P95 `< 100 ms` |
| `primaryCompletionLatencyMs` | JanVim completion ACK time minus controller dispatch time | raw value always recorded |
| `primaryInstantAckLatencyMs` | completion latency for reset/move/select/escape or another zero-duration action | P95 `< 100 ms` |
| `primaryInsertOverheadMs` | raw insert completion latency minus manifest-planned character input duration, floored at zero | P95 `< 100 ms` |
| `finalVisibleDriftMs` | absolute difference between primary reset ACK and secondary reset/ready presentation ACK for the same boundary | sum of three loop values `< 250 ms` |
| `tickLatenessMs` | positive callback lateness against the re-anchored 16-ms diagnostic expectation | diagnostic only |
| `advanceOverrunMs` | positive duration beyond one 16-ms `advance()` budget | diagnostic only |

The fixture's 28-character insertion at 24 characters/second has an intended duration of roughly
1166 ms. Planned duration uses the agent's existing deterministic rule: Unicode-character count
multiplied by `max(1, floor(1000 / charsPerSecond))`, or zero for an explicitly zero-speed action.
The evidence never pretends that completion ACK is under 100 ms; it reports both raw completion and
overhead beyond the planned action duration. The protocol does not ACK before the semantic action
is complete.

## 11. Resource and soak evidence

Soak3 writes a strict schema-1 record with:

- run identity and mode;
- `acceptanceScope` and explicit `physicalProjectorsTested`;
- display IDs, bounds, resolution, scale, geometry hashes, and external map hash;
- artifact tag/commit/byte sizes/hashes and fixed layout engine;
- content/media/config hashes and revision;
- offline snapshots and `offlineVerified`;
- exactly three loop summaries;
- bounded recovery/skip/retry events;
- shutdown classification and operator notes.

Each loop summary contains:

- loop ID and monotonic start/end;
- cue counts and endpoint latency P50/P95/max;
- final visible drift and scheduler diagnostic maxima;
- reset ACK buffer SHA-256;
- retry/skip/recovery counts;
- maximum controller, renderer, and JanVim RSS;
- actual listener, timer, connection, and pending-command counts at loop boundaries.

RSS is sampled through an injected OS-process adapter at loop start/end and every five seconds.
Only count, minimum, maximum, and final values are retained; raw samples are not accumulated. The
renderer OS PID comes from its web contents, JanVim from the retained child, and controller from the
current process.

Actual coordinator timers/listeners are counted. Hard-coded zero diagnostics are not accepted as
proof. The evidence writer rejects impossible counts, duplicate loop IDs, more or fewer than three
Soak3 loops, missing reset hashes, unbounded arrays, unknown fields, secrets, user configuration
paths, and contradictory pass records.

For Show mode, terminal evidence stores aggregate counters and at most the latest three loop
summaries. Per-loop NDJSON and child streams rotate under the run-wide log budget.

## 12. Logging bounds

One `RunLogBudget` caps all controller, recovery, JanVim stdout, and JanVim stderr streams together:

- maximum 8 MiB per physical file;
- maximum 32 MiB for the run across rotated files and restarted child streams;
- bounded file count and deterministic rotation names;
- secrets replaced before serialization;
- no bridge token, user configuration path, or source-repository content;
- no unique new unbounded filename for every restart.

Logging failure cannot make recovery or shutdown unbounded. A terminal evidence flag records that
logging was incomplete.

## 13. Expected implementation surface

The master plan's Task 9 file list predates the real G2 Electron composition. The smallest honest
implementation may add focused files in addition to the listed ones:

- coordinator, run-session factory, multi-loop driver, strict show command, show runtime adapters,
  run evidence, telemetry/resource sampler, and exact HWND close adapter;
- focused controller tests for each new unit;
- a show-only exact-window close PowerShell helper and behavior tests;
- strict operator action and presentation-ACK schemas;
- modifications to Electron entry/command dispatch, preload, secondary ready/control state,
  `supervisor.ts`, and `bounded-log.ts`;
- `tests/recovery.test.ts`, `scripts/start-show.ps1`, rehearsal runbook, and incident template.

The implementation plan must enumerate exact files and preserve task-sized RED/GREEN commits. It
must not use this scope note as permission for unrelated refactoring.

## 14. Test strategy

All production changes follow RED -> GREEN -> focused verification -> commit.

Deterministic fake-clock tests cover:

- every legal and illegal coordinator transition;
- generation invalidation before cleanup and rejection of stale ACKs/events/timers;
- secondary-only recovery outside editor work;
- full session replacement during editor work, agent loss, ACK failure, and JanVim exit;
- 1/2/4-second retry timing, rolling ten-minute reset, fourth-failure safe-ready;
- controller restart returning to explicit ready;
- no checkpoint/old cue replay and original-poem hash after every recovery;
- queued Stop at the next bounded safe boundary;
- idempotent shutdown and every timeout branch;
- exactly three Soak3 loops and bounded Show-mode aggregates;
- presentation ACK correlation and metric formulas;
- RSS/listener/timer/log bounds.

PowerShell behavior tests use fake Electron/child commands and temporary directories to cover:

- exact modes and arguments;
- no npm install/download;
- protected and source-repository path rejection;
- offline refusal and diagnostic-only online marking;
- controller watchdog 1/2/4-second cap and intentional-stop exclusion;
- exact PID/HWND close verification;
- no global input, title matching, adapter mutation, recursive source deletion, or product-repository
  modification.

Existing G2, first-loop, bridge, artifact, display, placement, preload, and renderer tests remain
green. Repository verification is:

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
Get-FileHash -Algorithm SHA256 .\runtime\janvim\janvim-core.exe
git diff --check
git status --short
```

## 15. Human G3 monitor-simulation sequence

After automated gates pass, use a new external rehearsal root and fresh capture/confirm mapping for
each topology. On the two real monitors:

1. Run ValidateOnly.
2. Run Soak3 once with network physically disconnected.
3. Confirm three complete causal loops, no duplicate edit, no clipped insertion, and original poem
   after every reset.
4. Verify strict evidence thresholds and bounded resources.
5. In a separate run, terminate the secondary renderer at a safe point and observe bounded black
   recovery into a fresh loop.
6. In a separate run, terminate JanVim at the next safe point and observe bounded replacement from
   the original poem.
7. Exercise Stop Show and verify agent shutdown, exact HWND `WM_CLOSE`, natural frontend exit, and
   no exposed terminal/desktop transition.

Every record includes operator notes and photo/video hashes. Monitor success remains
`physicalProjectorsTested: false`. The same sequence must be repeated with new evidence on the two
physical projectors before G4.

## 16. Acceptance criteria

Task 9 implementation is ready for the monitor checkpoint only when:

1. every new behavior has a demonstrated failing test before implementation;
2. all automatic verification commands pass from a clean worktree;
3. the immutable artifact hashes still match the lock;
4. G2 one-loop behavior and evidence remain valid;
5. Soak3 produces exactly three valid loop summaries with cumulative visible drift below 250 ms;
6. instantaneous/presentation ACK and insertion-overhead P95 values meet the approved 100-ms gates;
7. no duplicate write, residual buffer, unbounded listener/timer/log/sample growth, or stale ACK is
   observed;
8. offline acceptance has application guards plus disconnected host snapshots;
9. secondary and JanVim forced-recovery rehearsals each return to a fresh original-poem loop within
   bounded budgets;
10. normal Stop Show yields the approved exact-window shutdown record.

This is G3 desktop evidence only. Final completion still requires two physical projectors, three
consecutive loops, an offline run, forced recovery, packaging, and G4 records.
