# Isolated OSC sound minimum loop

Date: 2026-09-05. Status: approved scope; user delegated design/plan self-review and all intermediate checkpoints during overnight work. Human listening is pending, not waived.

## Outcome and exclusions

Deliver a standalone stereo sound candidate: simulated cursor activity creates pentatonic plucks; simulated flock state changes a continuous wind voice; one stop fades both. Do not integrate into the real show in this change. The accepted visual baseline is `abd471c1d05d779dd6df5f00bc1511ac9ce1d41d`, untouched in its existing worktree. Work only in `.worktrees/sound-minimal-loop`, branch `feat/sound-minimal-loop`; local commits only, no merge/push/tag replacement.

Use installed SuperCollider 3.14.1, Node 22.23.0 and PowerShell 7. No dependencies, GUI, driver installation, system volume/network changes, editor product rebuild, show-clock changes, or real bird telemetry invented from placeholder content. Electronic/whale/cosmic timbres stay deferred. All overnight checks are inaudible: synthesis files or an output graph whose hardware gain is zero.

## Architecture

Node simulator -> bounded OSC UDP messages -> sclang policy -> scsynth voices -> shared limiter/fader -> stereo headphones (explicit Listen only).

Use one Node supervisor/CLI and one SC service with small policy and SynthDef companion files. Keep new files in `sound/` plus design, plan and operations documents. Existing package manifests, Electron code, Lua agent and artifact lock remain unchanged. Use built-in `node:test` with `*.check.mjs` filenames to avoid accidental inclusion in the existing Vitest suite.

Preferred over direct controller integration because failures stop only the candidate audio process. A separate GUI/gateway/DAW would add deployment state without helping this milestone.

## Local transport contract

- Destination `127.0.0.1:57140` (sclang); private scsynth `127.0.0.1:57141`. Ports are checked at launch; no claim they are permanently reserved. Never displace an existing process.
- Paths `/janvim/sound/v1/{start,heartbeat,cursor,flock,stop}`. Ordinary OSC messages only, at most 512 bytes, no bundles or arbitrary SynthDef/server forwarding in the project protocol.
- This encoding limit is enforced by the project sender. Stock OSCdef delivers already-decoded fields, not the original UDP datagram; the service validates those fields and local source, but is not a raw-packet firewall and does not claim to detect an immediate OSC bundle wrapper. Do not add a second gateway for this trusted-local prototype. Use actual `Main.elapsedTime` for admission, never the OSC bundle time argument. Unsupported external senders and hostile local processes remain outside scope.
- Every message starts with a per-launch 32 lowercase hexadecimal session string, a positive increasing int32 sequence, and float64 `sentAt` seconds in the receiver's monotonic clock domain. Receiver emits its `Main.elapsedTime` in READY; the supervisor estimates subsequent times from its own monotonic elapsed delta. This is local diagnostic timing, not a new exhibition clock.
- Cursor adds three float32 values: normalized x, y, motion. Flock adds energy and normalized horizontal centroid. Finite numeric values are clamped to [0,1]; wrong types, missing/extra fields, non-finite values, unknown sessions or paths are rejected. Sequence <= last accepted sequence is rejected. Events older than 0.5 s or more than 0.1 s in the future are rejected.
- Receiver admits only loopback senders. Session identity prevents old candidate launches affecting new ones; it is not advertised as an authentication system for hostile local users. No remote deployment is supported.
- Start is accepted once per service process. Stop (also used by the simulator reset scenario) and heartbeat timeout latch the session stopped. Neither heartbeat, cursor, flock nor another start can resurrect it. A fresh process/session is the restart mechanism.
- Heartbeats every 0.25 s; only valid start/heartbeat refresh the lease. At >=2 s without heartbeat, stop once. Invalid traffic and continual cursor traffic do not keep a lost controller alive. Check timeout before processing a new message, so a late heartbeat cannot revive an expired session.
- Cursor admission spacing >=0.125 s; flock spacing >=0.05 s. Drop excess events; never enqueue or replay old sound events. One wind voice and at most eight overlapping pluck nodes. Each pluck has a finite lifetime <=4 s, and node release frees it. Shared stop fade 1.5 s, then silence and cleanup. Counters saturate; logs and recordings have finite caps.

## Sound and safety

Cursor y selects from MIDI [48,50,52,55,57,60,62,64,67,69,72]; x maps to stereo pan [-0.8,0.8]; motion changes excitation strength. Use built-in Pluck with a short excitation and damping, no samples. Wind uses filtered noise with smoothed energy/pan, no microphone input. Both feed the same LeakDC/peak limiter/fade chain. Ceiling 0.2 linear sample amplitude, fade after limiter; no claim this is a calibrated safe acoustic SPL.

Default mode is silent verification. Audible output needs explicit `-Listen`. Headphones device must match `Windows WASAPI : Headphones (Senary Audio)`; 48 kHz, stereo, zero input channels. Do not fall back to speakers or another endpoint. Retain the official 440 Hz example as a separate troubleshooting reference, not as a music feature.

In silent mode do not instantiate an audible output Synth at all (or write hard zeros); do not rely on `NaN * 0` being silent. The final mixer also carries a DSP-side heartbeat timeout: a changing heartbeat control resets a 2 s timer, timeout latches a 1.5 s release even if sclang itself dies. Only accepted start/heartbeat updates that control; event traffic never does. This protects the last wind node from sustaining when the language service is interrupted.

Default demo <=45 s, explicit finite duration <=3600 s. Startup timeout <=30 s, stop/cleanup deadline <=8 s, no unbounded waits. Supervisor tracks only its child process tree; it never kills processes by name. Quit only its SC server. A second-window stop targets a per-run supervisor control endpoint/receipt and is validated; Ctrl+C is a secondary convenience, not the sole stop path. Process interruption is tested only against newly created test children. No unattended human-volume test.

## Evidence and acceptance

1. Failing-first Node packet tests and SC policy tests, using injected/fake monotonic times; reject corrupt data, ensure stop latch, stale traffic, rate limits and heartbeat timeout.
2. Real OSC integration into actual SC code. Record internal final-mix PCM while hardware output remains zero, then inspect samples for finite/nonzero audio, ceiling, both channels and silence after fade. Negative control (no admitted events) must stay silent. Test definitions used for offline rendering must be the production definitions.
3. Bounded resource run: 30 minutes of silent real-time activity with repeated finite phrases; report actual duration, node bounds, sampled memory and no log growth beyond cap. Separately simulate 10 hours of policy time; do not call it a 10-hour physical run.
4. Test exact-child interruption, occupied port refusal and subsequent fresh launch. Preserve unrelated SuperCollider sessions.
5. `npm ci`, `npm run typecheck`, `npm test`, `npm run build` and `npm run lint`; Lua/runtime verification when staged assets permit. Compare unchanged Electron bundle: 526622 bytes, SHA-256 `acbe557eb15c3ffa32f936ed8e74a2a6e0d3284508a95f56c6ef71e856eb9bd0`.
6. External evidence under `D:/VirtualData/JanVim-Exhibition-Rehearsals/` in a fresh sound-prefixed directory: logs, PCM WAV, JSON metrics, hashes and test results. No source-media overwrite. Generated test audio is reproducible, not an exhibition source asset.
7. User later confirms pluck, wind, mix, stop and acceptable level in a 20-30 minute window. This is not real cursor/flock integration or physical projector acceptance.

## Real-data preparation only

Read the Lua write loop and controller lifecycle to identify future actual action observations; do not treat completion ACKs as per-character motion or byte coordinates as pixels. Identify the current Jianshan placeholder and any known repository location without modifying or executing it. Report gaps and a minimal future adapter contract. Existing visual show must not depend on the sound process in this milestone.

## Sources and self-review

Official installed 3.14.1 help is implementation reference. Web references: [OSCdef](https://doc.sccode.org/Classes/OSCdef.html), [Pluck](https://doc.sccode.org/Classes/Pluck.html), [Limiter](https://doc.sccode.org/Classes/Limiter.html), [Score/NRT](https://doc.sccode.org/Classes/Score.html).

Self-review: simulated/real distinction explicit; all waits, voices, messages and output have bounds; hardware output default off; no changes to baseline; restart cannot reuse a stopped session; exact acoustic quality remains human acceptance. User-authorized unattended decisions are limited to this design and recorded in the execution receipt.
