# G4 Soft Display Routing Implementation Receipt

Recorded: 2026-09-05 (Asia/Shanghai)

## Status

Automated implementation, verification, and the available human G4 monitor-display checks are
complete. The durable evidence remains explicitly classified `monitor-simulation` with
`physicalProjectorsTested: false`; venue projector calibration and physical-projector acceptance
are still a separate deployment activity. The accepted P0 exhibition fallback remains unchanged
in its separate worktree.

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
- Tested implementation HEAD: `ff1680175d4d3e2668a5c8859daac9e4bda5e2e2`
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
| Electron main bundle | 526,622 | `acbe557eb15c3ffa32f936ed8e74a2a6e0d3284508a95f56c6ef71e856eb9bd0` |
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
| `npm test` | exit 0; 55 files and 982 tests passed |
| `npm run build` | exit 0; bundle identity matched the table above |
| `pwsh -NoProfile -File .\scripts\run-lua-tests.ps1` | exit 0 |
| `pwsh -NoProfile -File .\scripts\verify-runtime.ps1` | exit 0 |
| `git diff --check` | exit 0 |

The final full Vitest run started at 02:07:04 local time on 2026-09-05 and completed in 700.00
seconds. After the review-only assertion strengthening, its focused integration test, typecheck,
lint, and `git diff --check` all passed again.

## Final branch review

The initial branch-wide review found and closed the empty Windows display-label mismatch in
`8ce5152`. Human single-display rehearsal then exposed two bounded defects: JanVim placement could
cover the Start surface before READY, and the strict PowerShell terminal validator unwrapped the
single `SCREEN-1` expectation under StrictMode and returned incident code 70 after an otherwise
successful run. Both defects were reproduced by deterministic failing tests and fixed in
`ff168017` without adding a timer, retry, API, role inference, or production-3 state.

A final independent read-only review reported no Critical production finding. Its only Important
test-quality finding required proving that the READY event exists before comparing READY/show
ordering; that assertion was strengthened and its focused test passed. No Critical or Important
finding remains open.

## Copy-safe operator commands

Run each command as one physical line in PowerShell 7. Do not reuse a root after ValidateOnly or
Show. The configurator must be run again with a fresh root for every controller invocation.

Set the fixed paths once:

```powershell
$repo='D:\github\JanVim-Exhibition-2026\.worktrees\g4-soft-display-routing'; $parent='D:\VirtualData\JanVim-Exhibition-Rehearsals'
```

Select the reviewed long-form exhibition profile before preparing rehearsal roots. This is an
explicit operator action; the live loop still remains deterministic and offline:

```powershell
& pwsh -NoProfile -File "$repo\scripts\select-show-profile.ps1" -Profile songfeng-source; if($LASTEXITCODE -ne 0){throw ('profile-selection-failed-'+$LASTEXITCODE)}
```

Create one fresh root and open the manual GUI (works for either three-display production or
exactly-one-display preview; choose only the mode enabled by the actual topology):

```powershell
$runId=('g4-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)); $root=Join-Path $parent $runId; $map=Join-Path $root 'display-map.json'; & pwsh -NoProfile -File "$repo\scripts\configure-displays.ps1" -RehearsalRoot $root -DisplayMapPath $map; if($LASTEXITCODE -ne 0){throw ('display-configuration-failed-'+$LASTEXITCODE)}
```

Save publishes only the confirmed map. Close the configurator after Save, then invoke ValidateOnly
or Show explicitly; the configurator never auto-starts the artwork.

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

## Returned human G4 monitor-display acceptance

The operator returned a passing visual result for every available required check:

1. Three identify cards were visible and SCREEN-1/2/3 were explicitly assigned. JanVim,
   Narrative, and `见山 / STANDBY` then appeared simultaneously.
2. `g4-topology-retry-20260904-133943-065-53a8d18f` recorded one intentional
   `emergency-display-topology-changed` stop, `topologyStopped: true`, an exact poem reset, and no
   restart loop after SCREEN-3 was disconnected.
3. `g4-remap-restart-20260904-135842-816-c87ebb84` recorded the fresh manual remap/restart, 15
   completed loops, zero reset mismatch, `operator-stop`, and no incident.
4. `g4-single-preview-soak3-20260904-151057-786-d054ce72` visibly completed three JanVim-only
   preview loops. Its controller terminal was successful; the old launcher then wrote
   `show-run-evidence-invalid` because of the StrictMode single-element defect fixed in
   `ff168017`. The frozen evidence validates under the fixed validator, and the new launcher
   regression test passes. The preview remains non-physical by contract.
5. `g4-final-offline-s-20260904-234511037-ccbccb83` passed exactly three production loops with
   five offline samples, zero online samples, zero reset mismatch, no incident, and
   `acceptanceOutcome: "pass"`.
6. `g4-final-recovery-f-20260904-234511037-ccbccb83` passed one exact-identity JanVim failure,
   one bounded recovery, three retained post-recovery loops, seven offline samples, zero online
   samples, zero reset mismatch, a clean operator stop, and no incident. The operator confirmed
   that JanVim rebuilt once, both companion surfaces remained safe, the original poem returned,
   and no desktop/terminal exposure or duplicate write-back occurred.

No fourth display was available, so the optional unassigned-extra-display observation was not
exercised. Correct final status: **G4 implementation and monitor-display acceptance complete;
physical-projector deployment acceptance pending**.
