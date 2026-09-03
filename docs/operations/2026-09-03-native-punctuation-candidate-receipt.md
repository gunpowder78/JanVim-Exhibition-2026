# Native punctuation candidate implementation receipt

Date: 2026-09-03

## Scope and fallback

This is an isolated exhibition candidate. The accepted fallback remains commit
`14aef7f2af250e6e770b60b8c33ca0ea53364261` and tag
`exhibition-fallback-p0-2026-09-03`; neither its tracked bytes nor its prepared runtime were
modified.

The candidate changes only the JanVim orthogonal glyph footprint for Latin and CJK punctuation,
then removes the exhibition-side ASCII conceal substitution. Source prose, source poem, semantic
palette, column geometry, cursor VFX, deterministic cue timing, and reset behavior remain unchanged.

## Frozen JanVim candidate

- lineage base: `v0.10.1-gmk.4` / `e95633101d93f8448b0f906e918b5d836ab95273`
- candidate tag: `v0.10.1-gmk.4.punctuation.1`
- candidate commit: `3dddb882e7f54f77b7847a3e65f1acd815b3ea4f`
- archive bytes: `31347910`
- archive SHA-256: `f4c036b1faf352718f6dc32ab9a9991aaa9d8bc9e33af59bdabbb12339a7dd86`
- core bytes: `18869248`
- core SHA-256: `e492c96516439b38bfa204cc3bc5586ba2b303b7250ee9db3564aa65ffbee118`
- prepared lock SHA-256: `a2f857d8a1dc832c7a02a23ca816fd2e3e6cc21386956bc608f8fe34dbbae3a2`
- external build root:
  `D:\VirtualData\JanVim-Exhibition-Builds\gmk4-punctuation-20260903-3dddb88`

The packaged executable completed a one-frame real-window smoke and reported
`build_git_commit=3dddb882e7f54f77b7847a3e65f1acd815b3ea4f`.

## Red-to-green evidence

1. JanVim renderer tests first observed full-cell punctuation where a centered quarter-cell ink
   quad was required. The final renderer retains full cell advance, full-cell raster source, RGB,
   UAX #50 rotation, batching, and cursor overlays.
2. A mixed orthogonal/dynamic overlap test first reproduced cross-family cursor selection. Internal
   projection tags now keep `CursorGoto` on orthogonal cells and `CursorRect` on placed cells.
3. The exhibition Lua test first failed because ASCII conceal remained active. The candidate now
   keeps reviewed Unicode punctuation in the buffer and on screen, applies direct `#B74133`
   syntax color, and reports no conceal before and after reset.
4. Artifact preparation first failed on the new tag while production validators still expected the
   old artifact. Preparation, verification, controller schemas, evidence schemas, runbook checks,
   and recovery fixtures now agree on the frozen candidate identity.

## Automated gates

JanVim candidate gates passed before packaging:

- `cargo fmt --all -- --check`
- `RUST_TEST_THREADS=1 cargo test --workspace --all-targets`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo xtask guard-deps`
- independent code review: Go, no Critical or Important findings

The candidate Electron main bundle is `451996` bytes with SHA-256
`b351464b7c9ff73c2524135d6b104837386047dbfa2831b0ccd9832d4c28ed94`. The final exhibition
candidate state passed:

- `npm ci`
- `npm run typecheck`
- `npm run lint`
- `npm test` (`47` files, `810` tests)
- `npm run build`
- `pwsh -NoProfile -File scripts/run-lua-tests.ps1`
- `pwsh -NoProfile -File scripts/verify-runtime.ps1`
- `git diff --check`

Independent exhibition-candidate review reported no Critical or Important findings and a
ready-to-merge verdict after the candidate-specific provenance modes were restricted to sources
with an independently hashed build log.

The generated artifact lock is UTF-8 without BOM, contains no carriage returns, and has the
prepared SHA-256 recorded above.

## Connected preflight

The display roles stayed on IDs `1502331611` and `3192275084`. A fresh capture detected that the
Windows desktop geometry had moved the secondary display from the right of the primary to
`x=776, y=-1080`; the old confirmed map therefore failed closed as intended. The same display
roles were reconfirmed against current geometry. Final connected `ValidateOnly` then exited `0`
for run `punct-native-final-20260903-042521` with display-map SHA-256
`eed8c655ece41a08413073a28a7fd629562549dc71ad6b341f1d843851cc4738`.

## Human window 1: connected visual acceptance

The first connected launch, `punct-window1-20260903-101242-show`, intentionally used the active
`p0-baseline` rollback member because the long-form selector had not been run. It stopped cleanly
but is not counted as candidate content acceptance. The operator omission was corrected by the
locked selector; no runtime or content bytes were changed.

The accepted connected rehearsal used:

- run ID: `punct-window1-long-20260903-102627-show`;
- profile: `songfeng-source` revision `20260902-songfeng-source-r7`;
- manifest SHA-256: `2890e74e289f629896e5c536c7299718447ca6649c9858ca887995f408fa321f`;
- candidate core SHA-256: `e492c96516439b38bfa204cc3bc5586ba2b303b7250ee9db3564aa65ffbee118`;
- completed loops: `9`;
- terminal result: exit `0`, `intentional-success`, reason `operator-stop`;
- evidence result: `diagnostic`, because collaboration remained connected;
- logging incomplete: `false`; shutdown acknowledged, bridge closed, and lease removed.

The owner directly confirmed that native Chinese and English punctuation had the intended compact
footprint and vermilion color, continuous long-form write-back was correct, and one observed reset
restored the expected poem. Machine evidence records the original-poem reset SHA-256
`b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8` for every completed loop.
After the rehearsal, the selector restored the byte-exact `p0-baseline` manifest with SHA-256
`9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35`, leaving the candidate
worktree clean before this receipt update.

## Manual acceptance still required

The candidate does not replace the fallback until the scheduled dual-monitor rehearsal confirms:

- the final offline and forced-restart rehearsal receipts pass in human window 2.

This receipt claims monitor simulation only, not physical-projector acceptance.
