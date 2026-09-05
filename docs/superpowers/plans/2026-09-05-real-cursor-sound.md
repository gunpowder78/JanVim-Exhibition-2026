# Real Cursor Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real exhibition-buffer cursor movement drives the accepted standalone pluck voice, with optional connection and terminal Show Stop fade.

**Architecture:** Keep the existing sound process independently launched. Add bounded observational messages to the authenticated editor bridge, forward them through the sound process's existing authenticated loopback control listener, and retain one OSC sender. Audio is an optional observer, never a dependency of cue completion.

**Tech Stack:** TypeScript, Zod, Node 22.23.0, PowerShell 7, Neovim 0.10.1 exhibition Lua, existing SuperCollider 3.14.1 service.

**Spec:** `docs/superpowers/specs/2026-09-05-real-cursor-sound-design.md` (user approved).

## Global Constraints

- Work only in `.worktrees/sound-real-cursor`, branch `feat/sound-real-cursor`, based on `cbde651840805ca1ae8d0a540ea5dac0a05a4056`.
- 不编译或替换 JanVim 产品，不修改 artifact lock、原诗、长文 profile、显示配置、配色或用户 Neovim 配置。不推送、合并或替换里程碑标签。
- 《见山》本轮只保留协作备忘，不实现真实鸟群接入，不修改其他仓库。
- 听音仍必须显式 `-Listen`，默认仅无声诊断。现有运行时长和录音上限保持不变。
- 源端和声音接收端均限制最多 8 次/秒；一处最多保留一个最新待发样本，超过 0.5 秒直接丢弃，不补播积压音符。不增加编辑命令重试。
- 声音连接和发送均不进入 cue 的等待链。
- 正常循环 reset 清空光标参考后继续下一循环，不等同于终止声音。
- Stop 后锁定，不被迟到的光标或心跳唤醒；沿用 1.5 秒淡出与 2 秒失联租约。
- 本轮 JanVim 进程故障终止声音会话，画面按既有策略恢复，不自动重启声音。
- Full application and sound verification happens at the integrated head. Run focused affected suites while iterating; do not repeat the whole suite after each edit. Preserve exact command/output evidence for red and green runs.

## File and interface map

Task 1 owns Lua observation plus the bridge/schema boundary. Task 2 owns sound-side real input and its control listener. Task 3 owns the optional controller sound client and public launcher/runtime wiring. Task 4 owns end-to-end evidence and operating instructions. Do not restructure unrelated large files.

### Task 1: Actual logical cursor observation without changing ACK behavior

**Files:**
- Create `nvim/lua/janvim_exhibition/cursor_observer.lua`.
- Modify `nvim/lua/janvim_exhibition/actions.lua`, `nvim/lua/janvim_exhibition/init.lua`, `nvim/tests/agent_spec.lua`.
- Create `packages/show-schema/src/agent-cursor.ts`; export it from `packages/show-schema/src/index.ts`.
- Modify `apps/controller/src/bridge-server.ts` and `apps/controller/tests/bridge-server.test.ts`.
- Create `packages/show-schema/tests/agent-cursor.test.ts`.

**Interfaces:**
```ts
type AgentCursorObservation = {
  schema: 1; type: "cursor"; loopId: string; cueId: string;
  seq: number; elapsedMs: number; row: number; cellCol: number;
  viewRow: number; viewCol: number; rows: number; cols: number;
};
// Export parseAgentCursorObservation(value: unknown): AgentCursorObservation.
// Task 3 approved additive local metadata (wire/ACK unchanged):
// export interface AgentCursorTiming { readonly ageMs: number }
// BridgeServer.onCursor(listener: (event: AgentCursorObservation, timing: AgentCursorTiming) => void): () => void.
```

IDs retain the existing command ID restrictions. Sequence is positive int32; row/cellCol are integers 0..1,000,000; viewport indices are nonnegative integers within rows/cols; rows/cols are integers 1..65,536. elapsedMs is finite 0..2,000 and measured from the current action's start, not a new show clock. Wire observation maximum is 1,024 UTF-8 bytes. Missing/extra fields and non-finite values reject observations.

- [ ] Add failing schema and bridge behavior tests, then run them. Minimal literal schema fixture:
```ts
const sample = { schema: 1, type: "cursor", loopId: "loop-1", cueId: "move-1",
  seq: 1, elapsedMs: 10, row: 0, cellCol: 2,
  viewRow: 0, viewCol: 2, rows: 20, cols: 80 };
expect(parseAgentCursorObservation(sample)).toEqual(sample);
expect(() => parseAgentCursorObservation({ ...sample, cellCol: NaN })).toThrow();
```
Use a real loopback socket for bridge tests: authenticated hello, pending move command, cursor message, then matching ACK. Assert the cursor is delivered but the command remains pending until ACK. A throwing observer or malformed cursor fields must not close the agent or lose its ACK. Reject cursor before authentication, for non-movement actions, absent pending cue, duplicate/out-of-order seq and stale age. Inject the bridge monotonic clock to test 125 ms admission spacing and 500 ms age without sleeps.

- [ ] Add failing real-buffer Lua tests to `agent_spec.lua`: enable observation via `actions.new({ on_cursor = callback })`, prepare Chinese text, move and slowly insert, and inspect delivered coordinates. Chinese character movement advances display cells, not UTF-8 bytes. Observe no callback for stationary movement, prepare/reset/status or disabled observer. Callback exceptions must not change the real text, ACK outcome, reset hash or cleanup. Fake `now`/`defer` controls timing only; keep actual Neovim buffer/cursor APIs.

- [ ] Run red commands and record the intended failures:
```powershell
& '.\node_modules\.bin\vitest.cmd' run packages/show-schema/tests/agent-cursor.test.ts apps/controller/tests/bridge-server.test.ts
pwsh -NoProfile -File scripts/run-lua-tests.ps1
```

- [ ] Implement the optional observer. Record context at validated action dispatch; sample after actual move chunks, insertion cursor updates and selection endpoints. Read only the active exhibition buffer; do not call the hashing/activating status API on each sample. Convert cursor byte columns using display-cell width. Use the actual logical viewport for viewRow/viewCol/rows/cols, clamped to its declared dimensions. A throttled sample is dropped; no replay timer is required. Catch observer errors outside the existing editor failure path.
```lua
-- Within the real mutation path, after the cursor has actually moved:
if self.cursor_observer then
  pcall(self.cursor_observer.sample, self.cursor_observer, self:buffer_number())
end
```
Initialize only when `JANVIM_EXHIBITION_CURSOR_OBSERVER` equals `1` (or an explicit test option). Serialize a distinct cursor frame; allow at most one observational write in flight and no growing write queue. Discard on congestion; do not make ACK wait for the observer callback.

- [ ] Implement `onCursor` as at most one optional listener with disposal. Retain command kind and dispatch time in the already-bounded pending map. Dispatch time plus action elapsed time gives a conservative sample-age check; reject observations older than 500 ms or more than 100 ms in the future. Admit cursor only for the current authenticated session and pending move/insert/select; do not resolve pending commands. Keep existing connection-level framing/authentication protections and ACK schema unchanged.
- [ ] Run focused green suites, `npm run typecheck`, `git diff --check`; review scope, then commit only Task 1 files. Report red and green outputs and the exported interface.

### Task 2: Standalone real-input mode and single OSC sender

**Files:** Create `sound/real-input.mjs`, `sound/tests/real-input.check.mjs`; modify `sound/run.mjs`, `sound/start-sound.ps1`, `sound/tests/supervisor.check.mjs`, `sound/tests/integration.mjs`.

**Interfaces:** Preserve old CLI return values and control receipts for default simulation. `-Input RealCursor` maps to `--input real-cursor`; omitted input remains simulated. Real-mode `control.json` adds `input: "real-cursor"` and uses the existing port/token. Existing `{command:"stop",token}` remains accepted.

New control stream frames (strict key sets, <=1,024 bytes, no text content):
```ts
type Attach = { command: "attach"; token: string; runId: string; controllerRunId: string };
type Frame = { command: "heartbeat" | "cursor"; token: string;
  runId: string; controllerRunId: string; seq: number; elapsedMs: number;
  generationId: number; loopId: string;
  x?: number; y?: number; motion?: number };
// heartbeat has no x/y/motion; cursor requires all three, finite in [0,1].
// seq positive int32; elapsedMs finite 0..3,600,000; generationId positive int32.
// IDs use the matching existing run/controller/loop ID bounds.
// Reply to first successful attach: {ok:true,input:"real-cursor"}.
```

One attached source per sound run, even after its socket closes. All cursor frames must match the generation and loop announced by the latest heartbeat. Reject older generations; an owner heartbeat announcing a newer generation clears the latest sample. Actual JanVim process faults terminate audio through Task 3's Stop hook; a secondary-only generation change must not be mistaken for a new JanVim process. Each attach establishes elapsed-time origin for freshness; source elapsed values cannot regress. TCP ordering, bounded frames, one latest sample and age checks prevent backlog playback. Rejected input never refreshes the 2 second producer lease. Ordinary loop change resets the latest sample without terminating sound. Heartbeats before the first started loop use the literal loopId `idle` and cannot admit cursor notes. Authenticate and strip the private control token before any IPC/event logging.

- [ ] Add red CLI compatibility and real input policy tests. The pure policy exports `createRealInput({nowMs,onStop})` with `attach(identity)`, `accept(frame)`, `take()` and `close()`. Token authentication is the listener's responsibility; identity/sequence/state checks are the policy's. Literal behavioral test:
```js
let ms = 0;
const stopped = [];
const input = createRealInput({ nowMs: () => ms, onStop: r => stopped.push(r) });
assert.equal(input.attach({runId:"show-1",controllerRunId:"ctl-1"}), true);
assert.equal(input.attach({runId:"show-2",controllerRunId:"ctl-2"}), false);
ms = 2000;
input.take();
assert.deepEqual(stopped, ["producer-timeout"]);
```
Also prove no fake cursor/flock before attach; <=8 Hz; latest-only replacement; >500 ms stale discard; Stop latch; heartbeat-only renewal; wrong sequence/identity; loop changes; generation changes; source disconnect.
- [ ] Run `node --test sound/tests/real-input.check.mjs sound/tests/supervisor.check.mjs` and record red output.
- [ ] Extend the existing control listener with a real-input option, not a second listener/service. Keep exact manual Stop and its persistence/cleanup tests. Limit attached input to one stream, existing total connection cap, bounded per-frame receive buffers, and finite idle timeouts; the attached stream's timeout follows producer lease rather than the old one-shot 1-second timeout. Wrong-token clients cannot evict the owner or stop it.
- [ ] Initialize the pure policy in real mode; use bounded IPC to supply the existing sender with due features. Do not push unlimited IPC events: request/reply or a single in-flight update plus one latest slot. Before attachment allow service-health heartbeats with no notes, subject to the existing finite duration; after attachment only fresh producer heartbeats may renew SC lease. Apply the same 8 Hz and freshness ceiling on final sender admission, not just at input reception.
```js
const events = realInput ? realInput.take() : timeline.due(elapsed);
// Existing sender serializes events and owns every OSC seq/sentAt.
for (const event of events) await sendEvent(event);
```
Do not replace pluck SynthDefs, add flock simulation, change gain/device, or modify Windows lifetime ownership. Silent defaults and stop retry deadline remain.
- [ ] Run focused Node tests and a short silent real-mode recording: no attach remains silent; controlled real-input fixture produces plucks; manual Stop produces the existing tail and silence. Label this a transport fixture, not real cursor acceptance. Run all existing sound suites once before committing Task 2; preserve external logs and exact commands in its report.

### Task 3: Optional nonblocking exhibition sound client and lifecycle wiring

**Files:** Create `apps/controller/src/show-sound-client.ts`, `apps/controller/tests/show-sound-client.test.ts`; modify `apps/controller/src/show-command.ts`, `apps/controller/src/show-runtime-adapters.ts`, `scripts/start-show.ps1`, `apps/controller/tests/show-command.test.ts`, `apps/controller/tests/show-runtime-adapters.test.ts`. Update public-launcher tests only where the new optional flag has an observable effect.

**Interfaces:** Consume Task 1 `AgentCursorObservation`/`onCursor` and Task 2 control frames. Add `soundRunRoot?: string` to ShowCommand and optional `--sound-run-root=` flag. Client public contract:
```ts
interface ShowSoundClient {
  start(): void; // bounded asynchronous connect; never awaited by cues
  beginLoop(generationId: number, loopId: string): void;
  observe(event: AgentCursorObservation, timing?: AgentCursorTiming): void;
  reset(): void;
  stop(reason: string): void; // idempotent terminal request, bounded cleanup
}
```

- [ ] Add red tests using a real local TCP peer and temporary external receipt directory. No option means no read/connect. Missing/invalid receipt, outside-root/reparse escape, remote host, wrong token, closed port and backpressure disable only audio. Bound receipt reading to 4,096 bytes and connection attempt to 1 second; close after failure without retry loops. No token/plaintext content in diagnostics.
- [ ] Add fake-clock mapping tests with hand-derived values. `x=1-viewRow/max(1,rows-1)`, `y=viewCol/max(1,cols-1)`. Compute `motion=min(1,hypot(deltaRow,deltaCellCol)/8 * 125/max(125,deltaMs))` from raw logical displacement and observed interval, not viewport changes. For first observation of a loop, establish baseline without a note. Same row/cellCol produces no note even when the viewport changed. Reset clears reference and pending sample; the following real change can pluck.
```ts
// Row 5 of 11 and column 10 of 21 maps to x=0.5,y=0.5.
// Stationary raw coordinates with a scrolled viewport must still be silent.
```
- [ ] Run focused red command/schema/client/runtime tests before wiring.
- [ ] Implement optional root transport with a canonicalized fixed `control.json`, exact real-input receipt, one socket and one latest sample. After attach acknowledgement send producer heartbeat every 250 ms. Output at most 8 cursor messages/second; retain original sample age through backpressure. Timestamp control frames from this client's monotonic attach origin, not wall clock. Expired heartbeat or closed peer closes audio and frees timers/listeners.
- [ ] Wire only actual Soak3/Show, not ValidateOnly. `start-show.ps1` forwards the optional root without reading or modifying a sound run; invalid sound configuration is handled as audio-disabled by the client. Set `JANVIM_EXHIBITION_CURSOR_OBSERVER=1` only in the private candidate child environment when the optional path is active; strip inherited observer flags when not opted in. Subscribe once to bridge observations, dispose subscription with session.
- [ ] At actual loop start establish current generation/loop. Before prepare/reset, clear audio movement reference; reset itself is silent. Request terminal audio Stop at Show shutdown, child/agent fault, controller emergency lifecycle and session disposal; never await the audio fade from cue or visual shutdown. Preserve existing visual recovery decisions. Stop before any late callbacks can re-arm the client; do not create a fresh audio client for recovery generation.
- [ ] Run command/client/runtime/bridge suites, typecheck, lint, and diff check. Verify disabled-path existing tests remain unchanged in behavior. Commit only Task 3 implementation/tests.

### Task 4: Real Lua-to-sound proof, integrated gates, and operator handoff

**Files:** Create `sound/tests/real-cursor-chain.check.mjs` and `nvim/tests/real_cursor_fixture.lua`; create `docs/operations/2026-09-05-real-cursor-sound-handoff.md`; update `sound/README.md` and this plan's status/evidence. Add narrowly scoped integration fixes only with failing tests.

- [x] Write a failing chain test that starts actual Neovim headless with the candidate Lua, dispatches prepare/move/insert/reset via the production bridge, uses production sound-client + real-input listener + sender, and captures the production SC output silently. No user init, product source edits, global keyboard input, or fabricated cursor coordinates. A test utility may bundle the TS test entry with the existing toolchain; it is not a new production server. Keep actual Lua buffer APIs and telemetry through to the sound receiver.
- [x] Assert actual text/reset hash, actual observed logical coordinates, received pluck events, no simulated flock, no extra notes during stationary/reset intervals, and no notes after Stop. Use recorded samples to verify fade/silence, not only process exit. Run the controlled fixture with sound unavailable and prove the same text/ACK/reset completes. Record evidence as headless integration, not visual/human hearing acceptance.
- [x] Prepare ignored runtime/dependencies only in this candidate using existing locked runtime tooling; verify core/config hashes first. Do not copy or move a live private user root. Record exact versions and full-gate exit codes:
```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run lint
pwsh -NoProfile -File scripts/run-lua-tests.ps1
pwsh -NoProfile -File scripts/verify-runtime.ps1
node --test --test-concurrency=1 sound/tests/osc.check.mjs sound/tests/supervisor.check.mjs sound/tests/wav.check.mjs sound/tests/startup-lifetime.check.mjs sound/tests/integration.mjs sound/tests/real-input.check.mjs sound/tests/real-cursor-chain.check.mjs
git diff --check
Get-FileHash -Algorithm SHA256 -LiteralPath apps/controller/dist/main/electron-main.js
```
Long-running gates stream to unique external evidence files with finite process deadlines; preserve failures rather than overwriting them. No audible output during autonomous validation.
- [x] Add a short operator handoff with complete file-based commands: sound window starts `-Input RealCursor -Listen -Duration 900`, then the existing candidate show launcher with the exact new SoundRunRoot. Use fresh show evidence roots and the operator-confirmed current display map; never assume a historical display ID is still current. User listens to real long-text motion, one reset, then Stop; only after they confirm is hearing acceptance marked passed.
- [x] Final task report distinguishes automated passes from pending manual observation, records candidate source/bundle/core identities and unchanged fallback, and points to the separate 《见山》 coordination memo. Commit locally; do not push/merge or relabel old acceptance.

## Plan self-review and execution record

- Task 1 → Task 3: AgentCursorObservation wire contract unchanged; approved local `AgentCursorTiming {ageMs}` is the second `onCursor`/`observe` argument. Real Bridge metadata must be forwarded; missing metadata is dropped, never replaced with fabricated age0. This supersedes the original event-only signature and remains additive, not an ACK replacement.
- Task 2 → Task 3: exact attach/heartbeat/cursor/stop control frames above; one sound run and one owner, one OSC sender.
- Task 1/2/3 → Task 4: actual Lua, production bridge/client/sender chain is required; mock movement does not satisfy acceptance.
- Disabled audio, reset continuation, conservative fault stop, optional standalone startup, no birds, bounded resources and baseline preservation each have an implementation task plus verification.
- Initial candidate preparation completed `npm ci` and 33 existing sound checks; this was only the original baseline, superseded for integrated automated verification by the Task4 record below.

### Task4 execution evidence — 2026-09-05

- Task4 implemented against `565dc6dea120abe27c8624096e1cb4e23fc55959` on the isolated `feat/sound-real-cursor` candidate. Task1–3 implementation/review completion is recorded in the parent SDD ledger; original task checklists above are retained as their historical requirements.
- Actual NVIM v0.10.1 + immutable JanVim runtime + candidate Lua observer → production Bridge/client/listener/sender/SC proved headlessly. Each audio-available/unavailable scenario completed12 identical text/ACK/reset results and13 real observations. Chinese cell2 versus ACK byte3, stationary/reset no new notes, resumed loop plucks, Stop latch and recorded post-fade silence all passed. Real `AgentCursorTiming {ageMs}` is forwarded, preserving the frozen source-age/nonregressing-stream behavior.
- Final gates: npm ci/typecheck/build/lint/Lua/runtime all exit0; application57 files/1128 tests pass; complete sound69/69 pass,0 skipped. Existing lint does not cover TypeScript. Actual bundle540860 bytes, SHA-256 `2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`; launcher/smoke constant maintenance had existing mismatch RED23/24, rebuilt consistency GREEN24/24. JanVim core/lock unchanged.
- First overlapping complete gates were application1127/1128 (one5s path-test timeout) and sound62/69 (seven READY/ownership/PowerShell inspection failures). Unchanged serial focused checks then passed, followed by serial complete sound69/69 and application1128/1128. No timeout, ownership, watchdog, cap or assertion was weakened. Original failures remain evidence; serial success supports workload contention, not arbitrary-load stability. Earlier Task2 full sound62/68 remains a failed aggregate, followed by its own14/14 fixture fix.
- Exact commands, all stdout/stderr and exit/deadline receipts: `D:/VirtualData/JanVim-Exhibition-Rehearsals/task4-gates-20260905-565dc6d`; detailed report `.superpowers/sdd/2026-09-05-real-cursor-sound/task-4-report.md`. Final serial chain roots are `sound-chain-production-d164e883-cc0f-4d29-a299-d5c9cafb096a` and `sound-chain-unavailable-evidence-f8b7c43c-4d89-4b1e-9f35-26a73eec6038` under the external rehearsal parent.
- Local handoff: `docs/operations/2026-09-05-real-cursor-sound-handoff.md`, with saved ignored `operator.ps1`; explicit PRE-SHOW `songfeng-source`, new user-confirmed GUI display map, exact saved SoundRunRoot, manual `-Input RealCursor -Listen -Duration 900`. No profile selection/GUI/Listen during automated gates. Hearing, current dual-projector three loops, offline and forced-restart physical acceptance remain pending. Separate frozen Jianshan memo is unchanged; no bird code, push, merge or milestone relabeling.
