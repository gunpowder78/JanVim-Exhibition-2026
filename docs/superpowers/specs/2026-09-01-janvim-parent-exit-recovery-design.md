# JanVim parent-exit recovery design

- Status: approved by owner on 2026-09-01
- Date: 2026-09-01
- Parent plan: `docs/plans/2026-08-28-four-day-dual-projector-delivery.md`, Task 9
- Parent design: `docs/superpowers/specs/2026-08-29-task9-recovery-offline-soak-design.md`
- Failed rehearsal: `g3-janvim-fault-20260831-221012`

## 1. Problem and evidence

The G3 monitor-simulation JanVim fault rehearsal proved that the current process lifecycle model is
incorrect on the real Windows runtime. The exact runbook block terminated only the verified JanVim
frontend PID `7628`. Its direct Neovim backend PID `43756` remained alive and retained the inherited
stdout/stderr pipe handles. Node therefore emitted the frontend `exit` event but did not emit the
`close` event observed by `RuntimeShowSession`.

The controller consequently remained in generation 1, recorded no recovery event, and continued
without a JanVim frontend. The later forced secondary-window close produced
`emergency-window-close`, an unsettled run lease, and an intentional failure. This was not an
operator-observation failure.

The existing automated fixtures reproduced child death by emitting only `close`. They could not
represent a terminated parent whose descendant still held inherited streams, so they did not
detect this defect.

## 2. Goal and boundaries

An unexpected JanVim frontend exit must immediately invalidate the current cue generation and
start bounded full-session recovery, even when inherited output streams remain open. Recovery may
be declared settled only after the show-owned Neovim backend and inherited streams have also
closed. A replacement generation starts only after the original poem prepare ACK and hash check.

The repair must:

- stay entirely in the exhibition repository and its existing `task1` worktree;
- leave the immutable JanVim artifact, JanVim product repository, user Neovim configuration,
  source poem/media, and protected incident directories unchanged;
- preserve the parameter-free authenticated `shutdown` protocol and rejection of arbitrary Ex,
  Lua, shell, key, or path input;
- keep Electron main as the only show clock and generation owner;
- keep every cleanup phase, retry, timer, and stream wait finite;
- preserve normal Stop Show behavior when the JanVim frontend is still alive;
- retain failed rehearsal evidence and never reuse its directory.

This repair does not add a Windows service, Job Object launcher, generic process-tree search,
process-name kill, new protocol field, product patch, visual feature, or G4 claim.

## 3. Chosen design

The runtime separates process liveness from output settlement:

```text
JanVim frontend `exit`
  -> mark frontend exited exactly once
  -> notify `janvim-exited` exactly once
  -> invalidate generation and stop old cue dispatch
  -> send authenticated parameter-free shutdown to the old show agent
  -> agent checks its captured original parent PID
       parent alive   -> existing connection-only shutdown
       parent absent  -> ACK, close transport, schedule fixed backend exit
  -> Neovim backend exits and releases inherited streams
  -> child `close`
  -> finalize bounded stdout/stderr and remove exact run lease
  -> apply 1/2/4-second JanVim restart budget
  -> launch/place/prepare replacement generation
  -> resume only from a fresh original-poem loop
```

### 3.1 Frontend `exit` is the fault signal

`G2SpawnedChild` exposes both `exit` and `close`. `RuntimeShowSession` installs one listener for
each before inspecting process identity.

The first `exit` marks frontend liveness false and resolves a dedicated frontend-exit promise. If
shutdown was not already requested, it emits one `janvim-exited` fault. Duplicate `exit`, a later
`close`, bridge disconnect, or stale generation callback cannot emit a second current-generation
fault.

### 3.2 Child `close` remains the settlement signal

`close` continues to mean that the frontend ended and all inherited output handles are closed. It
detaches and finalizes the two bounded stream sinks, resolves the existing full-settlement promise,
and begins exact lease removal. Recovery cleanup does not report `childSettled: true` until this
signal arrives within the existing finite deadline.

This preserves output classification and prevents a replacement generation from hiding an orphan
backend.

### 3.3 Parameter-free orphan-backend cleanup

The show-only Lua connection captures its original parent PID once through the Neovim 0.10.1
libuv API. The existing `shutdown` action still accepts no fields.

On authenticated shutdown, the agent first completes the normal ACK and closes its transport. A
fixed injected predicate then checks whether the captured parent PID still exists:

- if the parent exists, no backend-exit callback runs; normal Stop Show remains connection-only and
  the exact HWND close lets JanVim own its ordinary frontend/backend teardown;
- if the parent is absent, the agent schedules one fixed backend-exit callback after ACK handling;
  production wiring performs only the hard-coded Neovim exit operation.

No controller-provided string reaches the exit callback. Tests continue to reject `command`, Ex,
Lua, shell, and unknown shutdown fields. Failure or uncertainty in the parent check fails closed:
the backend is not exited by that check, `close` does not settle, and the controller enters bounded
`safe-ready` rather than launching over an unproven old session.

## 4. Error handling and safety

- Listener registration occurs before asynchronous identity inspection so an immediate exit is not
  lost.
- `exit` and `close` handlers are idempotent and generation guarded.
- The agent records no user path or token and does not enumerate or kill processes.
- Parent-liveness checking uses only the PID captured at agent construction; it never accepts a PID
  from a cue.
- The fixed backend exit runs at most once and only after authenticated shutdown plus confirmed
  parent absence.
- If backend exit does not lead to `close` before the existing cleanup deadline, recovery records
  `old-session-unsettled` and does not start a replacement.
- Normal shutdown evidence continues to require acknowledged agent shutdown, posted exact HWND
  close, natural JanVim settlement, bridge close, and lease removal.

## 5. Test-first implementation

Production code changes begin only after these RED cases fail for the expected reason.

### 5.1 TypeScript RED

Add a runtime-adapter test whose fake JanVim child emits `exit` while its stdout/stderr streams stay
open and no `close` is emitted. Assert that:

- the coordinator immediately leaves `running` for recovery;
- generation 1 dispatch is invalidated and no old editor cue can complete later;
- the old agent receives the fixed shutdown request;
- no replacement generation starts while `close` remains absent;
- after simulated backend settlement emits `close`, the 1-second recovery creates generation 2,
  prepares the original poem hash, and resumes from a fresh loop;
- listeners, streams, bridge, lease, and process counters return to bounded values.

The existing `close`-only fixtures must be split so they can emit `exit` and `close` independently.

### 5.2 Lua RED

Add agent tests with injected parent-liveness and fixed backend-exit callbacks. Assert that:

- parent alive: shutdown ACK is applied, transport closes once, backend exit count remains zero;
- parent absent: shutdown ACK is applied, transport closes once, fixed backend exit runs once;
- duplicate shutdown cannot schedule a second exit;
- shutdown with any user string remains rejected and cannot close or exit anything.

### 5.3 Verification

After focused RED/GREEN cycles, run:

```powershell
pwsh -NoProfile -File .\scripts\run-lua-tests.ps1
npm test -- apps/controller/tests/show-runtime-adapters.test.ts tests/recovery.test.ts
npm run typecheck
npm run lint
npm test
npm run build
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
git diff --check
git status --short
```

The ignored prepared Plugin Lab runtime copy must be synchronized from the reviewed exhibition Lua
source and verified without changing the immutable JanVim artifact hash.

## 6. Expected implementation surface

The minimal expected files are:

- `apps/controller/src/g2-runtime-adapters.ts`;
- `apps/controller/src/show-runtime-adapters.ts`;
- `apps/controller/tests/show-runtime-adapters.test.ts`;
- `nvim/lua/janvim_exhibition/init.lua` and/or `actions.lua`;
- `nvim/tests/agent_spec.lua`;
- `tests/recovery.test.ts` only if the composed recovery contract needs an additional assertion;
- the ignored prepared runtime copy corresponding exactly to the committed exhibition Lua source.

No schema or runbook change is expected unless a RED test proves the parameter-free contract or
operator procedure is insufficient.

## 7. Acceptance

The implementation is ready for another human rehearsal only when all automated gates pass and the
worktree contains no unrelated change. The retry must use new ValidateOnly and Show roots.

The JanVim fault subgate passes only when durable evidence and human observation agree that:

1. the exact JanVim frontend exits and the old generation stops immediately;
2. no old text writes back after the fault;
3. the show-owned Neovim backend and inherited streams settle within finite cleanup bounds;
4. one bounded JanVim recovery event records a new generation;
5. the replacement window contains the original poem before a fresh loop starts;
6. the fresh loop writes once, resets cleanly, and exposes no desktop or terminal;
7. Stop Show returns exit code 0, removes the lease, and leaves no process belonging to the retry;
8. evidence remains `acceptanceScope: monitor-simulation` and `physicalProjectorsTested: false`.

Only after this subgate passes may the independent normal Stop Show run proceed. G4 still requires
the same recovery on two physical projectors.
