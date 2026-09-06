# Site Sound Mix v2 Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, statically verify, pin, and isolate one local Site Mix v2 audition candidate pair without starting GUI, camera, or audible sound.

**Architecture:** JanVim remains runnable from its dedicated worktree and keeps its fail-closed Electron bundle identity gate. JianShan is built from the approved dirty feature workspace, then only the new EXE is combined with byte-verified dependencies from the prior isolated candidate in a fresh external root; every copied file is inventoried. Human hardware acceptance begins only after both candidate identities pass.

**Tech Stack:** PowerShell 7, Node.js 22.23.0, npm/Vite/TypeScript, Rust/Cargo 1.97.1 MSVC, SHA-256, existing Electron module-graph verifier

**Spec:** `D:\github\JianShan02\docs\superpowers\specs\2026-09-06-site-sound-mix-design.md`

## Global Constraints

- Do not fetch, commit, push, merge, tag, or run the full test suite.
- Do not start JanVim, JianShan, Electron, a camera, SuperCollider hardware output, or audible sound.
- Preserve `content/fixture/show.manifest.json`, `sound/real-input.mjs`, and `sound/tests/real-input.check.mjs` exactly as found.
- Do not change the JianShan safe template, original TOML, HP fallback, frozen v1 document, system volume, display ownership, or show scheduling.
- Never read or output a session descriptor JSON/token, and never reuse an old descriptor.
- Keep the previous v1 candidate and reviewed Electron bundle recoverable; refuse any pre-existing new candidate root.
- A build from an uncommitted worktree is a local audition candidate, not a release or immutable source artifact.
- Updating the Electron identity is allowed only after the static verifier explains the new exact bytes, hash, and unchanged allow-listed runtime imports.
- Physical acceptance remains explicitly pending after this plan.

---

### Task 1: Freeze pre-build evidence and protected inputs

**Files:**
- Create: external `site-mix-v2-candidate-<UTC>-<random>/evidence/pre-build.json`
- Read only: both Git workspaces, current Electron bundle, previous JianShan candidate

**Interfaces:**
- Consumes: exact branch/HEAD/upstream and dirty worktree state from the synchronization report.
- Produces: one unique candidate root and hashes that make later build changes attributable.

- [x] **Step 1: Create one fresh candidate root**

Resolve `D:\VirtualData\JanVim-Exhibition-Rehearsals`, generate an ID with UTC timestamp plus 12 lowercase hexadecimal characters, and create exactly one absent child named `site-mix-v2-candidate-$id`. Refuse a reparse parent or pre-existing target.

- [x] **Step 2: Record bounded source evidence**

Record both repositories' root, branch, HEAD, upstream, porcelain status, tracked diff SHA-256, untracked-file list, Node/Rust/Cargo versions, and current time. Record hashes of the three protected JanVim files. Do not record environment variables, command lines, file bodies, descriptors, or tokens.

- [x] **Step 3: Preserve the old bundle for comparison**

Verify the current Electron main is exactly 540,860 bytes with SHA-256 `2a166eff47428efe3759b07c26cddcc92b615a4b1bf61d440e6674d8baa97f70`, then copy that one file into the fresh evidence directory and independently rehash the copy.

### Task 2: Build and review the JanVim v2 bundle

**Files:**
- Generated: `apps/controller/dist/main/electron-main.js` and other ignored build outputs
- Modify after review: `scripts/start-show.ps1`
- Modify after review: `tests/electron-build-smoke.test.ts`
- Create: external `evidence/janvim-module-graph-v2.json`

**Interfaces:**
- Consumes: current Site Mix v2 TypeScript source and the preserved old bundle.
- Produces: one statically verified Electron bundle identity accepted by the unchanged fail-closed launcher logic.

- [x] **Step 1: Run the bounded production build**

Run `npm run build` from the JanVim worktree. This performs TypeScript/Vite compilation and the static Electron module verifier but does not start Electron.

- [x] **Step 2: Independently verify the emitted main bundle**

Run `node scripts/verify-electron-module-graph.mjs`, parse its single JSON line, require schema `2`, status `compiled-electron-main-bundle-verified`, exactly one canonical file no larger than 16 MiB, and the sorted runtime-import list already allowed by `scripts/start-show.ps1`. Save only that public identity manifest.

- [x] **Step 3: Review the old/new bundle boundary**

Require the new hash to differ from the preserved v1 hash, require no relative chunk/import file beside `electron-main.js`, and confirm the runtime imports did not expand. Search the emitted bundle for the expected Site Mix request/status vocabulary and ensure the old preserved bundle lacks that vocabulary.

- [x] **Step 4: Pin only the reviewed identity**

Using `apply_patch`, change only `$reviewedElectronMainBytes` and `$reviewedElectronMainSha256` in `scripts/start-show.ps1`, and the four mirrored numeric/hash literals in the `pins launcher release constants` assertion in `tests/electron-build-smoke.test.ts`. Leave identity markers, path, import list, allow-list, and launcher behavior unchanged.

- [x] **Step 5: Run focused identity gates**

Run `npx vitest run tests/electron-build-smoke.test.ts` and `npm run typecheck`. Re-run the module verifier and require byte-for-byte equality with the saved v2 manifest. Do not run all Vitest tests.

### Task 3: Build and isolate the JianShan v2 candidate

**Files:**
- Generated: `D:\github\JianShan02\jianshan-rust\target\release\jianshan.exe`
- Create: external `runtime/` allow-listed candidate layout
- Create: external `evidence/jianshan-inventory-v2.json`
- Create: external `README.txt`, `build-info.txt`, and `SHA256SUMS`

**Interfaces:**
- Consumes: current Rust source plus byte-verified model, native DLL, VC runtime DLL, ranking data, original TOML, and safe template from the old candidate.
- Produces: one unique local audition runtime with no historical liveConfig.

- [x] **Step 1: Build the Rust release executable**

Run `cargo build --locked --release` from `D:\github\JianShan02\jianshan-rust`. Do not run the executable.

- [x] **Step 2: Verify the new executable identity**

Require an ordinary, non-reparse `target/release/jianshan.exe`, size greater than zero and no more than 256 MiB. Record size and SHA-256, require the hash to differ from the old v1 EXE hash `d9cae3bcd850fc55d180c5d1bc9ab16fc4fc91b39dfd5c771a9caad96c030417`, and require the three targeted Rust test gates from the prior implementation record to remain the source-level evidence.

- [x] **Step 3: Copy only the reviewed runtime allow-list**

From the old candidate copy `public/models/hand_landmarker.task`, GPU ranking TOML, four VC runtime DLLs, two native MediaPipe/OpenCV DLLs, `jianshan.toml`, `jianshan-flock-v1.toml`, and the two inert launcher/readme files only when their contents remain valid. Install the newly built EXE instead of copying the old one. Do not copy any `jianshan-flock-live-*.toml`, descriptor, log, lease, runRoot, token, old build-info, old hash manifest, or provenance file.

- [x] **Step 4: Verify immutable dependency hashes**

Require every copied dependency and both TOML files to match its source byte count and SHA-256. Require the safe template hash to remain `510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae` and original `jianshan.toml` hash to remain `9b83e9d471cfbde76224b8c565ccd9fd4427c143c65201d36312f966bb9e56cf`.

- [x] **Step 5: Write candidate provenance without secrets**

Write a concise README, build-info, sorted SHA256SUMS, and JSON inventory containing candidate label, dirty-source warning, branch/HEAD, toolchain, source-diff hash, file paths, sizes, and hashes. Do not include source file bodies, environment variables, descriptors, tokens, or claims of camera/GPU/audio acceptance.

### Task 4: Final non-GUI candidate gates and handoff boundary

**Files:**
- Update: `docs/operations/2026-09-06-site-sound-mix-v2-agent-sync.md`
- Update: this plan's checkboxes and evidence section
- Create: external `candidate-receipt.json`

**Interfaces:**
- Consumes: reviewed JanVim identity, isolated JianShan inventory, and protected-input hashes.
- Produces: exact paths and hashes for the next attended 30-minute session without starting it.

- [x] **Step 1: Recheck protected state**

Require the three protected JanVim hashes to equal Task 1, the old v1 candidate hashes to remain unchanged, and no relevant GUI/audio process or fixed sound port to be active. Confirm the site mix file still does not exist unless the operator created it outside this plan.

- [x] **Step 2: Run final static checks**

Run `git diff --check` in both repositories, the focused Electron identity test, module verifier, and read-only hashes of all new candidate files. Do not run applications or the full suite.

- [x] **Step 3: Emit a bounded receipt**

Write `candidate-receipt.json` with both source states, both exact executable identities, module imports, immutable dependency identities, verification commands/results, protected-file hashes, and the literal acceptance state `awaiting-attended-hardware-rehearsal`. Exclude secrets and private descriptor paths.

- [x] **Step 4: Stop before physical operation**

Report the new candidate root and the updated JanVim bundle identity. Give no claim that display, camera, GPU, or sound passed. The next action is for the operator to create a brand-new 30-minute session and a unique liveConfig from the unchanged safe template.

## Evidence Record

Execution is inline because the operator already directed the current agent to continue. No subagent, commit, push, merge, GUI, camera, or audible output is part of this plan.

- Candidate root:
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\site-mix-v2-candidate-20260906T121435884Z-e8fec2f0139c`
- Receipt: `candidate-receipt.json`, 5,511 bytes, SHA-256
  `b53925491ed9a611038c755dd9cc6880130c1168cbce0f44416888387f545d57`.
- JanVim main: 547,650 bytes, SHA-256
  `bb63c48dcf63756392e730224b2cbe929b00feafa1c2738ea608f5b9764f4b90`;
  runtime imports unchanged; focused Electron tests `24/24`; typecheck passed.
- JianShan EXE: 9,799,168 bytes, SHA-256
  `ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f`;
  11/11 runtime files rehashed and zero historical liveConfig copied.
- Both `git diff --check` commands passed with line-ending warnings only. The three protected JanVim
  files and the previous v1 candidate retained their pre-build hashes. Relevant processes and fixed ports
  were zero; the site mix profile was absent.
- Final state remains `awaiting-attended-hardware-rehearsal`; no physical or audible claim was made.
