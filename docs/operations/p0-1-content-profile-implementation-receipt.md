# P0.1 frozen content profile implementation receipt

- Receipt date: 2026-09-02 (Asia/Shanghai)
- Branch: `feat/p0-1-content-profiles`
- Worktree: `D:\github\JanVim-Exhibition-2026\.worktrees\p0-1-content`
- P0 base: `7ea7fbea54c7bdb0bb29e915923003b7a221cedb`
- Tested implementation commit: `20262e61c7ad4850e33861bc7e0b56387dd635e3`
- Automated outcome: pass
- Remaining acceptance: owner dual-monitor visual inspection
- Physical-projector claim: not made

## Delivered behavior

P0.1 adds three long-form deterministic exhibition profiles and one byte-exact P0 rollback
profile. All generated prose is reviewed and frozen before runtime. The live loop remains offline,
deterministic, and controlled by the existing Electron show clock.

The profile selector accepts one exact allowlisted ID, validates the pinned lock and selected
members, enforces the manifest action/reset bounds, and atomically stages the selected manifest at
the controller's existing active path. Repeating the same selection is idempotent.

The public show launcher independently interprets the same byte-pinned lock. It rejects an
unknown or ambiguous active manifest and freezes the lock, selected paper, selected source
manifest, active manifest, and source poem before Electron starts.

No TypeScript, Lua, Electron runtime, JanVim product source, immutable JanVim artifact, source
poem, source media, user Neovim configuration, or protected incident directory was changed.
The current `catppuccin-mocha`, `swordsman`, and orthogonal configuration is unchanged.

## Frozen identities

Content lock:

- path: `content/p0.1/content-lock.json`
- bytes: 2,332
- SHA-256: `10ed862d810ca9ce8bbf864974e6795de2dbfb47784829ebbad84879c15efb44`
- revision: `20260902-p0.1-r2`

Shared source poem:

- bytes: 64
- SHA-256: `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`
- status: unchanged

Profiles:

| ID | Revision | Paper bytes / SHA-256 | Manifest bytes / SHA-256 |
| --- | --- | --- | --- |
| `p0-baseline` | `20260828-0002` | 191 / `facccc14609bdd129ccdaa70373a57c890092b789be067ef1f5e6431ee650778` | 2,284 / `9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35` |
| `songfeng-source` | `20260902-songfeng-source-r2` | 4,953 / `4b00dd50adc18ab76dc03c9826e0bb2cb4babdb86a5de2efd4ccafa483e4c211` | 21,686 / `172107855992e69e04bdb9a9593ad7303039998fa1a3f10d4450cd2bb8dd620a` |
| `river-channel` | `20260902-river-channel-r2` | 5,171 / `afc1dccc5e6317ea89bbf08b23215fa03a6926898a7f7a95fba441c010fd2142` | 21,814 / `092fadd5ba685a15760914666db94511142b4d32dbd73bc4600d8f223b9eb707` |
| `tower-codebook` | `20260902-tower-codebook-r2` | 5,273 / `3ee76e80a7a83d610c1647de7353271e64d2cb410681dcd33db53d7af655d293` | 21,958 / `aa75dc8b317514692b8753aff2f6db0516d8c0fcc4a68f450d005f0ddb5067a3` |

Each long profile is 165 seconds, has 42 total cues, 15 insert cues, 22 move cues, one final reset
at exactly 165,000 ms, and no insert payload above 512 UTF-8 bytes. Papers contain 52–54 lines and
1,442–1,506 Chinese characters. A completed token stream and a later accepted token stream both
precede the first non-reset editor cue.

## Test-driven evidence

The first focused run produced 13 expected failures because the lock/assets and selector were
absent, the launcher still pinned one manifest, and LF policy was missing. Production changes
were made only after those failures were observed.

The first real long-profile rehearsal then exposed a missing runtime causality constraint: the
profile completed its secondary response but did not emit acceptance before the first editor
move. The deterministic loop correctly entered `loop-runtime-safe-black`. A regression test was
added first and failed for all three long profiles; one bounded accepted cue was then added to
each profile and all frozen identities were bumped to r2.

Final focused result after the r2 correction:

- content and selector: 2 test files, 12 tests passed
- launcher content-lock subset: 11 tests passed; 111 unrelated launcher tests skipped

Final complete result:

- 47 test files passed
- 795 tests passed
- 0 failures
- duration: 609.82 seconds

Additional gates all returned exit code 0:

- `npm ci` (183 packages; 0 vulnerabilities)
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1`
- `pwsh -NoProfile -File .\scripts\verify-runtime.ps1`
- `git diff --check`

Runtime verification retained JanVim artifact commit
`e95633101d93f8448b0f906e918b5d836ab95273`, core SHA-256
`224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3`, and orthogonal layout.

## Electron bundle proof

- path: `apps/controller/dist/main/electron-main.js`
- bytes: 451,940
- SHA-256: `aad1d8ab03a7bd7bff4d02530da24f832ed7a822cd4739f0c7f7f66a167c4727`
- comparison with accepted P0: exact match

This proves that P0.1 did not alter the compiled Electron main bundle.

## Review evidence

The complete changed-path list was compared with the P0 base. No compiled TypeScript, package
source, Lua, theme configuration, or artifact-lock file appears in the diff. Both PowerShell
entry points pass the PowerShell parser. No TODO, TBD, FIXME, or placeholder remains in the
delivered content or selector.

An independent review subagent was unavailable in the current execution environment. The same
review scope was performed directly against the base-to-HEAD diff, with automated boundary and
placeholder checks plus the full test evidence above.

## Visual inspection handoff

The active manifest was restored to `p0-baseline` after exercising all four real selector paths.
Its active SHA-256 is again
`9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35`.

From the P0.1 worktree, select one theme with exactly one of these commands:

- `pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile songfeng-source`
- `pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile river-channel`
- `pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile tower-codebook`
- rollback: `pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile p0-baseline`

The next step is a fresh dual-monitor Show rehearsal for each long profile. The owner should
inspect visible text density, horizontal travel, vertical jumps, `swordsman` trajectory, secondary
cue correspondence, exact final reset, and absence of stale generated text after the next loop.
