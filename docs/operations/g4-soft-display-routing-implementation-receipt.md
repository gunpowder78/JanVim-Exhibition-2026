# G4 Soft Display Routing Implementation Receipt

Recorded: 2026-09-04 (Asia/Shanghai)

## Status

Automated implementation and verification are complete. Human G4 acceptance is still pending and
must not be inferred from this receipt. The accepted P0 exhibition fallback remains unchanged in
its separate worktree.

G4 implements one technician-owned routing boundary:

- `production-3`: explicitly bind SCREEN-1 to JanVim, SCREEN-2 to Narrative, and SCREEN-3 to the
  local `见山 / STANDBY` surface.
- `single-display-preview`: exactly one connected display may be explicitly bound to SCREEN-1;
  SCREEN-2 and SCREEN-3 are visibly skipped and the run cannot count as physical acceptance.
- Two connected displays are deliberately configuration-required. More than three are allowed,
  but only explicitly assigned displays participate in the show and bounded extras are ignored.
- Connector, display ID, DPI, geometry, or rotation changes are corrected by manually running the
  configurator against a fresh evidence root. Roles are never guessed.
- A change to an assigned display during Show causes one bounded reset/shutdown and no automatic
  remap or restart loop. Changes only to unassigned extra displays do not interrupt the show.

## Verified source state

- Branch: `feat/g4-soft-display-routing`
- Tested implementation HEAD: `8ce51523de7ff467556c0264540f44100723b579`
- Base/accepted P0 HEAD: `d79a929b77e8c4e3a3a8d81ca55404617459afbe`
- Final changed paths from P0, including this receipt: 63
- Tested code commit: no pending production or test changes; only this receipt/checklist remained
- P0 fallback worktree: clean and still exactly at the base HEAD above

The 63 changed paths are:

```text
.gitattributes
apps/controller/package.json
apps/controller/src/display-config-command.ts
apps/controller/src/display-config-ipc-contract.ts
apps/controller/src/display-config-preload-entry.ts
apps/controller/src/display-config-preload.ts
apps/controller/src/display-configurator.ts
apps/controller/src/display-router.ts
apps/controller/src/display-routing-contract.ts
apps/controller/src/display-topology-guard.ts
apps/controller/src/electron-main.ts
apps/controller/src/g2-runtime-adapters.ts
apps/controller/src/main.ts
apps/controller/src/runtime-adapter-common.ts
apps/controller/src/show-command.ts
apps/controller/src/show-electron-command.ts
apps/controller/src/show-run-coordinator.ts
apps/controller/src/show-run-evidence.ts
apps/controller/src/show-runtime-adapters.ts
apps/controller/src/show-surface-group.ts
apps/controller/tests/controller-main.test.ts
apps/controller/tests/display-config-command.test.ts
apps/controller/tests/display-config-preload.test.ts
apps/controller/tests/display-configurator.test.ts
apps/controller/tests/display-router.test.ts
apps/controller/tests/display-routing-contract.test.ts
apps/controller/tests/display-topology-guard.test.ts
apps/controller/tests/g2-runtime-adapters.test.ts
apps/controller/tests/runtime-adapter-common.test.ts
apps/controller/tests/show-command.test.ts
apps/controller/tests/show-electron-command.test.ts
apps/controller/tests/show-run-coordinator.test.ts
apps/controller/tests/show-run-evidence.test.ts
apps/controller/tests/show-runtime-adapters.test.ts
apps/controller/tests/show-surface-group.test.ts
apps/controller/vite.display-config-preload.config.ts
apps/display-configurator/identify.html
apps/display-configurator/index.html
apps/display-configurator/package.json
apps/display-configurator/src/identify.ts
apps/display-configurator/src/main.ts
apps/display-configurator/src/model.ts
apps/display-configurator/src/styles.css
apps/display-configurator/src/vite-env.d.ts
apps/display-configurator/tests/model.test.ts
apps/display-configurator/tsconfig.json
apps/display-configurator/vite.config.ts
docs/operations/g4-soft-display-routing-implementation-receipt.md
docs/operations/rehearsal-runbook.md
docs/superpowers/plans/2026-09-04-g4-soft-display-routing.md
docs/superpowers/specs/2026-09-04-g4-soft-display-routing-design.md
package-lock.json
package.json
scripts/configure-displays.ps1
scripts/start-show.ps1
show/display-layout.json
show/jianshan-standby.html
show/preview-safe.html
tests/configure-displays.test.ts
tests/electron-build-smoke.test.ts
tests/recovery.test.ts
tests/start-show.test.ts
tsconfig.json
```

## Immutable/generated identities

| Item | Bytes | SHA-256 |
| --- | ---: | --- |
| Electron main bundle | 526,566 | `e4ee50d699c7212799760830993d6c37f9706892d4614b76e1e0f10d97f8d43a` |
| Electron 44 executable | 244,440,576 | `1dc2d12e5c60341782e68c4b65a8e49cbd86217f81568f90575547cec13b5610` |
| JanVim core | 18,869,248 | `3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54` |
| Logical display layout | 484 | `469002e89b3ed6b0357b082520efd01f2f4626a480c996faa61fb61bef97ef9b` |

JanVim remains the immutable packaged artifact tagged `v0.10.1-gmk.4.punctuation.2` at product
commit `abbd5a5b942b202e7fe4324bcd3ddab47c672cb9`; no JanVim product source was modified.

## Fresh automated verification

All commands ran from the G4 worktree after a fresh `npm ci` and exact local restoration of the
ignored Electron runtime:

| Gate | Result |
| --- | --- |
| `npm ci` | exit 0; 184 packages installed |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | exit 0; 55 files and 980 tests passed |
| `npm run build` | exit 0; bundle identity matched the table above |
| `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1` | exit 0 |
| `pwsh -NoProfile -File .\scripts\verify-runtime.ps1` | exit 0 |
| `git diff --check` | exit 0 |

The final post-review Vitest run started at 14:14:18 local time and completed in 659.90 seconds.
The focused Task 5 regression before branch review passed 337/337 tests across five files.

## Final branch review

An independent read-only review reported no Critical findings. It reported one Important finding:
Windows/Electron may supply an empty display label, which the TypeScript contract and GUI accepted
but the PowerShell launcher rejected. The issue was reproduced by a failing launcher test, fixed
without loosening display-ID, byte, or control-character constraints, and committed as
`8ce5152 fix: accept empty Windows display labels`. The new focused test and the complete 980-test
suite pass. No Critical or Important review finding remains open.

## Copy-safe operator commands

Run each command as one physical line in PowerShell 7. Do not reuse a root after ValidateOnly or
Show. The configurator must be run again with a fresh root for every controller invocation.

Set the fixed paths once:

```powershell
$repo='D:\github\JanVim-Exhibition-2026\.worktrees\g4-soft-display-routing'; $parent='D:\VirtualData\JanVim-Exhibition-Rehearsals'
```

Create one fresh root and open the manual GUI (works for either three-display production or
exactly-one-display preview; choose only the mode enabled by the actual topology):

```powershell
$runId=('g4-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)); $root=Join-Path $parent $runId; $map=Join-Path $root 'display-map.json'; & pwsh -NoProfile -File "$repo\scripts\configure-displays.ps1" -RehearsalRoot $root -DisplayMapPath $map; if($LASTEXITCODE -ne 0){throw ('display-configuration-failed-'+$LASTEXITCODE)}
```

Validate the currently configured fresh root while physically offline:

```powershell
& pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode ValidateOnly -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired; if($LASTEXITCODE -ne 0){throw ('validate-only-failed-'+$LASTEXITCODE)}
```

Production Show: run the fresh-root GUI command again, explicitly save `production-3`, then run:

```powershell
& pwsh -NoProfile -File "$repo\scripts\start-show.ps1" -Mode Show -RehearsalRoot $root -DisplayMapPath $map -RunId $runId -NetworkPolicy OfflineRequired; if($LASTEXITCODE -ne 0){throw ('show-failed-'+$LASTEXITCODE)}
```

Single-display preview: leave exactly one display connected, run the fresh-root GUI command again,
explicitly save `single-display-preview`, then use the same Show command above. It must expose only
JanVim after Start and must report `acceptanceScope: "single-display-preview"`.

Retrieve bounded terminal/evidence receipts after the launcher exits:

```powershell
Get-Content -Raw -LiteralPath (Join-Path $root 'controller-terminal.json'); if(Test-Path -LiteralPath (Join-Path $root 'show-run.json')){Get-Content -Raw -LiteralPath (Join-Path $root 'show-run.json')}; if(Test-Path -LiteralPath (Join-Path $root 'controller-incident.json')){Get-Content -Raw -LiteralPath (Join-Path $root 'controller-incident.json')}
```

Stop is deliberately not implemented as an external PID-kill command. Click `Stop Show` once on
the Narrative surface; if that surface is unavailable, press Ctrl+C once in the launcher terminal
and allow the controller's bounded cleanup path to finish.

## Human G4 acceptance still required

Use fresh roots and perform these as separate, operator-observed checks:

1. Three numbered identify cards appear; the technician explicitly assigns all three roles.
2. JanVim, Narrative, and `见山 / STANDBY` appear simultaneously on their assigned displays.
3. If an extra display is available, leaving it unassigned does not interrupt the show.
4. One assigned display geometry/DPI/rotation/disconnect change causes one safe stop and no
   restart loop; a fresh manual map then permits a clean restart.
5. Exactly one connected display permits JanVim-only preview and never claims physical acceptance.
6. A production run passes while physically offline.
7. One exact-identity forced JanVim failure rebuilds JanVim, restores the original poem, and
   completes two new loops without exposing a desktop/terminal or duplicating write-back.

Until those observations and receipts are returned, the correct status is: **implementation
verified; G4 physical acceptance pending**.
