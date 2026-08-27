# ADR-0001: Separate the show repository and use deterministic replay

- Status: Accepted
- Decision date: 2026-08-28
- Decision owner: JanVim project owner
- Detailed design:
  [Dual-projector generative performance](../specs/2026-08-28-dual-projector-generative-performance-design.md)

## Context

The exhibition has a hard installation deadline measured in days. Its desired result combines a
real JanVim Vertical-RL primary image with a secondary screen that reveals prompt construction,
pre-generated information-theory prose, formulas, matrix fields, images, and a Vim-key overlay.

Trying to finish the JanVim Rust/WGPU community Float product before the exhibition would bind the
artwork to unresolved product gates. Keeping show code inside JanVim would impose the wrong release
shape and encourage fixed-resolution, media, and timing shortcuts to leak into the editor product.

Live model calls would add network, latency, moderation, nondeterminism, and content risks that do
not strengthen the artwork's central causal sequence.

## Decision

1. The exhibition is developed in the independent sibling repository
   `D:\github\JanVim-Exhibition-2026`.
2. The primary-projector candidate comes from the human-tested
   `v0.10.1-gmk.4` / `e95633101d93f8448b0f906e918b5d836ab95273` lineage. It becomes the
   immutable show artifact only after its executable, archive, config, and layout-engine identity
   are traced and hashed before rehearsal; the tag alone is not a binary provenance claim.
3. The secondary projector is an Electron/TypeScript Web surface controlled by the same process
   that owns the show clock.
4. A small exhibition-only Lua agent receives a closed set of semantic editor actions over a
   localhost bridge. It operates only on an in-memory poem copy and never writes a source file.
5. Text, prompts, formulas, and images are generated and curated before installation. The live
   show replays them deterministically with the network disconnected.
6. The secondary key overlay and the primary editor action consume the same cue. Global keyboard
   injection, AutoHotkey, coordinate clicks, and two independently advancing timelines are
   rejected.
7. Fixed display IDs, FHD geometry, and show-specific timing are allowed when declared in the show
   manifest. They are marked `show-only` and are never copied into JanVim product code.
8. The JanVim and exhibition repositories exchange no source or submodule. The only integration
   contract is `janvim-artifact.lock.json` plus copied, hash-verified release bytes at packaging
   time.

## Consequences

### Positive

- The artwork can reach a visible loop quickly without weakening JanVim's architecture or gates.
- One controller prevents independent-video drift and makes the key overlay truthful.
- Offline replay is repeatable, reviewable, and recoverable.
- The real JanVim editor and cursor remain physically present on the primary projector.
- Show-only shortcuts are isolated and disposable after the exhibition.

### Costs and limitations

- The secondary generation is staged, not live autonomous AI.
- The localhost agent and display routing require Windows rehearsal.
- Every content revision requires a new manifest/hash freeze.
- A successful exhibition is not evidence for JanVim Float, AstroNvim, or broad plugin support.

## Alternatives rejected

### Continue product Float development as the show critical path

Rejected because product gates, review, native packaging, and real-window acceptance cannot be
compressed safely into the installation deadline.

### Put the show on a JanVim branch

Rejected because Node/Electron/media dependencies and fixed show geometry have different release
and maintenance requirements from the Rust editor.

### Run two synchronized videos or two independent timers

Rejected because startup error, frame stalls, and restart would create cumulative causal drift.

### Simulate both screens in Web

Retained only as an emergency fallback. It improves synchronization but removes the physical fact
that JanVim is editing the primary text.

### Use a live LLM or image generator

Rejected for the installed version because it creates avoidable network, timing, content, and
recovery failure modes.
