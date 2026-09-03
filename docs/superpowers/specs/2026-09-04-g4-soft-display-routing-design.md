# G4 soft display routing design

- Status: Approved for autonomous implementation
- Approval date: 2026-09-04
- Scope: G4 physical-isolation preparation for one- or three-display operation
- Physical-projector claim: not made

## Problem

The accepted P0 show binds the primary JanVim window and secondary Web surface to one confirmed
two-display snapshot. Electron display IDs, bounds, scale, and rotation are deliberately checked
before a show, but the resulting all-or-nothing match turns an ordinary port swap, DPI adjustment,
hot-plug, or added service monitor into an opaque startup failure. It also has no role for the
future third artwork surface.

The controller must not guess which physical output carries an artwork. Automatic remapping could
put JanVim, narrative content, or a future bird-flock surface on the wrong projector. The correct
replacement for the opaque failure is an explicit, technician-resolvable configuration state.

## Decision: two files, one resolved route

Keep hardware-independent intent and installation-specific binding separate.

1. Checked-in `show/display-layout.json` is the immutable logical layout. It contains no Electron
   display IDs and defines exactly three soft roles:
   - `SCREEN-1` / `janvim`
   - `SCREEN-2` / `narrative`
   - `SCREEN-3` / `jianshan-placeholder`
2. External `display-map.json` schema 2 is generated only by the manually launched configuration
   GUI. It records one selected mode, the layout SHA-256, a fresh physical topology snapshot, and
   explicit soft-role bindings.
3. Every consumer receives one `ResolvedDisplayRoute`; no downstream show component performs its
   own ID lookup or role inference.

The logical layout has this strict shape:

```json
{
  "schema": 1,
  "roles": [
    { "softId": "SCREEN-1", "surface": "janvim" },
    { "softId": "SCREEN-2", "surface": "narrative" },
    { "softId": "SCREEN-3", "surface": "jianshan-placeholder" }
  ],
  "modes": [
    {
      "mode": "production-3",
      "activeRoles": ["SCREEN-1", "SCREEN-2", "SCREEN-3"],
      "skippedRoles": []
    },
    {
      "mode": "single-display-preview",
      "activeRoles": ["SCREEN-1"],
      "skippedRoles": ["SCREEN-2", "SCREEN-3"]
    }
  ]
}
```

The schema-2 map has exactly these top-level fields: `schema`, `mappingStatus`, `mode`,
`layoutSha256`, `capturedAtUtc`, `topologySha256`, `bindings`, and `unassignedDisplays`. Each
binding contains `softId`, string `displayId`, bounded `label`, `bounds`, `workingArea`,
`scaleFactor`, `rotation`, and `geometrySha256`; each unassigned entry contains the same physical
fingerprint without `softId`. The geometry digest covers the ID, bounds, working area, scale, and
rotation in a canonical array. The topology digest is independently recomputed from all stored
binding and unassigned fingerprints sorted by ID. Runtime routing validity is based only on selected
role fingerprints, so an unassigned service monitor can be added or removed without interrupting
the artwork.

Input limits are fixed: at most 16 live displays, 256 UTF-8 bytes per ID, 512 UTF-8 bytes per
label, 16 KiB for the logical layout, and 64 KiB for a display map. Unknown fields, duplicate IDs,
duplicate roles, unsupported modes, malformed UTC timestamps, unsafe numbers, and hash mismatches
are rejected.

## Unified route contract

The route result is a discriminated union:

```ts
type SoftDisplayId = "SCREEN-1" | "SCREEN-2" | "SCREEN-3";

type ResolvedDisplayRoute =
  | {
      state: "mapped";
      mode: "legacy-dual" | "production-3" | "single-display-preview";
      roles: Partial<Record<SoftDisplayId, ShowRuntimeDisplay>>;
      skippedRoles: readonly SoftDisplayId[];
      unassignedDisplays: readonly ShowRuntimeDisplay[];
    }
  | {
      state: "configuration-required";
      reason: DisplayConfigurationReason;
    };
```

`production-3` is available with three explicit, distinct bindings and at least three live
displays. Additional live displays are unassigned and ignored. `single-display-preview` is
available only when exactly one live display exists and binds only `SCREEN-1`; it must record
`SCREEN-2` and `SCREEN-3` as skipped and can never satisfy production or physical-projector
acceptance. A two-display topology has no implicit mode and requires configuration.

Expected mapping problems return `configuration-required` with a bounded reason. They do not throw
through the Electron lifecycle, enter the JanVim recovery budget, or launch any artwork process.
The public launcher returns exit code 2 and a machine-readable `configuration-required` receipt;
this is an actionable safe non-show state, not a successful exhibition run. Unexpected integrity,
artifact, or controller failures retain the existing nonzero failure path.

## Manual configuration GUI

Add one pure-Electron configuration mode behind a public PowerShell launcher. The technician, not
the show controller, starts it. The GUI:

- enumerates and normalizes the current Electron displays;
- lists label, ID, bounds, working area, scale, and rotation;
- opens local, frameless, fullscreen identification cards numbered `1..N` only when the operator
  presses **Identify displays**; the cards close automatically after 12 seconds and never navigate;
- exposes empty-by-default role selectors, so no physical role is guessed;
- permits `production-3` only for three distinct selected displays when at least three exist;
- permits `single-display-preview` only when exactly one display exists;
- rejects a save if topology changed after the displayed snapshot;
- atomically creates or replaces only the direct-child `display-map.json` in a rehearsal root that
  contains no terminal show evidence; and
- performs no Windows topology mutation, no global input injection, no automatic show launch, no
  automatic resume, and no network access.

The configuration window and identify cards use dedicated, least-privilege preload/IPC surfaces,
context isolation, sandboxing, local-file navigation guards, strict payload parsers, and bounded
listener/timer cleanup. Existing secondary-screen preload capabilities are not exposed to the GUI.

## Show behavior

For `production-3`, the resolved roles are consumed as follows:

- `SCREEN-1` places the immutable, hash-locked JanVim artifact.
- `SCREEN-2` hosts the existing narrative/Web surface and remains the only cue/presentation
  surface.
- `SCREEN-3` hosts a deterministic local deep-background standby page for 《见山》. It exposes no
  desktop, terminal, network content, or control API. Future Jianshan integration replaces this
  one adapter without changing routing.

The narrative surface and standby page are opened and closed as one bounded display-surface group.
A loss of either window uses the existing bounded secondary recovery path; JanVim recovery remains
independent.

For `single-display-preview`, a local start surface may temporarily share `SCREEN-1` to preserve
the deliberate Start action. It stays above JanVim only until Start is accepted, then hides; the
visible artwork is JanVim alone. Narrative and Jianshan roles are recorded as skipped. Stopping is
through the bounded controller stop path or SIGINT.

## Live topology changes

The controller subscribes to Electron `display-added`, `display-removed`, and
`display-metrics-changed` only after validation. Events are coalesced by one 500 ms timer. A fresh
route is computed from the frozen map:

- if every assigned role still resolves to the same fingerprint, only an informational bounded
  topology event is logged; changes to unassigned displays do not interrupt the show;
- if an assigned ID, bounds, working area, scale, or rotation changes, exactly one
  `display-topology-changed` emergency stop is requested;
- the normal bounded cleanup resets the original poem, closes artwork surfaces, settles the
  JanVim lease, records terminal/evidence state, and never auto-remaps or auto-restarts.

The operator then creates a fresh rehearsal root, runs the GUI, and starts a new show. No code path
calls Windows `QueryDisplayConfig`, `SetDisplayConfig`, or an equivalent topology-changing API.

## Evidence and compatibility

Schema-1 confirmed two-display maps remain accepted as `legacy-dual`. Their exact primary,
secondary, count, and geometry behavior remains unchanged, preserving the current P0 rollback.
The checked-in unconfirmed schema-1 sample also remains unchanged.

New runs freeze `display-layout.json` and `display-map.json` in the same immutable input snapshot.
Show evidence adds a bounded routing record containing mode, layout/map/topology SHA-256 values,
soft-role assignments, skipped roles, unassigned display count, placeholder use, and any topology
stop. Existing primary/secondary evidence fields remain for schema-1 readers. Single-display
evidence uses `acceptanceScope: "single-display-preview"` and
`physicalProjectorsTested: false`. No automated path claims three-projector acceptance.

The immutable JanVim executable/archive/runtime Lua, artifact lock, source poem/media, controller
clock, bridge protocol, cue choreography, reset hash, current P0 branch, and Windows display
configuration remain outside this change.

## Rejected alternatives

- Automatic nearest-geometry or left-to-right role assignment is unsafe because a plausible match
  can still project private or wrong content.
- Windows-native display reconfiguration expands privileges and driver-specific failure modes
  without improving the manual role decision.
- A generic unlimited N-screen framework is unnecessary. G4 supports exactly the approved three
  roles, plus bounded unassigned displays.
- Replacing the accepted schema-1 path would remove the known-good rollback.
- Integrating Jianshan/OSC in this task couples two artworks before its protocol and choreography
  are approved; the local placeholder is the isolated seam.

## Acceptance

Automated acceptance requires focused red-green evidence for strict schemas, hashes and byte caps,
role conflicts, enumeration order, extra displays, stale DPI/rotation/bounds, single-display mode,
GUI stale-save rejection, IPC/navigation isolation, atomic map publication, placeholder grouping,
topology-event coalescing, one-shot safe stop, legacy behavior, and evidence classification. It also
requires `npm ci`, typecheck, lint, the complete test suite, build, Lua tests, runtime verification,
`git diff --check`, and a recorded Electron main-bundle byte count/SHA-256.

Human G4 acceptance is separate: identify and bind three extended displays, observe JanVim,
narrative, and Jianshan standby simultaneously, confirm an extra unassigned display is ignored,
change one assigned port/DPI and observe a safe topology stop, regenerate a map and restart, then
repeat with exactly one display and confirm JanVim-only preview plus explicit skipped-role evidence.
