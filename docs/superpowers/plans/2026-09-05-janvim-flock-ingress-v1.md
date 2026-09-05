# JanVim Flock Ingress v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receive the frozen JianShan TCP producer stream and drive independently expiring wind alongside actual cursor plucks without changing the visual fallback.

**Architecture:** Reuse the existing loopback listener and sole OSC sender. A pure bounded flock policy retains the original deadline, a role-scoped transport authenticates separately, and SC releases only the wind node when its target becomes invalid.

**Tech Stack:** Node22.23.0 ESM/builtins, PowerShell7, existing SuperCollider3.14.1. No dependencies or product/controller rebuild changes.

**Spec:** `docs/superpowers/specs/2026-09-05-janvim-flock-ingress-v1-design.md` and `docs/operations/2026-09-05-jianshan-sound-ingress-confirmation-v1.md` (frozen producer protocol).

## Global Constraints

- Work only in `.worktrees/sound-flock-ingress-v1`, branch `feat/sound-flock-ingress-v1`, base `93ce7b6f9667c1f32e4faada1d5f45130cbe224c`.
- No JanVim product, controller/Lua, artifact lock, poem/content/profile/display/device changes; no Listen, push, merge, release or HP changes.
- New ingress defaults OFF; only explicit `-Input RealCursor -FlockIngress` / `--input real-cursor --flock-input enabled` enables it. Existing four-argument SC mode and legacy simulated/real-cursor behavior remain.
- Private descriptor fields: version1, active:boolean, host127.0.0.1, port int1..65535, protocol `jianshan-flock-ndjson-v1`, independent64lowerhex token. sourceId32lowerhex. Do not log secrets.
- attach success `{version:1,ok:true,input:"jianshan-flock-ndjson-v1"}`; reject `{version:1,ok:false,reason:"rejected"}` then close. One bird owner lifetime separate Show owner;8connections total;1000ms absolute attach deadline.
- Strict UTF8/flat JSON/duplicate rejection; data1024bytes, ACK256bytes excludingCR/LF; cap bytes+onependingCR;64frames/64KiB per callback, one latest state, max20Hz sample publication, no replay queue.
- Original deadline `R+sampledAtMs+500`, validage[0,500), expire at>=500; seq/epoch positiveint32, epoch starts1, time0..3600000, no regression/rewind. Freshness/Stop/epoch must survive every queue and final sender/SC. No data may renew Show2slease; global1.5sfade stays terminal.
- empty/unavailable/expiry/disconnect only wind-mute; SC wind gate uses existing0.3srelease, max2live/releasingwindnodes. No fake zero-energy mute.
- T1/T2 independent files may run in parallel. T3 begins after T1 API settles; T4 integrated final evidence. One controller serializes Git commits/reviews. Workers never spawn subagents or modify unrelated working changes. Full heavy gates are serial, not duplicated per edit.

### Task 1: Strict framing and pure original-deadline policy

**Files:** Create `sound/flock-input.mjs`, `sound/flock-protocol.mjs`, `sound/tests/flock-input.check.mjs`.

**Interfaces:** `parseFlockAttach(bytes, token)` returns `{sourceId}` or null; `parseFlockFrame(bytes)` returns strict data or null. `createFlockFramer({onFrame,onReject})` returns `{push(Buffer):boolean}`; no secret logs. `createFlockInput({nowMs,onDisable})` returns `attach(sourceId):boolean`, `accept(frame):boolean`, `take({showAuthorized}):event|null`, `snapshot()`, `close(reason)`.

Events: live `{kind:"flock-live",epoch,revision,energy,centroid,expiresAtMs}`; mute `{kind:"flock-mute",epoch,revision}`. Revision is a local monotonic positiveint32, separate producer seq; overflow disables. Snapshot `{epoch,revision,closed,expiresAtMs}` (null expiry if no live target). No token crosses this boundary. `createFlockAdmission({nowMs})` returns `{update(snapshot), accept(event):boolean}`; newer watermark invalidates older queued state, independently20Hz plusoriginalexpiry, mute immediate. First epoch must1; close blocks replacement, emits a fresh mute watermark to invalidate pending work; no globalStop callback.

- [ ] RED tests actual state machine before implementation. Example uses real public methods, not constant arithmetic:

```js
let now = 1000;
const input = createFlockInput({ nowMs: () => now, onDisable: () => {} });
assert.equal(input.attach('a'.repeat(32)), true);
now = 1590;
assert.equal(input.accept({version:1,command:'flock',sourceId:'a'.repeat(32),seq:1,epoch:1,sampledAtMs:100,state:'sample',energy:0.7,centroidX:0.2}), true);
const first = input.take({showAuthorized:true});
assert.equal(first.expiresAtMs,1600);
now = 1600;
assert.equal(input.take({showAuthorized:true}).kind,'flock-mute');
```

Repeat with no take until1600: no live publication. Feed first into actual admission at1599/1600 and assert true/false; a new admission per independent case avoids rate interference. Test actual no-new-packet expiry after consumption, pending coalescing, stale/NaN/future/regression/epoch/member reset, idleShow/drop/Stop,500ms boundaries, seq overflow, onehour,20Hz, and mutedstate no phantom heartbeat.
- [ ] Framing RED: CRLFcap+1 split, cap+2, invalidUTF8, escaped duplicate keys, missing/extrafields, samplevsnon-samplefieldsets,64/65frames and65536/65537bytes, attach token wrong/length/case. Framer rejection must stop bounded parsing, not silently drain.
- [ ] Implement only these two bounded modules. No sockets/timers/processes in pure policy; the transport supplies now and close. On frame acceptance store original expiry, and retain consumed target for tick-driven expiry. Invalid packets cannot mutate newer valid state.20consecutive structurally valid expired frames call onDisable once; a valid frame clears count.
- [ ] GREEN command: `node --test --test-concurrency=1 sound/tests/flock-input.check.mjs sound/tests/real-input.check.mjs sound/tests/osc.check.mjs`. Record fullRED/GREEN and self-review. Commit only task files after parent authorizes serial commit.

### Task 2: SC independently expiring wind and additive OSC paths

**Files:** Modify `sound/osc.mjs`, `sound/policy.scd`, `sound/service.scd`, `sound/tests/osc.check.mjs`, `sound/tests/policy.scd`; create `sound/tests/flock-service.check.mjs` if needed for bounded silent service check. Do not edit synths.scd or run.mjs.

**Interfaces:** policy factory thirdoptionalflag `flockIngress=false`. service optional fifthargument exactly `flock-v1` enables it; old4args remain. Only explicit mode installs newpaths. live OSC common(session:s,seq:i,sentAt:d)+epoch:i,revision:i,energy:f,centroid:f,expiresAt:d (msgsize9). mute common+epoch:i,revision:i (msgsize6). policy returns `wind` with existingenergy/pan onlive, `windMute` onexplicitmute/deadline; neither renewsheartbeat.

- [ ] RED add oldmode rejection/newmode acceptance and fakeclock expiry tests to real policy tests. Example:

```supercollider
p = factory.value(session, nil, true);
p.at(\handle).value(["/janvim/sound/v1/start",session,1,10.0],10.0);
action = p.at(\handle).value(["/janvim/sound/v1/flock-live",session,2,10.49,1,1,0.7,0.2,10.5],10.49);
assertEqual.value(action.at(\type),\wind,"fresh remaining10ms");
action = p.at(\tick).value(10.5);
assertEqual.value(action.at(\type),\windMute,"expire without new packet");
assertNil.value(p.at(\tick).value(10.51),"mute once");
```

Add exactdeadline rejection before mutation, invalidfields/globalStoppriority, staleepoch/revision, lateUDPordering, noleaseextension, oldflock compatibility, and newepoch/mute handling faster than50ms. Encoder tests hand-derivedtags/wire roundtrip fornewpaths, oldallowlist remains.
- [ ] Implement newpaths/policy expiry without changing old path semantics. Validate now<expiry<=sentAt+.5 plus original global window, reject unsupportedmode. Existing tick first handles global2sstop; then wind expiry. WholeStop stays highestpriority.
- [ ] Service `windMute` sets activegate0 and unsets active reference, existingrelease remains. Track atmost2active/releasingwindnodes; onFree compares nodeidentity, removes exactly owned node; repeatedflaps cannot grow nodes or silence a replacement by oldcallback. Cleanup frees owned windnodes. No autoaudio Listen;4argoldmode unchanged.
- [ ] GREEN `pwsh -NoProfile -File sound/tests/run-policy.ps1` and `node --test sound/tests/osc.check.mjs`; bounded silent service proof when needed, no simultaneousSCtests. Parent/Task4 runs full service integration later.

### Task 3: Existing listener and unique sender integration

**Files:** Modify `sound/run.mjs`, `sound/start-sound.ps1`, `sound/real-input.mjs`, `sound/tests/supervisor.check.mjs`, `sound/tests/real-input.check.mjs`; create `sound/tests/flock-transport.check.mjs`. Test fixture-copy lists may include new modules in existing `sound/tests/startup-lifetime.check.mjs` and `real-cursor-chain.check.mjs`, but no relaxed ownership/limits.

**Interfaces:** startControlServer existingoptions extend with optional `flockInput`; returnedreceipt stays oldcontrolshape and optional `flockReceipt` is exactnewdescriptor. createRealInput adds read-only `isShowAuthorized()` based on realowner/non-idlevalidHB/notStop (pre-attach service healthbeats notauthorization). Publish constantsizedflocksnapshot/event alongside existing clockreply. Sender uses Task1admission, Task2OSC shapes; session computed explicitly before appending SC fifthargument (do not retain fragile args.at(-4) afterward).

- [ ] RED actualTCP listener tests: defaultmode no descriptor/owner; explicitindependenttoken attaches, correctACK, secondownerrejected whilefirst andShowcontinue; birdtoken cannotStop/HB/cursor; 1sabsoluteattach deadline even byte-dribble; malformedbirdonly closesbird,notShow. Use disposable externalrunroots and bounded listener cleanup.
- [ ] Add `-FlockIngress` and exact `--flock-input enabled`; reject incompatibleSimulated andbadduplicateflag. Independentsecuretoken, mode600 newdescriptor, atomicinitialcreation, boundedterminationactivefalse; descriptor failure disables optionalbird withredacteddiagnostic. Do not add a new listener or service. Existingdefaultcontrolreceipt remains byte/schema compatible.
- [ ] Role demultiplex once then no token on birddata; ACK queued onlyafterRcaptured. Use Task1framer andpurepolicy. Preserve8connections, attachdeadlineabsolute timers clearedclose. Invalidbird doesnotcallrealInput.close/onStop. On realShow/globalStop closebird andlatchsender; no late callback rearms. Clear descriptoractivewithout perframe disk I/O.
- [ ] Clockreply takes realinput first (so existinglease applies), computesactualShowauthorization, updatesbirdpolicy, returns atmost1birdstate pluswatermark. Sender update watermark beforeeventadmission, now>=expiry reject, expiry translated with existingreceiverAnchor/clock.sampledAtMs. Mutation test removeoriginaldeadline / replacewithnow+500 mustfail. Serialized IPC hasone request/responseinflight; no newperframe queue. Old emitted bytescan'trevoke; newerwatermark prevents local replay and SCepoch/revision prevents laterolderrestore.
- [ ] GREEN focusedtransport/unit tests, then real silentproduction sender overlocalUDP orSC: at490ms remainingdeadline, waituntil500 beforeadmit meansnoUDP live; no-new-data expiresinactualSC; bird neverkeepsShowalive. Record source evidence notstub-only. No newcomposer/fakebirddefault.

### Task 4: Integrated verification and two-team handoff

**Files:** Create `sound/tests/flock-chain.check.mjs`, `docs/operations/2026-09-05-flock-ingress-v1-handoff.md`; update `sound/README.md`. Localoperator/evidence under `.operator/` and fresh externalrehearsalroot, no tokenreports.

- [ ] RED first missing-link productionchain test withactualsupervisor/listener/sender/SC silentcapture. Show producer fixture clearly labeledsynthetic; existingreal-cursorchain test separately provesrealLua unchanged. Injectfreshflockstates thenempty/unavailable/stale/close; cursor continues;Stopbothsilent/lateframescannotrearm. Assert recordedPCM windows andpolicy counters, no humanhearing claims.
- [ ] Final completegates serially: `npm ci`; restore existing Electron install if needed; `npm run typecheck`; `npm test`; `npm run build`; `npm run lint`; `pwsh -NoProfile -File scripts/run-lua-tests.ps1`; `pwsh -NoProfile -File scripts/verify-runtime.ps1`; `node --test --test-concurrency=1 sound/tests/*.check.mjs`; `git diff --check`. Expand testglob to filelist if shell requires. Do not run full application and SC suite concurrently. Missing staged runtime prepared via existing packaging public script or verified copy preserving immutable inputs, not changing locks.
- [ ] Compare candidateElectron SHA256 `2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70` and JanVimartifactlock `9cb5f25c91d8fd7186465de0f90e6ddde8b4a54fadee431d907992a797e54a7c`; ifunexpectedbundlechange investigate, notblindrepin. Record actualsource/bundle/runtime hashes and everyfailedpass, maxwindnodes andboundedresources. Baselinesound/rootvisualrefsunchanged.
- [ ] Handoff explicitprivate `flock-input.json` location fromREADY, candidatecommit/startflags/Stopsemantics/threefreshnesstests; donotpublishtoken. JianShanGPUrealfeatures/HPperformance andhumanjointhearingremainseparate. Operator manuallydisablesduplicatewind/builtinaudio; no autogeneratedcredentialsinsharedmemo. Keepcandidatebranchlocal untilpushapproval.

## Preflight and approval record

User explicitly requests synchronous candidate coding onbothsides and restoredfullpermissions. Newworktreecreatedfrom93ce7b6; originalcandidateclean. Pre-change18/18osc+realinputtests pass. Design/planself-review: no producerwirechanges, allfrozensectionsmapped (authentication/framingT1/T3; originaldeadline/seq/epochT1/T3/T2; GPU/sampling remainsJianShan; StopT2/T3;actualproofT4). Defaultsandhardwarelimits preserved. Fullsuite stillto run; no claimofimplementation yet.
