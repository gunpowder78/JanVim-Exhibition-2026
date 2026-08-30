# Task 9 Recovery Rehearsal Runbook

This runbook is for the exhibition controller only. The controller owns the show clock. Do not use global keyboard injection, coordinate clicking, product source changes, or network automation.

## Preflight

Precondition -> the frozen artifact, content manifest, external rehearsal directory, and operator are present. Exact command/action -> record the artifact commit, tag, byte size, SHA-256, content hashes, and the intended run ID; confirm no protected incident directory, JanVim worktree, user Neovim configuration, source poem, or source media is a target. Visible result -> the operator has one external rehearsal folder and immutable inputs. Machine evidence -> the preflight record has matching hashes and no attempted input writes. Bounded failure branch -> stop before launch, correct the external rehearsal inputs, and restart preflight; do not repair an input during a run.

## Display Capture and Confirmation

Precondition -> both intended screens are powered on and the checked-in map remains unconfirmed. Exact command/action -> run `start-g2-rehearsal.ps1 Capture` to create a fresh external map, inspect its IDs, FHD geometry, scale, and hashes, then run `start-g2-rehearsal.ps1 Confirm` only for that fresh external map. Visible result -> the external map is confirmed while the checked-in display map remains unconfirmed. Machine evidence -> Capture and Confirm receipts name the external map SHA-256 and the two expected displays. Bounded failure branch -> stop if either display differs; recapture once after correcting cabling/display settings, then escalate to the operator rather than confirming any checked-in map.

## Physical Network Disconnect

Precondition -> preflight and display confirmation passed. Exact command/action -> manually disconnect Wi-Fi and Ethernet before launch; the launcher only observes network state and never changes networking. Visible result -> the operating system shows no external connection. Machine evidence -> every controller network snapshot has `offline: true`, zero external default routes, and zero connected external profiles. Bounded failure branch -> do not launch or continue; reconnect only after the rehearsal is closed, correct the physical disconnect, then repeat this section.

## ValidateOnly

Precondition -> the external display map is confirmed and the physical network is disconnected. Exact command/action -> launch the frozen controller with `--show-mode=validateonly`, the external rehearsal root, its `display-map.json`, a run ID matching that directory, a fresh controller run ID, and `--network-policy=offline-required`. Visible result -> validation exits without opening the show or starting JanVim. Machine evidence -> one strict terminal result records validated frozen inputs, offline sampling, and no show loop. Bounded failure branch -> stop on any nonzero result; correct only the recorded external input mismatch, then repeat ValidateOnly once.

## Soak3

Precondition -> ValidateOnly passed immediately before this launch. Exact command/action -> launch with `--show-mode=soak3` and `--network-policy=offline-required`, then press the on-surface Start control once. Visible result -> exactly three loops reset to the original poem and the controller performs one normal shutdown. Machine evidence -> evidence has three original-poem reset hashes, all offline samples true, one terminal marker, and cumulative visible drift below 250 ms. Bounded failure branch -> stop on the first failed loop or missing reset; preserve evidence and run the frozen G2 short loop instead of adding P1 behavior.

## Show

Precondition -> a current Soak3 result is available and the physical network remains disconnected. Exact command/action -> launch with `--show-mode=show` and `--network-policy=offline-required`. Visible result -> the controller reaches ready with the JanVim primary projector and Web secondary surface prepared. Machine evidence -> token-free lease identity, renderer PID, run/controller IDs, and ready status are in the fixed controller log. Bounded failure branch -> do not Start; use Stop Show, preserve the evidence, and return to ValidateOnly or G2 fallback as indicated by the failure.

## Start

Precondition -> Show is explicitly `ready`; a new invocation after a crash is also `ready` with no checkpoint and no automatic Start. Exact command/action -> press the Web show surface Start control once. Visible result -> one fresh loop begins and the key overlay and editor cues derive from the same controller cue. Machine evidence -> status changes to `running`, a generation/loop ID is logged, and no duplicate write-back appears. Bounded failure branch -> if Start is rejected or duplicated, do not retry by keyboard; choose Restart Loop once or Stop Show.

## Restart Loop

Precondition -> the controller is `safe-ready` after a bounded recovery limit or startup hold. Exact command/action -> press the Web show surface Restart Loop control once. Visible result -> one fresh generation reaches `running` only after original-poem preparation succeeds. Machine evidence -> the recovery record names domain, attempt, delay, new generation ID, and reset hash. Bounded failure branch -> if it returns to `safe-ready`, stop and preserve evidence; do not issue further automatic restarts.

## Stop Show

Precondition -> the controller is ready, running, recovering, or safe-ready. Exact command/action -> press the Web show surface Stop Show button once. Visible result -> the show enters shutdown and then stopped with no new loop. Machine evidence -> one terminal marker, one evidence finalization, zero remaining controller listeners/timers/connections, and the shutdown ladder receipt are logged. Bounded failure branch -> if the surface is unavailable, use the controller's bounded close path; Alt+F4 is only the frozen G2 manual acceptance flow, never a normal Task 9 stop action.

## Secondary Fault

Precondition -> Show is running and the controller log has the exact current secondary renderer PID. Exact command/action -> read that PID from the fixed controller log, then perform the approved deliberate renderer fault against that exact identity. Visible result -> safe-cruise, black replacement, healthy-session original-poem reset, and one fresh loop occur; no old cue is replayed. Machine evidence -> a secondary recovery record includes the generation, 1/2/4-second bounded delay, outcome, renderer PID, and fresh loop ID. Bounded failure branch -> after the fourth failure the controller is safe-ready; Stop Show and use G2 fallback.

## JanVim Fault

Precondition -> Show is running and the token-free lease has the exact JanVim PID, HWND, start identity, and executable hash. Exact command/action -> read that identity from the token-free lease, then perform the approved deliberate fault only against that exact JanVim identity. Visible result -> full generation replacement occurs; a pending editor action cannot produce a later old editor cue. Machine evidence -> recovery evidence records the JanVim domain, exact generation replacement, original-poem reset hash, and bounded retry delay. Bounded failure branch -> after the fourth failure the controller is safe-ready; Stop Show and use G2 fallback.

## Controller Fault

Precondition -> record the current run ID, controller run ID, generation ID, and fixed log location. Exact command/action -> use only the approved forced-restart rehearsal procedure; do not alter configuration, content, or source files. Visible result -> a new controller invocation reaches explicit `ready` with no checkpoint and no automatic Start. Machine evidence -> the new controller run ID is distinct, the new evidence begins at ready, and no recovered loop is claimed. Bounded failure branch -> if ready is not reached, stop, preserve the prior external evidence, and run the frozen G2 short loop.

## Exact Shutdown

Precondition -> Stop Show, SIGINT, window-close, or an approved fault has requested shutdown. Exact command/action -> allow the controller's one bounded ladder: invalidate generation; stop driver; request agent shutdown (2 s, one retry); close the exact placed HWND (2 s, 4096-byte receipt); wait for JanVim (5 s); force only the exact proven PID if needed; wait 5 s; close bridge (5 s); flush, finalize evidence, and write the terminal marker. Visible result -> exactly one cleanup settles, even when Stop, SIGINT, and window-close race. Machine evidence -> shutdown records requested reason, phase failures, child settlement, lease removal, forced termination, and zero retained active counts. Bounded failure branch -> an unsettled child or failed phase is an incident: stop further recovery, retain the lease/evidence, and hand off to the operator.

## Evidence Review

Precondition -> the controller is stopped and its fixed log/evidence files are closed. Exact command/action -> review the terminal marker, strict evidence, fixed log files, reset hashes, offline snapshots, recovery records, resource aggregates, and incident entry. Visible result -> each outcome is classified pass, diagnostic, or failed without claiming physical-projector acceptance from simulation. Machine evidence -> evidence parser accepts the record; it retains at most three loop summaries and bounded recovery/log records, with no raw RSS or ACK arrays. Bounded failure branch -> if evidence is missing, non-strict, or inconsistent, classify the run failed and preserve the external rehearsal folder for follow-up.

## G2 Fallback

Precondition -> Task 9 has failed or its evidence cannot be accepted. Exact command/action -> stop the Task 9 controller and run the preserved frozen G2 short loop using its approved manual acceptance flow. Visible result -> the known G2 short loop completes independently of Task 9. Machine evidence -> G2 receipts and the incident entry identify the fallback run separately. Bounded failure branch -> if G2 also fails, stop all rehearsal activity and escalate; do not add P1 effects, media, or new content on installation day.

## Physical-Projector G4 Deferral

Precondition -> an automated or monitor-simulation rehearsal has finished. Exact command/action -> record `physicalProjectorsTested: false` for monitor simulation and schedule physical acceptance separately. Visible result -> simulation evidence is retained without a G4 pass claim. Machine evidence -> acceptance scope is monitor simulation and the G4 field remains deferred. Bounded failure branch -> do not convert two-monitor evidence into G4; G4 requires three consecutive loops on the two physical projectors, one offline run, and one forced-restart recovery rehearsal.
