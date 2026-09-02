# P0.2 Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a sparse, syntax-coloured P0.2 primary-screen composition without changing the immutable JanVim product artifact or accepted deterministic show topology.

**Architecture:** Keep the orthogonal JanVim runtime and controller unchanged. Exhibition-owned TOML controls physical spacing, exhibition Lua applies the packaged visual API and Markdown buffer options, and reviewed Markdown papers supply semantic highlight groups; all changed bytes are re-frozen through the existing artifact and content locks.

**Tech Stack:** JanVim TOML, Lua/Neovim 0.10.1, PowerShell 7, JSON, TypeScript/Vitest repository tests, Electron 44 verification.

**Spec:** `docs/superpowers/specs/2026-09-02-p0-2-visual-hierarchy-design.md`

## Global Constraints

- Work only in `D:\github\JanVim-Exhibition-2026\.worktrees\task1` on `feat/task1-workflow`.
- Never modify the JanVim product repository, immutable executable/archive/runtime Lua, user Neovim configuration, source poem/media, or protected incident directories.
- Keep `layoutEngine=orthogonal`, `swordsman`, `catppuccin-mocha`, the public launcher, 90-second show clock, bridge protocol, cue topology, and final reset semantics.
- Keep all live behavior offline, deterministic, bounded, and driven by the controller clock.
- Preserve `p0-baseline` paper and manifest byte-for-byte as the rollback path.
- Use LF for every raw-byte-hashed file and stage only task-owned paths.
- Add and observe a deterministic failing test before every production behavior change.
- Do not claim completion without fresh full-gate output and a recorded Electron bundle identity.

---

### Task 1: Specify the visual contract with failing tests

**Files:**
- Modify: `tests/show-runtime-selection.test.ts`
- Modify: `nvim/tests/agent_spec.lua`
- Modify: `tests/content-profiles.test.ts`

**Interfaces:**
- Consumes: current show TOML, real exhibition buffer, real packaged `janvim` Lua module, frozen papers and manifests.
- Produces: executable contracts for approved geometry, runtime visual API state, Markdown buffer state, and sparse markup bounds.

- [x] **Step 1: Add a failing show-config test**

  Parse the real `[layout]` and `[typography]` values and require literals `26.0`, `10.0`, `24.0`, English `sideways`, and the three punctuation/symbol values `upright`, while retaining `orthogonal`, `swordsman`, and `catppuccin-mocha`.

- [x] **Step 2: Run the focused config test and verify RED**

  Run: `& '.\node_modules\.bin\vitest.cmd' run 'tests\show-runtime-selection.test.ts'`

  Expected: FAIL because the existing geometry is `20.0/4.0/24.0` and punctuation is sideways.

- [x] **Step 3: Add failing real Lua behavior tests**

  Extend prepare/reset assertions with:

  ```lua
  equal(vim.api.nvim_get_option_value("filetype", { buf = buffer_number }), "markdown")
  equal(vim.api.nvim_get_option_value("syntax", { buf = buffer_number }), "markdown")
  equal(vim.g.janvim_margin_left, 0.08)
  equal(vim.g.janvim_margin_right, 0.12)
  equal(vim.g.janvim_enable_art_mode, false)
  ```

- [x] **Step 4: Run Lua tests and verify RED**

  Run: `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1`

  Expected: FAIL because current buffers have no Markdown options and setup does not apply the visual API.

- [x] **Step 5: Add failing frozen-content behavior tests**

  For each long profile require one `# ` line, at least three `## ` lines, at least three `> ` lines,
  and at least six independently matched inline-code spans. Retain the existing literal concatenation
  assertion proving the insert actions reconstruct exactly `"\n\n" + paper`.

- [x] **Step 6: Run content tests and verify RED**

  Run: `& '.\node_modules\.bin\vitest.cmd' run 'tests\content-profiles.test.ts'`

  Expected: FAIL because the r5 papers are plain text.

### Task 2: Implement exhibition-owned geometry and Lua visual state

**Files:**
- Modify: `show/janvim-show.toml`
- Create: `nvim/lua/janvim_exhibition/visuals.lua`
- Modify: `nvim/lua/janvim_exhibition/init.lua`
- Modify: `nvim/lua/janvim_exhibition/buffer.lua`
- Modify: `apps/controller/src/show-run-evidence.ts`
- Modify: `apps/controller/tests/show-run-evidence.test.ts`
- Modify: `janvim-artifact.lock.json`
- Modify: `scripts/start-show.ps1`

**Interfaces:**
- Consumes: packaged `require("janvim").setup(opts)` API.
- Produces: `visuals.apply()` returning the applied state or a bounded error; every show buffer exposes Markdown filetype/syntax.

- [x] **Step 1: Apply the minimal TOML geometry**

  Set `column_width=26.0`, `column_gap=10.0`, `glyph_advance=24.0`; keep English sideways and set Latin punctuation, CJK punctuation, and symbols upright. Keep art mode disabled so the selected dark colorscheme owns the background.

- [x] **Step 2: Implement and call `visuals.apply()`**

  Use `pcall(require, "janvim")`, require a callable `setup`, pass only the three approved options,
  validate the returned values, and fail closed before opening the bridge if the packaged API is absent or rejects them.

- [x] **Step 3: Set Markdown options inside the protected buffer creation block**

  Set buffer-local `filetype` and `syntax` to `markdown` before making the prepared buffer current, so reset recreates identical visual state.

- [x] **Step 4: Re-freeze the show-config digest**

  Compute SHA-256 from LF bytes, update `janvim-artifact.lock.json` and `$expectedShowConfigSha256` in `scripts/start-show.ps1`, leaving every immutable artifact identity and `layoutEngine` unchanged.

- [x] **Step 4a: Re-freeze the compiled artifact-lock digest after observing the full-suite RED**

  Normalize the lock to LF, compute its new SHA-256, update the exact identity test first, observe
  the old compiled value fail, then update `TASK9_ARTIFACT_IDENTITY.lockSha256`. This changes the
  Electron bundle identity but not its controller algorithms, protocol, or JanVim artifact bytes.

- [x] **Step 5: Run focused tests and verify GREEN**

  Refresh the ignored prepared agent mirror from `nvim/lua/janvim_exhibition`, then run the config
  test, Lua tests, `pwsh -NoProfile -File .\scripts\verify-runtime.ps1`, and `git diff --check`;
  all must exit 0. The mirror refresh is generated runtime state and does not add tracked product
  source or change immutable JanVim bytes.

### Task 3: Re-freeze sparse Markdown papers and matching choreography

**Files:**
- Modify: `content/p0.1/profiles/songfeng-source/paper.md`
- Modify: `content/p0.1/profiles/songfeng-source/show.manifest.json`
- Modify: `content/p0.1/profiles/river-channel/paper.md`
- Modify: `content/p0.1/profiles/river-channel/show.manifest.json`
- Modify: `content/p0.1/profiles/tower-codebook/paper.md`
- Modify: `content/p0.1/profiles/tower-codebook/show.manifest.json`
- Modify: `content/p0.1/content-lock.json`
- Modify: `scripts/select-show-profile.ps1`
- Modify: `scripts/start-show.ps1`

**Interfaces:**
- Consumes: the unchanged 42-cue r5 choreography and content-lock schema.
- Produces: three r6 profiles whose insert texts reconstruct their reviewed Markdown papers exactly.

- [x] **Step 1: Add sparse markup without deleting approved prose**

  Prefix selected existing lines with one level-one heading, three or more level-two headings, and
  three or more blockquotes; wrap information-theory terms/formula names in six or more inline-code
  spans. Keep 48–64 lines and all existing Chinese prose.

- [x] **Step 2: Regenerate only insert payload text**

  Partition each paper across the existing 15 insert cues so every UTF-8 payload remains at most
  512 bytes and every Unicode pacing duration remains at most 1,500 ms. Do not change cue IDs,
  times, moves, secondary cues, loop duration, or final reset.

- [x] **Step 3: Bump and lock exact identities**

  Bump long-profile revisions to `20260902-<id>-r6`, bump the lock to `20260902-p0.1-r6`, and update
  exact paper/manifest bytes and hashes. Update only the two PowerShell revision literals and the
  launcher's expected content-lock digest.

- [x] **Step 4: Run focused content, selector, and launcher tests**

  Run: `& '.\node_modules\.bin\vitest.cmd' run 'tests\content-profiles.test.ts' 'tests\select-show-profile.test.ts' 'tests\start-show.test.ts'`

  Expected: PASS with no altered active manifest after failure fixtures.

### Task 4: Full verification and visual handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-09-02-p0-2-visual-hierarchy.md`
- Create: `docs/operations/p0-2-visual-hierarchy-implementation-receipt.md`

**Interfaces:**
- Consumes: Tasks 1–3 and the existing public rehearsal runbook.
- Produces: automated gate evidence and exact two-monitor visual inspection instructions.

- [x] **Step 1: Run all required gates fresh**

  Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, Lua tests,
  `verify-runtime.ps1`, and `git diff --check`; record exit codes and test totals.

- [x] **Step 2: Record bundle and boundary evidence**

  Record main Electron bundle bytes/SHA-256, JanVim core SHA-256, changed paths, clean source-poem
  hash, unchanged product/runtime Lua hash, and unchanged `orthogonal` identity.

- [x] **Step 2a: Re-pin the reviewed launcher bundle identity after observing RED**

  Rebuild first, record the new 451,940-byte bundle SHA-256, update the independent smoke-test
  literal and observe the launcher keep returning the old digest, then update only
  `$reviewedElectronMainSha256` in `scripts/start-show.ps1`.

- [x] **Step 3: Restore rollback profile**

  Run the real selector for `p0-baseline` and verify the active manifest is byte-identical to the
  locked rollback member.

- [x] **Step 4: Write the implementation receipt**

  Include exact profile-selection and show-launch commands plus a visual checklist: negative space,
  semantic colours, upright punctuation, long movement, no restart, and exact reset.

- [x] **Step 5: Stop at human visual acceptance**

  The owner confirmed the deep background, compact CJK advance, wide columns, continuous swordsman,
  and exact reset, then requested a bounded punctuation/paragraph/gap refinement. Projector
  acceptance remains unclaimed.

### Task 5: Compact punctuation and natural paragraph refinement

**Files:**
- Create: `nvim/lua/janvim_exhibition/typography.lua`
- Modify: `nvim/lua/janvim_exhibition/buffer.lua`
- Modify: `nvim/tests/agent_spec.lua`
- Modify: `show/janvim-show.toml`
- Modify: `tests/show-runtime-selection.test.ts`
- Modify: `content/p0.1/profiles/*/paper.md`
- Modify: `content/p0.1/profiles/*/show.manifest.json`
- Modify: `content/p0.1/content-lock.json`
- Modify: `tests/content-profiles.test.ts`
- Modify: frozen identity consumers and implementation receipt

- [x] **Step 1: Observe three independent behavior REDs**

  Require the real TOML gap to equal its column width, require real Neovim conceal replacements
  while the underlying buffer remains standard punctuation before and after reset, and require
  18–30 physical lines whose prose paragraphs contain two to five sentences. The focused tests
  failed on gap 10 versus 26, `conceallevel=0`, and 52–54 sentence-per-line papers.

- [x] **Step 2: Implement display-only compact punctuation**

  Install the fixed seven-character mapping `，。；：？！、` to `﹐﹒﹔﹕﹖﹗﹑` after Markdown
  syntax on every prepared buffer. Use `conceallevel=2` and `concealcursor=nvic`; never mutate
  source, action, acknowledgement, hash, or reset bytes.

- [x] **Step 3: Reflow and re-freeze three reviewed papers**

  Preserve all approved prose in order, retain standalone headings/blockquotes, and combine prose
  into two-to-four-sentence paragraphs with two-em indentation. Repartition the exact paper text
  over the existing 15 inserts, retain all 42 cues and 90-second reset, bump profiles/content lock
  from r6 to r7, and update selector/launcher pins.

- [x] **Step 4: Apply equal-width negative space and re-freeze runtime identities**

  Set `column_gap=26.0` while keeping `column_width=26.0` and `glyph_advance=24.0`. Observe the
  config-lock and compiled-lock identity tests fail before updating their consumers, rebuild, then
  observe the independent Electron release test fail before updating the launcher bundle digest.

- [x] **Step 5: Run fresh full gates and update the receipt**

  Run all npm, Lua, runtime, line-ending, and diff gates; record exact test totals and SHA-256
  identities. Restore the byte-exact `p0-baseline` active manifest after script tests.

- [x] **Step 6: Stop for final two-monitor visual recheck**

  Ask the owner to confirm visibly smaller punctuation, natural multi-sentence paragraphs, one
  blank-column-width gap, retained dark/Catppuccin hierarchy and swordsman continuity, no restart,
  and exact reset. The owner confirmed all items over five r7 loops; Show exited 0 by operator stop.
  Physical-projector acceptance remains explicitly unclaimed.
