# P0.1 frozen content profile implementation receipt

- Receipt date: 2026-09-02 (Asia/Shanghai)
- Branch: `feat/p0-1-content-profiles`
- Worktree: `D:\github\JanVim-Exhibition-2026\.worktrees\p0-1-content`
- P0 base: `7ea7fbea54c7bdb0bb29e915923003b7a221cedb`
- Tested implementation commit: `a018f5c28e69b10e1d89e25d599740deb92aa6bb`
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
- SHA-256: `4be49bb5cbabd9e5bbd43efabf950b3f535e771a795dd1e90609f16f09e03710`
- revision: `20260902-p0.1-r4`

Shared source poem:

- bytes: 64
- SHA-256: `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`
- status: unchanged

Profiles:

| ID | Revision | Paper bytes / SHA-256 | Manifest bytes / SHA-256 |
| --- | --- | --- | --- |
| `p0-baseline` | `20260828-0002` | 191 / `facccc14609bdd129ccdaa70373a57c890092b789be067ef1f5e6431ee650778` | 2,284 / `9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35` |
| `songfeng-source` | `20260902-songfeng-source-r4` | 4,953 / `4b00dd50adc18ab76dc03c9826e0bb2cb4babdb86a5de2efd4ccafa483e4c211` | 21,691 / `f5bad7dfe37f7a884a676e921c5349eed4e6f0d754c5f0d239fb586ccf0ef518` |
| `river-channel` | `20260902-river-channel-r4` | 5,171 / `afc1dccc5e6317ea89bbf08b23215fa03a6926898a7f7a95fba441c010fd2142` | 21,819 / `032d4f13374f68a5e41a1ef7b43319b06b662dcc37767ad974c3ec4e7dfd7b09` |
| `tower-codebook` | `20260902-tower-codebook-r4` | 5,273 / `3ee76e80a7a83d610c1647de7353271e64d2cb410681dcd33db53d7af655d293` | 21,963 / `55a2f574342aacde1f862db762a3dccb7b7ed6de23d96471cdcadf3831bd8a39` |

Each long profile is 90 seconds, has 42 total cues, 15 insert cues, 22 move cues, one final reset
at exactly 90,000 ms, and no insert payload above 512 UTF-8 bytes. Papers contain 52–54 lines and
1,442–1,506 Chinese characters. A completed token stream and a later accepted token stream both
precede the first non-reset editor cue. Every insert's Unicode-character pacing completes within
the immutable JanVim agent's 1,500 ms action cap.

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

The next real rehearsal exposed two additional content-contract gaps without changing the P0
runtime. The r2 insert speeds required 2,304–2,448 ms for the first segments, so the immutable
agent rejected them against its 1,500 ms action cap and the controller recovered JanVim. A new
duration test failed all three profiles before r3 raised the five frozen pacing bands to
120/145/125/190/135 characters per second. The first three r3 segments then passed visually with
no restart.

That r3 rehearsal later ended with `loop-deadline-exceeded`: the accepted P0 controller owns a
fixed 90-second Show clock, while the provisional profile reset was at 165 seconds. After owner
approval, a failing 90-second contract test was added and all 42 cues were compressed without
removing text or actions. r4 resets exactly at 90,000 ms and retains the byte-identical P0
Electron bundle.

Final complete result:

- 47 test files passed
- 795 tests passed
- 0 failures
- duration: 607.21 seconds

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
