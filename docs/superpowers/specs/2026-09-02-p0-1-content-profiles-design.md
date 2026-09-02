# P0.1 frozen content profiles design

- Status: approved by owner on 2026-09-02
- Date: 2026-09-02
- Parent plan: `docs/plans/2026-08-28-four-day-dual-projector-delivery.md`
- Acceptance baseline: dual-monitor P0 simulation accepted on 2026-09-01

## 1. Goal

P0.1 increases the visible expressive range of the accepted dual-monitor loop without changing
the compiled controller, JanVim product, immutable JanVim artifact, show clock, transport, or
recovery model. The primary screen receives substantially longer pre-reviewed pseudo-academic
texts so JanVim's existing cursor motion, horizontal travel, and `swordsman` effects have enough
material to read as fast, deliberate movement. The secondary screen continues to render cues from
the same deterministic manifest.

The live show remains offline and deterministic. No model is invoked at runtime. “Randomness” is
curated irregularity in each fixed cue sequence; profile selection is an explicit pre-show
operation and the daily order may repeat.

## 2. Boundaries

- Work only in the exhibition repository's isolated P0.1 worktree.
- Do not modify the JanVim product repository, immutable artifact, user Neovim configuration,
  source poem, source media, or the three protected incident directories.
- Keep the current `catppuccin-mocha` theme, `swordsman` cursor effect, and orthogonal layout.
- Do not change TypeScript, Lua, Electron bundles, bridge protocols, or controller timing code.
- Preserve `content/fixture/show.manifest.json` as the controller's fixed active-manifest path.
- Preserve the accepted baseline profile as an allowlisted rollback option.
- Every path, profile, byte count, digest, cue count, cue payload, and reset is finite and checked.

## 3. Frozen profile set

The repository contains one rollback profile and three exhibition profiles:

| Profile ID | Display title | Subject |
| --- | --- | --- |
| `p0-baseline` | P0 基线 | Accepted short-loop rollback manifest |
| `songfeng-source` | 松风信源 | Entropy, source coding, and `H(X)` |
| `river-channel` | 河流信道 | Noisy channel, channel capacity, and transmission |
| `tower-codebook` | 层楼码本 | Mutual information, codebook, and rate-distortion |

Each exhibition profile has an original, pre-reviewed `paper.md` and a frozen
`show.manifest.json`. The three new manifests share a 165,000 ms choreography and each contains:

- 48–64 newline-separated paper lines and roughly 1,400–2,000 Chinese characters;
- 12–18 bounded insert actions whose UTF-8 payloads remain within the schema's 512-byte limit;
- 18–28 bounded move actions using only the existing allowlisted keys;
- moderate English information-theory vocabulary and formula names;
- one completed secondary token stream followed by one accepted secondary token stream before
  the first non-reset editor action;
- one final editor `reset` cue at exactly 165,000 ms.

The original four-line poem is unchanged and every manifest names its frozen SHA-256.

## 4. Content lock

`content/p0.1/content-lock.json` is the sole interpreted allowlist. Its exact raw bytes are pinned
in both public PowerShell entry points. It has a strict schema and contains:

- schema and content-set revision;
- the exact four profile IDs in a fixed order;
- for each profile: revision, paper path/bytes/SHA-256, and manifest path/bytes/SHA-256;
- the shared poem path/bytes/SHA-256.

Paths are repository-relative slash-separated literals under the fixed profile root. Absolute
paths, traversal, unknown properties, duplicate IDs, aliases, and unlisted files are rejected.
The lock, paper, and manifest readers enforce finite byte caps before parsing or hashing.

All hash-pinned text assets use LF through `.gitattributes`, so a fresh Windows checkout retains
the reviewed byte identity.

## 5. Profile selection

`scripts/select-show-profile.ps1 -Profile <id>` is the only profile-staging operation. It:

1. establishes the exhibition repository root from `$PSScriptRoot` and validates its marker;
2. reads and validates the pinned lock within its byte limit;
3. accepts only a literal allowlisted profile ID;
4. validates the selected paper and manifest path, size, and digest;
5. validates the manifest schema, content revision, poem digest, cue bounds, completion-before-
   acceptance-before-writeback causality, and final reset;
6. atomically replaces the fixed active manifest using a same-directory temporary file;
7. rereads the active file and returns one compressed JSON receipt.

The script never changes the poem, profile sources, JanVim, runtime artifact, user configuration,
or external rehearsal evidence. Re-selecting the active profile is idempotent and reports
`already-active`.

## 6. Start-show interpretation gate

`scripts/start-show.ps1` retains its existing public parameters and active manifest path. Before
runtime verification or Electron launch it additionally:

- verifies the exact content-lock byte count and pinned SHA-256;
- validates its strict property sets, exact allowlist, canonical relative paths, finite caps,
  member byte counts, and hashes;
- identifies exactly one locked profile whose manifest digest and byte count match the active
  manifest;
- verifies that profile's revision, poem digest, cue payload bounds, completion-before-
  acceptance-before-writeback causality, and final reset;
- freezes the content lock and selected paper alongside the active manifest and poem for the
  launch lifetime.

Any ambiguity or mismatch fails closed before a show process starts. Existing evidence remains
compatible: the selected manifest's `contentRevision`, byte count, and SHA-256 already flow into
`show-run.json`.

## 7. Verification and acceptance

Automated verification covers allowlist rejection, traversal and unknown-field rejection, lock
and member hash mismatch, byte caps, cue counts, insert payload limits, the exact terminal reset,
completion-before-acceptance-before-writeback causality, selector idempotence and atomic staging,
startup fail-closed behavior, and LF checkout policy.

The final gate is:

```powershell
npm ci
npm run typecheck
npm test
npm run build
pwsh -NoProfile -File .\scripts\verify-runtime.ps1
git diff --check
```

The rebuilt Electron main bundle must remain exactly 451,940 bytes with SHA-256
`aad1d8ab03a7bd7bff4d02530da24f832ed7a822cd4739f0c7f7f66a167c4727`. Automated success prepares
the branch for a separate dual-monitor visual review; it does not claim physical-projector G4.
