# JanVim Exhibition 2026 agent instructions

This repository is the time-critical dual-projector artwork controller. It is not the JanVim
editor product and must not be used as evidence that JanVim product behavior is complete.

## Boundaries

- Keep JanVim product source out of this repository.
- Consume JanVim only as an immutable packaged artifact identified by commit, tag, byte size, and
  SHA-256 in `janvim-artifact.lock.json`.
- Never modify a JanVim worktree, user Neovim configuration, source poem, or source media during a
  show run.
- All model text and images are generated, reviewed, and frozen before the show. The live loop is
  deterministic and works with the network disabled.
- The primary projector runs the fixed JanVim artifact. The secondary projector is the Web show
  surface. Do not describe the secondary surface as a JanVim Float.
- The controller owns the only show clock. Editor actions and the key overlay derive from the same
  cue; do not use global keyboard injection or coordinate clicking.
- Show-only fixed display IDs, FHD geometry, and curated content are allowed when recorded in the
  show manifest. Do not copy these shortcuts back into JanVim.
- Every cue, retry queue, log, media preload, and recovery loop must have a finite bound.
- Large media may remain outside Git only when `media-manifest.json` records its relative path,
  byte size, SHA-256, provenance, and at least one independent backup location.

## Development discipline

- Keep the first runnable loop small: prompt, response, one real editor write-back, and reset.
- Add a failing deterministic state-machine or schema test before changing show behavior.
- Use a fake monotonic clock in automated tests; do not wait for an eight-minute wall-clock loop.
- Preserve the last runnable rehearsal tag. Never replace a working P0 loop with an untested P1
  visual effect on installation day.
- Record every physical rehearsal with display mapping, resolution, scale, artifact hashes, loop
  count, drift, recovery result, and operator notes.

## Required verification after application scaffolding exists

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Completion additionally requires three consecutive loops on the two physical projectors, one
offline run, and one forced-restart recovery rehearsal. Automated browser tests cannot replace
that physical acceptance.
