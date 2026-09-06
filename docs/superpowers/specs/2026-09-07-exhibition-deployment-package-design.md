# Exhibition Deployment Package Design

**Date:** 2026-09-07

**Status:** Approved design, awaiting implementation plan

**Scope:** Attended three-screen exhibition deployment on Windows 11 x64

## Context

The attended Site Mix v2 rehearsal proved the integrated JanVim, JianShan, camera, and
SuperCollider sound path. The remaining operator burden is specific and repeatable: JianShan
opens on the wrong display, must be moved in front of the SCREEN-3 standby surface, and must be
changed from white-background/black-bird rendering to black-background/white-bird rendering.

The deployment must also be copyable to a second Mini PC with a fixed `D:` drive. The installation
is attended by museum staff, so recovery by stopping or rebooting the computer is acceptable. This
delivery does not attempt unattended operation or extreme fault tolerance.

## Goals

1. Produce a hash-verified package that can be copied to
   `D:\github\JanVim-Exhibition-Deploy` without Git or network access.
2. Start the complete artwork from one operator command.
3. Start JianShan on SCREEN-3, maximized, topmost for the session, and immediately rendered as
   black background with white birds.
4. Keep the JianShan window interactive: the system pointer is visible over it and mouse clicks
   focus and operate it.
5. Start the rehearsal automatically after all controller readiness gates pass.
6. Add a system-wide `Ctrl+Shift+S` normal-stop shortcut and show that shortcut beneath the
   existing `STOP SHOW` button.
7. Supply concise installation, daily-operation, and troubleshooting documentation.
8. Preserve the existing exhibition fallback and immutable JanVim artifact.

## Non-goals

- Offline acceptance.
- Forced process-fault or forced-recovery acceptance.
- HP performance, four-million-bird, or long-duration stress acceptance.
- 7x24 unattended operation, a watchdog, a Windows service, or automatic restart.
- Hot-plug repair while a show is running.
- Automatic installation of Windows drivers or third-party programs.
- MSI packaging.
- Changes to JanVim product source or its user Neovim configuration.
- Changes to JianShan simulation or rendering source.

## Chosen approach

Use an attended external deployment launcher and one narrowly scoped controller extension.

- The external launcher owns package verification, fresh-session preparation, process order,
  JianShan private configuration, exact window placement, and bounded cleanup.
- The controller gains an explicit automatic start policy and a session-scoped global normal-stop
  shortcut.
- JianShan remains the already identified candidate executable. Black/white presentation is set in
  its generated private TOML rather than by keyboard automation or a rebuilt binary.
- The existing SCREEN-3 standby surface remains unchanged. JianShan is launched before the Show
  controller and marked topmost, so the subsequently created standby surface remains beneath it.

This has a smaller blast radius than rebuilding JianShan or changing the controller's production-3
standby and evidence rules.

## Fixed paths

The installed package root is:

```text
D:\github\JanVim-Exhibition-Deploy
```

Run data and evidence remain outside the package under:

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals
```

Mutable site configuration remains outside the package under:

```text
D:\VirtualData\JanVim-Exhibition-Rehearsals\site-config
```

No run-time token, descriptor, lease, or private session configuration is included in the package
or copied from a previous run.

## Package layout

```text
D:\github\JanVim-Exhibition-Deploy\
├─ app\                 runnable controller snapshot, frozen content, JanVim artifact, node_modules
├─ runtime\jianshan\    identified EXE, DLLs, model, and safe configuration template
├─ tools\node\          package-local Node.js v22.23.0 runtime
├─ config\              read-only templates and non-secret defaults
├─ operator\            verify, display-configure, start, and stop entry points
├─ evidence\            candidate identities and attended-acceptance receipts
├─ docs\                deployment, daily-operation, and troubleshooting documents
└─ package-manifest.json
```

The package intentionally carries the complete verified `node_modules` used to build and run the
controller. Dependency pruning is out of scope because its smaller archive would not justify the
risk of omitting a launch-time module. The target computer does not run `npm install`.

Every packaged payload file is represented in `package-manifest.json` by relative path, byte size,
and SHA-256; the manifest cannot recursively list itself. Paths are unique, relative, and forbidden
from escaping the package root. Verification rejects a missing, extra, changed, or path-escaping
payload before launching any artwork process. The package builder also emits an external handoff
receipt containing the manifest hash and the hash of the complete transfer archive, so the copied
manifest has an independent identity anchor.
Generated display maps, persisted sound mix, ownership records, private configurations, and run
evidence are external mutable data and therefore are not entries in the immutable package manifest.

## Operator entry points

The package exposes four PowerShell entry points:

```text
Verify-Deployment.ps1
Configure-Displays.ps1
Start-Exhibition.ps1
Stop-Exhibition.ps1
```

`Verify-Deployment.ps1` performs read-only package and prerequisite checks.
`Configure-Displays.ps1` invokes the existing display configurator and writes a fresh confirmed
mapping beneath the external `site-config` root for the target computer. `Start-Exhibition.ps1`
creates and supervises one attended session. `Stop-Exhibition.ps1` is a technical fallback; the
normal stop paths are the shortcut and the SCREEN-2 button.

## Startup flow

1. Resolve the fixed package root without following a package-root reparse point.
2. Verify the package manifest, immutable JanVim identity, controller bundle, JianShan runtime,
   frozen content, third-party versions, the external site display map and sound mix, camera
   availability, and configured audio endpoint.
3. Create a fresh direct child beneath the rehearsal parent and write only new per-run private
   files there.
4. Start the SuperCollider sound chain and wait for its bounded ready receipt.
5. Generate the JianShan private configuration from the identified safe template. It contains the
   new flock descriptor path and the following presentation settings:

   ```toml
   [display]
   invert_colors = true
   bird_color_preset = "contrast"
   ```

6. Launch the identified JianShan executable from the package.
7. Find only the visible top-level window owned by the newly launched PID, while also checking the
   recorded process start identity. Give the window at most 15 seconds to appear.
8. Move it to the current SCREEN-3 bounds from the confirmed display map, maximize it, and call
   `SetWindowPos` with `HWND_TOPMOST`. Reject a window carrying click-through or no-activate extended
   styles. No keyboard injection, coordinate click, title-only lookup, or permanent polling is used.
9. Start the controller with the explicit `Automatic` start policy. The controller performs its
   existing bridge, JanVim, poem, and display readiness checks, publishes ready status, and then
   accepts exactly one automatic start through the same coordinator state machine as a local Start
   action.

The topmost property lasts only for the lifetime of the JianShan window. It does not affect A or B
screens and disappears when the process exits.

## Automatic start policy

The existing operator-start behavior remains the default for all old and development entry points.
The deployment launcher alone passes `Automatic`.

The new policy is strict and explicit rather than inferred from environment variables. Automatic
start is accepted only from the coordinator's ready and armed state, and at most once. A validation,
startup, or placement failure cannot start a partial rehearsal. The SCREEN-2 Start control may be
hidden or disabled in automatic mode, while status text reports automatic startup.

## Normal stop shortcut

During a Show or Soak session, Electron registers the Windows global accelerator
`Control+Shift+S`. Letter case is not meaningful for the accelerator. Registration occurs before
automatic start; failure to reserve the shortcut aborts launch with an explicit diagnostic.

The callback invokes a public coordinator normal-stop request that delegates to the existing
`stop-show` behavior. It therefore queues safe loop-boundary shutdown when running and performs the
same bounded cleanup and sound fade as the button. Repeated shortcut events are idempotent.

The accelerator is unregistered in every terminal path. It is input capture, not keyboard
injection. The SCREEN-2 `STOP SHOW` button remains available, with this text directly beneath it:

```text
快捷停止：Ctrl + Shift + S
```

## Process ownership and cleanup

The launcher writes one bounded ownership record containing the current run root and the PID plus
start time of each process it directly launched. It contains no flock token. Startup rollback and
`Stop-Exhibition.ps1` operate only on identities that still match this record; they never terminate
processes by broad executable name.

Preflight failure starts nothing. Failure after partial startup performs reverse-order bounded
cleanup. When the operator stops normally, the controller initiates the unified sound fade, the
launcher waits for controller completion, closes its JianShan window, and verifies process exit.
If ordinary cleanup cannot finish, the script reports the exact remaining identity for attended
manual recovery rather than entering an infinite retry loop.

## Third-party requirements

The target computer requires:

- Windows 11 Pro x64 with a fixed `D:` drive.
- PowerShell 7.6.5 x64.
- SuperCollider 3.14.1 at `C:\Program Files\SuperCollider-3.14.1`.
- Three displays in Windows extended mode and a confirmed SCREEN-1/2/3 map.
- A current GPU driver supporting DX12 Compute.
- A UVC camera driver and Windows camera permission.
- The tested output endpoint `Windows WASAPI : Headphones (Senary Audio)`, configured for 48 kHz
  stereo output.

Node.js v22.23.0, Electron, the required JavaScript dependencies, JianShan VC runtime DLLs,
MediaPipe/OpenCV DLLs, and the hand-landmarker model are included in the package. Git, npm, Cargo,
Rust, Python, Visual Studio, and ASIO are not target-machine prerequisites.

The launcher supplies the package-local Node runtime through a bounded child-process environment
that exposes exactly that Node executable. It does not depend on, modify, or search arbitrary
machine-level Node installations.

Third-party installers are not bundled. The deployment document identifies the exact versions and
installation paths, and the verifier reports each missing or mismatched prerequisite in Chinese.

## Documentation

The deployment contains only three operator documents:

1. `README-DEPLOYMENT.md`: third-party installation, package copy, verification, display mapping,
   and first launch.
2. `DAILY-OPERATOR-CARD.md`: one-page start, normal stop, and reboot recovery procedure.
3. `TROUBLESHOOTING.md`: display, topmost window, mouse, camera, GPU, audio device, shortcut
   collision, and clean restart diagnostics.

## Automated verification

Implementation begins with deterministic failing tests for:

- strict parsing and defaulting of the manual versus automatic start policy;
- one automatic start only after ready and armed state;
- shortcut registration, collision failure, repeated-stop idempotence, and disposal;
- the SCREEN-2 shortcut hint;
- generated JianShan black/white settings and rejection of duplicate conflicting TOML keys;
- exact PID/start identity, SCREEN-3 bounds, maximize/topmost flags, interactive window styles, and
  bounded window discovery;
- reverse-order exact-identity cleanup;
- package manifest creation and rejection of missing, extra, changed, duplicate, absolute, or
  escaping paths.

Verification then runs typecheck, lint, the complete existing automated test suite, and the
production Electron build. The final receipt records the new Electron bundle byte size and SHA-256
alongside all packaged artifact identities. JianShan source is unchanged, so this work does not
claim a new JianShan build or substitute new Cargo results for the existing identified candidate.

## Attended acceptance

On the current exhibition computer and then on the Mini PC:

1. Copy the package and obtain a clean `Verify-Deployment.ps1` result.
2. Configure and confirm the three displays.
3. Start once and observe automatic rehearsal start without pressing the Start button.
4. Confirm JianShan is on C/SCREEN-3, maximized, topmost, black-background/white-bird, with a visible
   pointer and working click input.
5. Confirm long JanVim writeback, cursor plucks, camera-driven flock movement, and flock wind.
6. Press `Ctrl+Shift+S` while JianShan has focus; confirm normal shutdown, joint fade, and no revival.
7. Reboot the Mini PC and repeat a normal start.

The acceptance record reports only this attended scope. It must not claim offline, forced recovery,
HP performance, hot-plug recovery, or unattended endurance.

## Rollback and preservation

The deployment package is assembled in a new external versioned directory and installed into a new
fixed destination. It does not overwrite the existing exhibition fallback, the immutable JanVim
artifact, the JianShan HP fallback, or previous rehearsal evidence. If deployment acceptance fails,
staff can stop or reboot the machine and return to the previously preserved manual-start package.
