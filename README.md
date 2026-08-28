# JanVim Exhibition 2026

Independent dual-projector show controller for the JanVim new-media installation.

## Status

The bounded G2 implementation candidate now includes the frozen JanVim artifact, deterministic
controller/Bridge loop, secondary-screen renderer, show agent, content fixture, and external
two-display rehearsal workflow. Automated verification and the human two-monitor G2 checkpoint
must both pass before this candidate is accepted. Physical-projector G3/G4 acceptance remains
pending; a monitor simulation never counts as projector acceptance.

## Show topology

- Primary projector: a candidate from the human-tested JanVim `v0.10.1-gmk.4` lineage; exact
  portable bytes become immutable only after provenance and SHA-256 freeze, then provide real
  Vertical-RL editing and Swordsman cursor movement.
- Secondary projector: TypeScript/Electron presentation of the prompt, pre-generated response,
  formula/matrix/image interludes, and synchronized key overlay.
- Controller: one monotonic timeline, bounded localhost cue bridge, deterministic loop/reset, and
  finite restart policy.

The show is fully offline. It does not invoke a live language model or image service and it does
not represent the secondary screen as a JanVim Float.

## Authoritative documents

- [Repository and replay decision](docs/adr/0001-separate-show-repository-and-deterministic-replay.md)
- [Dual-projector design](docs/specs/2026-08-28-dual-projector-generative-performance-design.md)
- [Four-day delivery plan](docs/plans/2026-08-28-four-day-dual-projector-delivery.md)

## Relationship to JanVim

This repository and `D:\github\JanVim` exchange only a locked portable artifact. They have
different source histories, quality gates, release packages, and acceptance criteria. A successful
show does not close JanVim Task26 or prove community-plugin compatibility; a JanVim product gate
failure does not invalidate a frozen show artifact that already passed this repository's physical
rehearsal.
