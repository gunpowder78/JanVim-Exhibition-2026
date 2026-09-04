# Isolated OSC Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an isolated, verified pluck/wind/stop candidate ready for later human listening.

**Architecture:** A dependency-free Node supervisor simulates features and sends bounded OSC to sclang. SC alone owns admission policy and synthesis; a shared limiter/fader precedes hardware output. Silent capture uses the production graph.

**Tech Stack:** Node 22.23.0 ESM and node:test, SuperCollider 3.14.1, PowerShell 7, existing repository verification tools.

**Spec:** `docs/superpowers/specs/2026-09-05-sound-minimal-loop-design.md`

## Global Constraints

- Work only in `.worktrees/sound-minimal-loop`, branch `feat/sound-minimal-loop`; local commits only, no merge/push/tag replacement.
- Use installed SuperCollider 3.14.1, Node 22.23.0 and PowerShell 7. No dependencies, GUI, driver installation, system volume/network changes, editor product rebuild, show-clock changes, or real bird telemetry invented from placeholder content.
- All overnight checks are inaudible: synthesis files or an output graph whose hardware gain is zero.
- Keep new files in `sound/` plus design, plan and operations documents. Existing package manifests, Electron code, Lua agent and artifact lock remain unchanged.
- Destination `127.0.0.1:57140` (sclang); private scsynth `127.0.0.1:57141`. Never displace an existing process.
- Headphones device must match `Windows WASAPI : Headphones (Senary Audio)`; 48 kHz, stereo, zero input channels. Do not fall back to speakers or another endpoint.
- Ceiling 0.2 linear sample amplitude; one wind voice and at most eight overlapping pluck nodes; shared stop fade 1.5 s.
- Human listening and real JanVim/Jianshan integration remain pending.

## Task 1: Bounded OSC encoding and SC admission policy

**Files:** Create `sound/osc.mjs`, `sound/policy.scd`, `sound/tests/osc.check.mjs`, `sound/tests/policy.scd`, `sound/tests/run-policy.ps1`.

**Interfaces:** Node `encodeMessage(path, args)` accepts typed objects `{type:'s'|'i'|'f'|'d', value}` and returns a Buffer <=512 bytes. Reject bad path (only five spec paths), NUL/non-ASCII string, type/size overflow and non-finite number. SC file evaluates to a factory function: `factory.value(session)` returns an Event containing `handle` (msg array and now seconds -> action Event or nil), `tick` (now -> stop Event or nil), `snapshot` (bounded counters/state). Use `.at(key).value(...)`, avoiding Event implicit pseudo-method behavior.

SC messages are `[path, session, seq, sentAt, ...features]`. Action types are `start`, `pluck` (midi, motion, pan), `wind` (energy, pan), `stop` (reason). State begins idle; explicit start enters running; stop/timeout enters stopped terminal. Use exact lengths, type and finite checks before mutation. MIDI mapping/pan and timing constants are specified in the design. Rate-limited packets may advance valid sequence but must not refresh heartbeat. Snapshot includes state, lastSeq, acceptedPlucks, acceptedFlocks, rejected, rateDropped; counters saturate at int32 max. No history arrays or synthesis in policy.

- [x] Write failing packet tests with manually encoded bytes, not round-trip-only comparisons:
  ```js
  assert.equal(encodeMessage('/janvim/sound/v1/stop', []).subarray(-4).toString('hex'), '2c000000');
  assert.throws(() => encodeMessage('/other', []));
  assert.throws(() => encodeMessage('/janvim/sound/v1/stop', [{type:'f', value:NaN}]));
  ```
  Add alignment/int bounds/float64/oversize cases and a localhost datagram receipt test.
- [x] Write SC behavior tests first. Example expected lifecycle:
  ```supercollider
  p = factory.value("0123456789abcdef0123456789abcdef");
  a = p.at(\handle).value(["/janvim/sound/v1/start", session, 1, 10.0], 10.0);
  // Assert a.at(\type) == \start; then tick(12.0) returns stop; start at 13 remains nil.
  ```
  Cover no start, invalid shapes/types/numbers, stale/future/duplicate/out-of-order, heartbeat-only lease, late heartbeat, rate boundaries, clamp/MIDI endpoints, idempotent stop and 10-hour fake-clock activity. Assertions throw on failure and exit nonzero, runner has 30s bound, no boot/audio server.
- [x] Run RED via `node --test sound/tests/osc.check.mjs` and `pwsh -NoProfile -File sound/tests/run-policy.ps1`. Record actual expected missing-feature failures.
- [x] Implement only the factory/encoder needed, run GREEN, independently review and local commit. Evidence: `0438c67`, fix `5bb152a`; task review and scoped fix review clean. Additional isolated startup, output/exit bound, snapshot, and saturation tests passed.

## Task 2: SC synthesis service and silent DSP evidence

**Files:** Create `sound/synths.scd`, `sound/service.scd`, `sound/tests/render.scd`, `sound/tests/analyze-wav.mjs`, `sound/tests/wav.check.mjs`.

**Interfaces:** `synths.scd` evaluates to a function returning an Array of SynthDefs. Named definitions `jvPluck`, `jvWind`, `jvMix`, `jvOutput`, `jvCapture`. Voices write a private stereo bus; `jvMix` reads it, LeakDC/Limiter(0.2)/finite 1.5s fade, writes another private stereo bus. `jvOutput` reads final bus and multiplies by explicit `hardware` (default 0) before Out(0); `jvCapture` records final bus to a buffer, never microphone. This separation allows exact same synthesis path in NRT and real-time without modifying audio code for tests.

Service CLI `sclang -u 57140 -D sound/service.scd SESSION MODE DURATION CAPTURE_PATH`, MODE `silent` or `listen`, DURATION finite 1..3600 s. Empty capture path disables recording; recordings <=120 s (buffer cap). READY line `SOUND_READY <json>` contains `clock`, `languagePort`, `serverPort`, `hardwareOutput`, `session`; prefix records only, bounded output. `SOUND_EVENT <json>` for start/stop only; `SOUND_STATS <json>` every <=10s includes policy counts and live/max pluck node counts. `SOUND_COMPLETE <json>` at cleanup includes reason and clean stop. Emit JSON via a small explicit known-field formatter if built-in JSON serialization is unavailable. Session/path strings must be escaped. Service initializes outputs at zero and never accepts alternate hardware endpoints.

- [ ] Write WAV analysis tests first with handcrafted PCM16 stereo RIFF bytes: reject truncated/misaligned/unsupported/nonfinite data, calculate independent exact peak/RMS/segment silence. Export `analyzeWav(buffer, segments)` with format, duration, channels, per-segment peak/RMS; no whole-file unbounded input (>64MiB reject).
- [ ] Write a real NRT render test before definitions exist. Use Score with production definitions and include isolated pluck/wind/mix and stop sections; final dummy event leaves >=2 seconds of postfade silence. Render at 48k PCM16 and no device boot. Assertions: initial/postfade peak <=1/32768, active peak >0.01 and <=0.2001, both channels nonzero, no clipped samples. This is signal validation, not aesthetic approval.
- [ ] Run RED, implement definitions and service. Voices have finite lifecycle and at most eight plucks; one wind. Smooth wind changes; limiter precedes fade. Clamp voice inputs at synthesis boundary too. Stop latches policy, fades all via mixer; ignores later activity.
- [ ] Implement mixer DSP lease with changing heartbeat control, a 2 s timer and latched 1.5 s envelope release; accepted heartbeat updates it. Test missing DSP heartbeat independently in NRT, so language-process death cannot leave the wind audible. Silent service must omit audible output Synth rather than multiply a potentially invalid signal by zero.
- [ ] Integrate policy `handle`/`tick` in OSCdef (loopback only); 50ms timeout checker. Bound startup <=30s, cleanup <=8s, duration <=3600s. Fail closed to silence on SC /fail or server exit; no unbounded recovery. Quit only this own server. Write capture then free nodes/buffers after bounded fade. No raw OSC passthrough.
- [ ] Include the newly booted `server.pid` as `serverPid` in READY; the supervisor validates and pins live identity/ancestry in memory before language-only interruption or orphan cleanup. Never authorize process termination from a disk receipt alone.
- [ ] Avoid the stock `Server.boot` auto-reclaim branch (`prPingApp` can call quit on an existing responder). Use a minimal owned-process startup path and an occupied-responder regression fixture; never rely on a released preflight bind to authorize later automatic reclamation.
- [ ] Run silent NRT checks and language compile/policy checks; report tests. Local commit/review.

## Task 3: Supervisor, simulated rehearsal and operator controls

**Files:** Create `sound/run.mjs`, `sound/start-sound.ps1`, `sound/stop-sound.ps1`, `sound/tests/supervisor.check.mjs`, `sound/tests/integration.mjs`.

**Interfaces:** CLI `node sound/run.mjs --mode silent|listen --duration 45 --output ABS_FRESH_DIR` starts the exact SC service, waits READY, uses receiver clock anchor with performance.now() for typed OSC timestamps. Output defaults to a fresh `sound-<timestamp>-<random>` under the external rehearsal parent; refuse reused/non-external destinations. Supervisor opens a loopback-only ephemeral control listener, stores its address plus random control token in this run's `control.json`, accepts exact stop only, then closes it. `node sound/run.mjs --stop ABS_RUN_DIR` validates the receipt and asks this supervisor to stop; does not kill a PID from disk. PowerShell wrappers expose `-Listen` and `-RunRoot` with explicit absolute invocation independent of cwd. Never default to Listen.

- [ ] Write failing CLI tests: default silent, invalid duration/mode/path, reused output, port occupation does not kill occupant, child launch fails cleanly, bounded stdout line/buffer and log limits, matching/wrong stop token. Real disposable process/UDP fixtures preferred; fake-clock pure timeline test for non-burst scheduling.
- [ ] Implement sender timeline deterministically: plucks-only first third, wind-only second, mixed last third; x/y/motion/energy vary with fixed formula. Heartbeat every .25s; no timer catch-up audio burst after stall. Send start once and await event acknowledgment. Stop packets at most three attempts over <=.3s with increasing seq; supervisor then awaits fade/cleanup. SIGINT/SIGTERM call same idempotent stop. Timeout kills only the ChildProcess created by this invocation and its exact descendants; never processes by name. No automatic audible restart.
- [ ] Implement silent integration recording using actual UDP -> policy -> SynthDefs -> capture: nonzero sections, correct stop silence; send stale/wrong-session/extra-argument/NaN and poststop activity probes. Verify no accepted activity after stop. Kill only the newly created sender/sclang in interruption tests; assert port reuse and fresh launch. Do not record continuously on 30min soak.
- [ ] Distinguish whole-tree shutdown from sclang-only loss. Pin this launch's server identity while both are alive, verify independent DSP timeout behavior, then reclaim only the same owned audio process if it is orphaned.
- [ ] Run tests and silent demo, then 30min silent resource test with sampled own child working sets and node counts. One 10-hour fake-clock policy run remains separately labeled. Local commit/review.

## Task 4: Whole-branch verification, read-only integration notes and handoff

**Files:** Create `sound/README.md`, `docs/operations/2026-09-05-sound-minimal-loop-handoff.md`, update this plan's checkboxes with evidence references. External receipts only for generated logs/WAV.

- [x] Inspect actual sources without mutation: `nvim/lua/janvim_exhibition/actions.lua`, `init.lua`, controller show coordinator and `show/jianshan-standby.html`; write exact future observation/control points and missing Jianshan exporter. Do not add real integration or treat command ACK as motion. Summary recorded in the operations handoff; Jianshan and Jianshan02 inspection commits pinned there.
- [ ] Run the required gates in the candidate: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run lint`; run Lua/runtime verification. Use direct vitest CLI for focused tests because this installed npm wrapper mishandles forwarded flags. Compare core/lock/content/config and Electron hash to baseline; no changes permitted outside sound/docs.
- [ ] Record Node/SC/ports/device, commits, honest test outcomes, resource duration/node/memory stats, audio sample metrics/hashes and any limitations in an external JSON receipt and concise tracked handoff. Distinguish automatic signal checks, real-time silent transport, simulated input, and still-pending human hearing.
- [ ] README: one absolute launch command (`-Listen` only for user), second-terminal stop command, fresh paths, failure/no-audio procedure referencing known-good official tone, no IDE required, no system volume manipulation. Preserve listen examples and stops together.
- [ ] Whole-branch independent review with exact base/diff; resolve substantive findings, rerun affected tests, local commits only. Do not merge or push. Leave candidate ready and stopped.

## Self-review / rulings

- Scope and file interfaces checked: Task 1 policy/OSC consumed by Tasks 2/3; Task 2 READY/session/definitions consumed by Task 3; Task 4 documents tested behavior only.
- No source modifications needed for baseline setup: ignored immutable runtime copies and build outputs are staged in candidate. Missing setup assets are not waived as passing tests.
- User explicitly waived intermediate review waits; perform self-review and continue. Do not waive acoustic acceptance, broaden side effects or install software to force a gate through.
