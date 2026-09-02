# P0.2 visual hierarchy implementation receipt

- Receipt date: 2026-09-02 (Asia/Shanghai)
- Branch: `feat/task1-workflow`
- Worktree: `D:\github\JanVim-Exhibition-2026\.worktrees\task1`
- Base commit: `089da2758ed71870b8fcc66955781a2112e1121b`
- Automated outcome: pass
- Dual-monitor visual acceptance: pass on two physical monitors, including r7 typography refinement
- Physical-projector claim: not made

## Delivered behavior

P0.2 retains the immutable JanVim artifact, orthogonal layout engine, swordsman cursor, current
`catppuccin-mocha` theme, 42-cue choreography, 90-second controller clock, offline replay,
recovery bounds, and exact final reset. It adds three exhibition-owned visual layers:

- show geometry changes from 20/4/24 DIP to 26/26/24 DIP, so the inter-column gap equals one
  complete column width;
- Latin punctuation, CJK punctuation, and symbols become upright while English remains sideways;
- standard source punctuation `，。；：？！、` remains byte-exact in papers, manifests, buffers,
  acknowledgements, and resets, while a seven-entry exhibition Lua table presents the compact
  font forms `﹐﹒﹔﹕﹖﹗﹑` through Neovim conceal;
- the exhibition agent applies the packaged JanVim visual API with left margin `0.08`, right margin
  `0.12`, and art mode disabled so `catppuccin-mocha` owns the deep background;
- every nameless in-memory exhibition buffer and reset replacement receives Markdown filetype and
  syntax while remaining `nofile`, swapless, and undo-file-free;
- the three long papers use sparse reviewed Markdown headings, blockquotes, and inline code so the
  existing Catppuccin theme receives semantic highlight groups; prose is reflowed into two-to-four
  sentence paragraphs with two-em indentation instead of one physical line per sentence.

No JanVim product repository, product source, immutable executable/archive/runtime Lua, user
Neovim configuration, source poem, source media, bridge protocol, show clock, display routing,
or protected incident directory was modified.

## Frozen identities

| Item | Bytes | SHA-256 |
| --- | ---: | --- |
| JanVim core | 18,866,688 | `224b3457d89fbc6cf946359683632f29f9262bae08b6f0d2e3043a3a7a6d83b3` |
| Packaged JanVim runtime Lua | 845 | `8738a83df02710c980655274852eea779167981b570dfb773d08cde6fff39d0a` |
| Plugin Lab bootstrap | 222 | `5a2b336fbc6974c98826cdacd0474dd33a31e05e13ebade37dbb7018aa727cb2` |
| Show config | 1,002 | `4c012266c8e9119030d113b812a6e4cf14877edb92fa39a3a560ce2b707f7f9a` |
| Artifact lock | 1,615 | `303966c4c07eb8fd69458e90c5769198f9eef9e1a639c76d8bc58c5587d363b4` |
| Content lock r7 | 2,332 | `7fe46e094fa6f8a99d5823357e85ecbb4500f6bada12d697330e3979c8ed73d6` |
| Source poem | 64 | `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8` |
| Electron main bundle | 451,940 | `a9574220042c2243a2427c98a9f206bb64d16400f3b7c18f5ef8e730ec513ca9` |
| Exhibition compact-typography module | 1,038 | `d0b8ad2a38486e4df574df5b16d7d01cc74d822b7298a49194567c53c23ac529` |

The JanVim artifact commit remains
`e95633101d93f8448b0f906e918b5d836ab95273`; `layoutEngine` remains `orthogonal`.

The active manifest was restored to the byte-exact `p0-baseline` rollback member:
`9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35`.

## Long-profile identities and visual structure

| Profile | Revision | Lines / Chinese | Markdown structure | Paper bytes / SHA-256 | Manifest bytes / SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `songfeng-source` | `20260902-songfeng-source-r7` | 22 / 1,442 | 13 prose paragraphs, 2–4 sentences; H1 1, H2 4, quotes 4, inline code 16 | 5,055 / `1828c64817fb811483b0bb515dcb2595bd04aea4a79aef25431ac467a8932864` | 21,763 / `2890e74e289f629896e5c536c7299718447ca6649c9858ca887995f408fa321f` |
| `river-channel` | `20260902-river-channel-r7` | 23 / 1,506 | 14 prose paragraphs, 2–4 sentences; H1 1, H2 4, quotes 4, inline code 12 | 5,271 / `b1bfd4af39bc4ccc127de4553045fc86f5b37e810fb58ef87dcb2c5030d0bbf1` | 21,889 / `edb2dff6f64331e01cff78c7f88a1e7d3709e3e51e12c5937053cdf82c9b4bd2` |
| `tower-codebook` | `20260902-tower-codebook-r7` | 25 / 1,471 | 14 prose paragraphs, 2–4 sentences; H1 1, H2 5, quotes 5, inline code 25 | 5,405 / `9aca5284ef6f7a27a29001f99cc6adfa94eb3e837f747f1b27ac3514b439321e` | 22,066 / `3fe4dc6e5cd54e202cd0cf4725ac41fb987f99d032960fb157c3d597a6f7874a` |

Every long manifest still has 42 cues, 15 insert actions, 22 move actions, one final reset at
90,000 ms targeting both screens, no insert payload above 404 UTF-8 bytes, and no paced insert
above 1,120 ms against the immutable 1,500 ms agent action cap.

## Test-driven evidence

The first focused RED runs failed for the intended missing behavior:

- config: expected `26.0`, received `20.0`;
- Lua: prepared/reset buffers had empty filetype/syntax and no visual API globals;
- content: all three long papers had zero level-one Markdown headings.

After the first GREEN, the full suite exposed a shared frozen-identity omission. Seventy tests
failed at `artifact-lock-hash-mismatch` because the compiled controller still pinned the previous
artifact-lock digest. The exact identity test was changed first and observed failing with the old
digest; updating only `TASK9_ARTIFACT_IDENTITY.lockSha256` returned both affected test files to
113/113 passing.

Rebuilding then produced a new bundle digest with the same byte count. The full suite isolated one
remaining launcher identity failure. The smoke-test literal was changed first and observed failing
against the old launcher digest; updating only `$reviewedElectronMainSha256` returned the focused
test to green.

A final raw-byte scan then found that the artifact lock still mixed inherited CRLF lines with the
new LF line. A new real-byte regression test failed on the CR bytes before the lock was normalized
to LF. Its normalized SHA-256 was re-frozen through the same compiled-lock and launcher-bundle
red-green chain; every other hash-sensitive input was already LF-only.

Final automated evidence:

- `npm ci`: exit 0; 183 packages; 0 vulnerabilities;
- `npm run typecheck`: exit 0;
- `npm run lint`: exit 0;
- `npm test`: 47 files, 804 tests passed, 0 failed, exit 0, 612.89 seconds;
- `npm run build`: exit 0; module graph verified;
- `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1`: exit 0;
- `pwsh -NoProfile -File .\scripts\verify-runtime.ps1`: exit 0;
- focused content/selector/launcher matrix: 3 files, 135 tests passed;
- focused frozen-lock recovery matrix: 2 files, 113 tests passed.

One pre-final full run encountered a real transient Windows `EPERM` while the unchanged run-lease
test replaced a temporary file. The isolated case then passed, its complete 28-test file passed,
and the final 804-test run passed. No run-lease source or test was changed.

The first dual-monitor visual pass confirmed the wider column gap, semantic Catppuccin colours,
upright punctuation, continuous swordsman motion, crash-free write-back, and exact reset. It also
identified two independent presentation defects. JanVim's packaged production guide traced the
white background to exhibition paper mode, while the orthogonal layout contract showed that the
32 DIP glyph advance—not the approved 10 DIP column gap—created the apparent spaces between CJK
glyphs. New tests first failed on `enable_art_mode=true` and `glyph_advance=32.0`; the bounded fix
sets art mode false and restores a 24 DIP glyph advance while retaining the approved 26/10 DIP
column geometry. The final 804-test run above includes this correction.

## r7 typography and paragraph correction evidence

The approved follow-up uses a display-layer solution instead of replacing reviewed punctuation.
Three independent RED runs failed for the intended missing behavior:

- the real TOML reported a 10 DIP gap while the hand-derived relation required the gap to equal the
  26 DIP column width;
- the real Neovim buffer reported `conceallevel=0`, proving no compact punctuation presentation was
  active;
- the three papers still exposed 52, 53, and 54 physical lines, with 43–44 one-sentence prose
  lines, instead of normal multi-sentence paragraphs.

The GREEN implementation adds one finite seven-entry display mapping, verifies all seven real
`synconcealed()` replacements, and proves the tracked buffer still contains standard punctuation
both before and after reset. The papers now contain 13–14 prose paragraphs of two to four sentences
and retain all approved prose in order. Their manifests still reconstruct exactly `"\n\n" + paper`,
with unchanged cue IDs, cue count, movement count, loop duration, and reset topology.

Each dependent frozen identity was advanced through its own RED/GREEN boundary: old r6 content-lock
pins rejected r7; the old show-config digest rejected 26/26 geometry; the independent artifact
identity test rejected the new lock digest; and the independent release test rejected the old
launcher Bundle digest. Only after each expected failure was observed was its consumer updated.

Final r7 automated evidence:

- `npm ci`: exit 0; 183 packages; 0 vulnerabilities;
- Electron 44 environment hydration: its published npm package has no install lifecycle script, so
  the package-owned `node node_modules/electron/install.js` was run after `npm ci`; verified
  `v44.0.0`, 244,440,576 bytes, SHA-256
  `1dc2d12e5c60341782e68c4b65a8e49cbd86217f81568f90575547cec13b5610`;
- `npm run typecheck`: exit 0;
- `npm run lint`: exit 0;
- `npm test`: 47 files, 808 tests passed, 0 failed, exit 0, 615.08 seconds;
- `npm run build`: exit 0; module graph verified; Bundle identity matched the table above;
- `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1`: exit 0, including compact punctuation
  before and after reset;
- `pwsh -NoProfile -File .\scripts\verify-runtime.ps1`: exit 0;
- `tests/start-show.test.ts`: 123 tests passed, 580.40 seconds;
- focused artifact/config evidence: 49 tests passed;
- focused content: 9 tests passed; selector: 6 tests passed; Electron release: 24 tests passed;
- `git diff --check`: exit 0.

The active manifest remains the byte-exact `p0-baseline` rollback member with SHA-256
`9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35`.

## Human two-monitor acceptance

- Run ID: `p02-r7-songfeng-20260902-132817-show`
- Profile: `songfeng-source` revision `20260902-songfeng-source-r7`
- Scope: two physical monitors; physical projectors not tested
- Observer outcome: pass
- Completed loops: 5
- Terminal outcome: `intentional-success`; reason `operator-stop`; launcher exit code 0
- Evidence outcome: `diagnostic`, because the operator remained connected for collaboration
- Logging incomplete: false

The owner directly confirmed:

- punctuation is visibly smaller;
- full stops continue within multi-sentence paragraphs instead of forcing an immediate new column;
- inter-column negative space is approximately one complete column width;
- the deep background, Catppuccin hierarchy, swordsman animation, continuous write-back, and exact
  reset all remain normal.

Machine evidence independently records the original-poem reset SHA-256
`b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8` in every completed loop,
acknowledged agent shutdown, natural JanVim exit, closed bridge, and removed lease.

The visual profile was selected with:

```powershell
Set-Location 'D:\github\JanVim-Exhibition-2026\.worktrees\task1'
pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile songfeng-source
```

After inspection, rollback was restored with:

```powershell
pwsh -NoProfile -File .\scripts\select-show-profile.ps1 -Profile p0-baseline
```

Physical-projector layout, brightness, focus, orientation, and keystone remain a separate hardware
rehearsal and are not acceptance conditions for this monitor-simulation P0.2 checkpoint.
