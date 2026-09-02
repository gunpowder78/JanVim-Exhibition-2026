# P0.2 visual hierarchy design

- Status: Approved
- Approval date: 2026-09-02
- Scope: dual-monitor P0 visual refinement
- Physical-projector claim: not made

## Problem

The accepted P0.1 long papers prove deterministic write-back, movement, reset, and recovery, but
their primary-screen composition is too dense and nearly monochrome. The current 20 DIP column,
4 DIP gap, and 24 DIP glyph advance expose too many simultaneous cells. Every punctuation class
is sideways, while the exhibition buffer has neither Markdown filetype nor syntax, so the existing
`catppuccin-mocha` theme has almost no semantic groups to colour.

The first two-monitor correction established the dark background and compact CJK glyph advance,
but exposed three remaining composition problems: full-width punctuation dominates the Chinese
glyphs, sentence-per-line source formatting turns every full stop into a new physical column, and
the 10 DIP inter-column gap is narrower than the approved 26 DIP column.

## Decision

Keep the immutable JanVim artifact, `orthogonal` engine, `swordsman` cursor, current theme, public
launcher, show clock, bridge protocol, cue topology, and exact reset behavior. Improve the primary
composition through four bounded exhibition-owned layers:

1. Change the show TOML to a 26 DIP column, 26 DIP gap, and 24 DIP glyph advance. The gap therefore
   remains parametrically equal to one column width. Keep English
   sideways, but render Latin punctuation, CJK punctuation, and symbols upright.
2. Apply the packaged JanVim Lua API once during exhibition-agent setup with `margin_left = 0.08`,
   `margin_right = 0.12`, and `enable_art_mode = false` so Catppuccin supplies the dark background. Every prepared or reset exhibition buffer
   receives `filetype=markdown` and `syntax=markdown` while remaining nameless, `nofile`, swapless,
   undo-file-free, and in memory.
3. Apply a display-only compact-punctuation table after Markdown syntax is installed. Standard
   source characters `，。；：？！、` remain in the buffer, manifest, hashes, acknowledgements, and
   reset snapshot, while Neovim conceal presents the font-covered small forms `﹐﹒﹔﹕﹖﹗﹑` at
   `conceallevel=2` in normal, visual, insert, and command-line cursor modes. The mapping is fixed,
   finite, reapplied on every prepared/reset buffer, and performs no text mutation.
4. Reformat the three reviewed long papers as sparse Markdown with normal Chinese paragraphs. Each
   prose paragraph begins with a two-em ideographic indent and contains two to four sentences;
   headings and blockquotes remain standalone semantic columns. Each paper has one level-one title,
   at least three level-two headings, at least three blockquotes, and at least six inline-code spans.
   The prose, standard punctuation, information-theory vocabulary, 18–30-line bound,
   1,400–2,000 Chinese-character bound,
   12–18 insert bound, 18–28 move bound, 512-byte action bound, 1,500 ms action bound, 90-second
   loop, and final exact reset remain enforced.

The P0 rollback paper and manifest stay byte-exact. The active profile returns to `p0-baseline`
after automated verification. A human chooses one long profile for final two-monitor visual A/B.

## Hash and isolation consequences

Changing the show TOML updates its SHA-256 in `janvim-artifact.lock.json`, the launcher's pinned
expected show-config digest, and the controller's compiled frozen artifact-lock SHA-256. The
Electron bundle therefore receives a new recorded identity, but no controller algorithm or
protocol changes. This does not alter the JanVim executable, archive, product runtime Lua,
artifact config, provenance, or layout-engine identity.

Changing exhibition Lua does not copy product source into this repository. It consumes the
already-packaged `require("janvim").setup` API from the immutable runtime. Long-paper and manifest
changes bump the three profile revisions and the P0.1 content-lock revision, byte counts, and
SHA-256 values. The selector and launcher continue to interpret those exact frozen identities.

## Rejected alternatives

- A TOML-only change cannot create syntax colour hierarchy.
- Replacing reviewed punctuation with ASCII or small-form characters is rejected because it would
  corrupt source typography, hashes, acknowledgements, and reset semantics. Display-only conceal
  preserves those contracts while using glyphs already present in the frozen Noto Sans SC font.
- Changing the global font size is rejected because it would shrink Chinese glyphs and the swordsman
  composition together instead of addressing punctuation alone.
- Switching to `dynamic` is rejected for P0.2 because Plugin Lab previously produced a dynamic
  candidate fallback and stderr; it would also change evidence schemas and the accepted VFX tradeoff.
- Rebuilding JanVim is rejected because this task is an exhibition-owned visual refinement, not a
  JanVim product change.

## Acceptance

Automated acceptance requires focused red-green evidence, Lua tests, content/hash tests,
`verify-runtime.ps1`, the complete npm test suite, typecheck, lint, build, `git diff --check`, and a
recorded Electron main-bundle byte count and SHA-256. Visual acceptance remains a human two-monitor
inspection: the primary must show more negative space, visible Markdown colour hierarchy, upright
compact punctuation, multi-sentence paragraphs, a one-column-width inter-column gap, continuous
long-form movement, no crash/restart, and exact poem reset. Physical
projector tuning remains a separate hardware rehearsal.
