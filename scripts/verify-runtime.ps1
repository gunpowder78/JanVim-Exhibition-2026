[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ExpectedTag = 'v0.10.1-gmk.4'
$ExpectedCommit = 'e95633101d93f8448b0f906e918b5d836ab95273'
$ExpectedSourceRepository = 'D:/github/JanVim'
$ExpectedProvenanceRepository = 'https://github.com/gunpowder78/JanVim.git'
$ExpectedArchive = 'JanVim-win-x64.zip'
$ExpectedChecksum = 'JanVim-win-x64.zip.sha256'
$ExpectedProvenanceRecord = 'JanVim-win-x64.provenance.json'
$ExpectedBuildLog = 'JanVim-win-x64.build.log'
$ExpectedCiReference = 'https://github.com/gunpowder78/JanVim/actions/runs/31381575434#artifact-9060808838'
$HashPattern = '^[0-9a-f]{64}$'
$MinimumCoreBytes = [long]1048576

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Assert-RequiredFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw $Reason
    }
}

function Get-RequiredProperty {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$ReasonPrefix
    )

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) {
        throw "$ReasonPrefix-field-missing:$Name"
    }
    return $property.Value
}

function Assert-PropertySet {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $actual = @($InputObject.PSObject.Properties.Name | Sort-Object)
    $expected = @($ExpectedNames | Sort-Object)
    if (($actual -join "`n") -cne ($expected -join "`n")) {
        throw $Reason
    }
}

function Assert-ExactProperty {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object]$Expected,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$ReasonPrefix
    )

    $actual = Get-RequiredProperty -InputObject $InputObject -Name $Name -ReasonPrefix $ReasonPrefix
    if ($actual -is [string] -and $Expected -is [string]) {
        if ($actual -cne $Expected) {
            throw $Reason
        }
    }
    elseif ($actual -ne $Expected) {
        throw $Reason
    }
}

function Assert-HashValue {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Value -isnot [string] -or $Value -cnotmatch $HashPattern) {
        throw "hash-format-invalid:$Name"
    }
    return [string]$Value
}

function Assert-PositiveInteger {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if ($Value -isnot [byte] -and
        $Value -isnot [int16] -and
        $Value -isnot [int32] -and
        $Value -isnot [int64]) {
        throw "lock-integer-invalid:$Name"
    }
    $converted = [long]$Value
    if ($converted -lt 1) {
        throw "lock-integer-invalid:$Name"
    }
    return $converted
}

function Get-TomlStringValue {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Section,
        [Parameter(Mandatory = $true)][string]$Key,
        [switch]$Required
    )

    $activeSection = ''
    $values = [System.Collections.Generic.List[string]]::new()
    $keyPattern = '^\s*' + [regex]::Escape($Key) + '\s*=\s*"([^"]*)"\s*(?:#.*)?$'
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match '^\s*\[([A-Za-z0-9_-]+)\]\s*(?:#.*)?$') {
            $activeSection = $Matches[1]
            continue
        }
        if ($activeSection -ceq $Section -and $line -match $keyPattern) {
            $values.Add($Matches[1])
        }
    }
    if ($values.Count -gt 1) {
        throw "show-config-duplicate:$Section.$Key"
    }
    if ($values.Count -eq 0) {
        if ($Required) {
            throw "show-config-field-missing:$Section.$Key"
        }
        return $null
    }
    return $values[0]
}

function Assert-ShowConfigContract {
    param(
        [Parameter(Mandatory = $true)][string]$ConfigPath,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$LayoutEngine
    )

    $text = [System.IO.File]::ReadAllText($ConfigPath)
    if ($text -match '(?m)^\s*(schema|mode|network|layout_engine|artifact_lock|runtime_root|private_user_root|source_writes)\s*=') {
        throw 'show-config-not-janvim-config'
    }
    $engine = Get-TomlStringValue -Path $ConfigPath -Section 'layout' -Key 'engine' -Required
    if ($engine -notin @('dynamic', 'orthogonal')) {
        throw 'show-layout-unconfirmed'
    }
    if ($engine -cne $LayoutEngine) {
        throw 'show-layout-lock-mismatch'
    }
    $startupProfile = Get-TomlStringValue -Path $ConfigPath -Section 'neovim' -Key 'startup_profile' -Required
    if ($startupProfile -cne 'plugin-lab') {
        throw 'show-neovim-profile-mismatch'
    }

    $dynamicProfile = Get-TomlStringValue -Path $ConfigPath -Section 'layout' -Key 'dynamic_profile'
    if ($engine -ceq 'dynamic') {
        if ([string]::IsNullOrWhiteSpace($dynamicProfile)) {
            throw 'show-dynamic-profile-missing'
        }
        $resolvedProfile = [System.IO.Path]::GetFullPath(
            (Join-Path (Split-Path -Parent $ConfigPath) $dynamicProfile)
        )
        $expectedProfile = [System.IO.Path]::GetFullPath(
            (Join-Path $RuntimeRoot 'assets\layout-profiles\computer-mixed.toml')
        )
        if ($resolvedProfile -cne $expectedProfile) {
            throw 'show-dynamic-profile-path-mismatch'
        }
        Assert-RequiredFile -Path $expectedProfile -Reason 'show-dynamic-profile-missing'
    }
    elseif ($null -ne $dynamicProfile) {
        throw 'show-orthogonal-profile-conflict'
    }

    $repositoryBoundary = $RepositoryRoot.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    $configFullPath = [System.IO.Path]::GetFullPath($ConfigPath)
    if (-not $configFullPath.StartsWith($repositoryBoundary, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'show-config-outside-repository'
    }
}

function Read-JsonObject {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    try {
        $value = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 16
    }
    catch {
        throw $Reason
    }
    if ($null -eq $value -or $value -is [System.Array]) {
        throw $Reason
    }
    return $value
}

function Assert-BuildEvidenceContent {
    param([Parameter(Mandatory = $true)][string]$Path)

    $evidenceText = Get-Content -Raw -LiteralPath $Path
    if ($evidenceText -notmatch [regex]::Escape("JANVIM_SOURCE_TAG=$ExpectedTag") -or
        $evidenceText -notmatch [regex]::Escape("JANVIM_SOURCE_COMMIT=$ExpectedCommit")) {
        throw 'build-evidence-source-identity-missing'
    }
    foreach ($requiredBuildStep in @(
        'cargo-fmt',
        'cargo-test',
        'cargo-clippy',
        'guard-deps',
        'package-windows'
    )) {
        if ($evidenceText -notmatch [regex]::Escape("JANVIM_BUILD_STEP_OK=$requiredBuildStep")) {
            throw "build-evidence-step-missing:$requiredBuildStep"
        }
    }
}

function Assert-ProvenanceRecord {
    param(
        [Parameter(Mandatory = $true)][object]$Record,
        [Parameter(Mandatory = $true)][object]$Lock
    )

    $propertyNames = @(
        'schema',
        'kind',
        'sourceRepository',
        'tag',
        'commit',
        'archive',
        'archiveBytes',
        'archiveSha256',
        'checksumSha256',
        'coreSha256',
        'runtimeLuaSha256',
        'artifactConfigSha256',
        'evidenceReference'
    )
    Assert-PropertySet -InputObject $Record -ExpectedNames $propertyNames -Reason 'provenance-fields-invalid'
    Assert-ExactProperty -InputObject $Record -Name 'schema' -Expected 1 -Reason 'provenance-schema-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'sourceRepository' -Expected $ExpectedProvenanceRepository -Reason 'provenance-repository-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'tag' -Expected $ExpectedTag -Reason 'provenance-tag-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'commit' -Expected $ExpectedCommit -Reason 'provenance-commit-mismatch' -ReasonPrefix 'provenance'
    Assert-ExactProperty -InputObject $Record -Name 'archive' -Expected $ExpectedArchive -Reason 'provenance-archive-mismatch' -ReasonPrefix 'provenance'

    $kind = [string](Get-RequiredProperty -InputObject $Record -Name 'kind' -ReasonPrefix 'provenance')
    if ($kind -notin @('preserved-ci-artifact', 'verified-portable-directory', 'isolated-tag-rebuild')) {
        throw 'provenance-kind-invalid'
    }
    Assert-ExactProperty -InputObject $Lock -Name 'provenanceKind' -Expected $kind -Reason 'provenance-kind-lock-mismatch' -ReasonPrefix 'lock'
    $reference = Get-RequiredProperty -InputObject $Record -Name 'evidenceReference' -ReasonPrefix 'provenance'
    if ($reference -isnot [string] -or $reference.Length -lt 8 -or $reference.Length -gt 512) {
        throw 'provenance-reference-invalid'
    }
    if ($kind -ceq 'preserved-ci-artifact' -and $reference -cne $ExpectedCiReference) {
        throw 'provenance-ci-reference-mismatch'
    }
    Assert-ExactProperty -InputObject $Lock -Name 'provenanceReference' -Expected $reference -Reason 'provenance-reference-lock-mismatch' -ReasonPrefix 'lock'

    foreach ($mapping in @(
        @('archiveSha256', 'archiveSha256'),
        @('checksumSha256', 'checksumSha256'),
        @('coreSha256', 'coreSha256'),
        @('runtimeLuaSha256', 'runtimeLuaSha256'),
        @('artifactConfigSha256', 'artifactConfigSha256')
    )) {
        $recordHash = Assert-HashValue -Value (Get-RequiredProperty -InputObject $Record -Name $mapping[0] -ReasonPrefix 'provenance') -Name "provenance.$($mapping[0])"
        $lockHash = Get-RequiredProperty -InputObject $Lock -Name $mapping[1] -ReasonPrefix 'lock'
        if ($recordHash -cne $lockHash) {
            throw "provenance-$($mapping[0])-lock-mismatch"
        }
    }
    $recordBytes = Assert-PositiveInteger -Value (Get-RequiredProperty -InputObject $Record -Name 'archiveBytes' -ReasonPrefix 'provenance') -Name 'provenance.archiveBytes'
    $lockBytes = Assert-PositiveInteger -Value (Get-RequiredProperty -InputObject $Lock -Name 'archiveBytes' -ReasonPrefix 'lock') -Name 'archiveBytes'
    if ($recordBytes -ne $lockBytes) {
        throw 'provenance-archive-size-lock-mismatch'
    }
}

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$markerPath = Join-Path $repositoryRoot 'AGENTS.md'
Assert-RequiredFile -Path $markerPath -Reason 'exhibition-repository-marker-missing'
if ((Get-Content -Raw -LiteralPath $markerPath) -notmatch 'JanVim Exhibition 2026') {
    throw 'exhibition-repository-marker-invalid'
}

$runtimeRoot = Join-Path $repositoryRoot 'runtime\janvim'
$lockPath = Join-Path $repositoryRoot 'janvim-artifact.lock.json'
$showConfigPath = Join-Path $repositoryRoot 'show\janvim-show.toml'
$archivePath = Join-Path $runtimeRoot $ExpectedArchive
$checksumPath = Join-Path $runtimeRoot $ExpectedChecksum
$corePath = Join-Path $runtimeRoot 'janvim-core.exe'
$runtimeLuaPath = Join-Path $runtimeRoot 'runtime\lua\janvim.lua'
$artifactConfigPath = Join-Path $runtimeRoot 'assets\config.toml'
$watchdogPath = Join-Path $runtimeRoot 'janvim-watchdog.exe'
$bundledNvimPath = Join-Path $runtimeRoot 'nvim-win64\bin\nvim.exe'
$provenancePath = Join-Path $runtimeRoot $ExpectedProvenanceRecord
$pluginLabConfigPath = Join-Path $repositoryRoot 'runtime\user-root\plugin-lab\config\init.lua'

Assert-RequiredFile -Path $lockPath -Reason 'artifact-lock-missing'
Assert-RequiredFile -Path $corePath -Reason 'janvim-core-missing'
Assert-RequiredFile -Path $runtimeLuaPath -Reason 'runtime-lua-missing'
Assert-RequiredFile -Path $artifactConfigPath -Reason 'artifact-config-missing'
Assert-RequiredFile -Path $showConfigPath -Reason 'show-config-missing'
Assert-RequiredFile -Path $archivePath -Reason 'runtime-archive-missing'
Assert-RequiredFile -Path $checksumPath -Reason 'runtime-checksum-missing'
Assert-RequiredFile -Path $provenancePath -Reason 'runtime-provenance-missing'
Assert-RequiredFile -Path $watchdogPath -Reason 'runtime-watchdog-missing'
Assert-RequiredFile -Path $bundledNvimPath -Reason 'runtime-bundled-nvim-missing'
Assert-RequiredFile -Path $pluginLabConfigPath -Reason 'plugin-lab-config-missing'

$lock = Read-JsonObject -Path $lockPath -Reason 'artifact-lock-invalid-json'
$lockPropertyNames = @(
    'schema',
    'sourceRepository',
    'tag',
    'commit',
    'archive',
    'archiveBytes',
    'archiveSha256',
    'checksum',
    'checksumSha256',
    'core',
    'coreBytes',
    'coreSha256',
    'runtimeLua',
    'runtimeLuaSha256',
    'artifactConfig',
    'artifactConfigSha256',
    'config',
    'configSha256',
    'layoutEngine',
    'role',
    'provenanceKind',
    'provenanceReference',
    'provenanceRecord',
    'provenanceSha256',
    'evidenceRecord',
    'evidenceSha256',
    'pluginLabConfig',
    'pluginLabConfigSha256'
)
Assert-PropertySet -InputObject $lock -ExpectedNames $lockPropertyNames -Reason 'artifact-lock-fields-invalid'
Assert-ExactProperty -InputObject $lock -Name 'schema' -Expected 1 -Reason 'lock-schema-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'sourceRepository' -Expected $ExpectedSourceRepository -Reason 'lock-repository-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'tag' -Expected $ExpectedTag -Reason 'lock-tag-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'commit' -Expected $ExpectedCommit -Reason 'lock-commit-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'archive' -Expected $ExpectedArchive -Reason 'lock-archive-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'checksum' -Expected $ExpectedChecksum -Reason 'lock-checksum-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'core' -Expected 'janvim-core.exe' -Reason 'lock-core-path-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'runtimeLua' -Expected 'runtime/lua/janvim.lua' -Reason 'lock-runtime-lua-path-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'artifactConfig' -Expected 'assets/config.toml' -Reason 'lock-artifact-config-path-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'config' -Expected 'show/janvim-show.toml' -Reason 'lock-show-config-path-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'role' -Expected 'primary-projector' -Reason 'lock-role-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'provenanceRecord' -Expected $ExpectedProvenanceRecord -Reason 'lock-provenance-path-mismatch' -ReasonPrefix 'lock'
Assert-ExactProperty -InputObject $lock -Name 'pluginLabConfig' -Expected 'runtime/user-root/plugin-lab/config/init.lua' -Reason 'lock-plugin-lab-config-path-mismatch' -ReasonPrefix 'lock'

$layoutEngine = [string](Get-RequiredProperty -InputObject $lock -Name 'layoutEngine' -ReasonPrefix 'lock')
if ($layoutEngine -notin @('dynamic', 'orthogonal')) {
    throw 'lock-layout-engine-invalid'
}
$provenanceKind = [string](Get-RequiredProperty -InputObject $lock -Name 'provenanceKind' -ReasonPrefix 'lock')
if ($provenanceKind -notin @('preserved-ci-artifact', 'verified-portable-directory', 'isolated-tag-rebuild')) {
    throw 'lock-provenance-kind-invalid'
}
$evidenceRecord = [string](Get-RequiredProperty -InputObject $lock -Name 'evidenceRecord' -ReasonPrefix 'lock')
if ($provenanceKind -ceq 'preserved-ci-artifact') {
    if ($evidenceRecord -cne $ExpectedProvenanceRecord) {
        throw 'lock-evidence-path-mismatch'
    }
}
elseif ($evidenceRecord -cne $ExpectedBuildLog) {
    throw 'lock-evidence-path-mismatch'
}
$evidencePath = Join-Path $runtimeRoot $evidenceRecord
Assert-RequiredFile -Path $evidencePath -Reason 'build-evidence-missing'

$hashFields = @(
    'archiveSha256',
    'checksumSha256',
    'coreSha256',
    'runtimeLuaSha256',
    'artifactConfigSha256',
    'configSha256',
    'provenanceSha256',
    'evidenceSha256',
    'pluginLabConfigSha256'
)
$lockedHashes = @{}
foreach ($field in $hashFields) {
    $lockedHashes[$field] = Assert-HashValue -Value (Get-RequiredProperty -InputObject $lock -Name $field -ReasonPrefix 'lock') -Name $field
}

$archiveBytes = Assert-PositiveInteger -Value (Get-RequiredProperty -InputObject $lock -Name 'archiveBytes' -ReasonPrefix 'lock') -Name 'archiveBytes'
$coreBytes = Assert-PositiveInteger -Value (Get-RequiredProperty -InputObject $lock -Name 'coreBytes' -ReasonPrefix 'lock') -Name 'coreBytes'
if ($coreBytes -lt $MinimumCoreBytes) {
    throw 'core-too-small'
}
if ((Get-Item -LiteralPath $archivePath).Length -ne $archiveBytes) {
    throw 'archive-size-mismatch'
}
if ((Get-Item -LiteralPath $corePath).Length -ne $coreBytes) {
    throw 'core-size-mismatch'
}

Assert-ShowConfigContract -ConfigPath $showConfigPath -RepositoryRoot $repositoryRoot -RuntimeRoot $runtimeRoot -LayoutEngine $layoutEngine

$actualHashChecks = @(
    @($archivePath, 'archiveSha256', 'archive-hash-mismatch'),
    @($checksumPath, 'checksumSha256', 'checksum-hash-mismatch'),
    @($corePath, 'coreSha256', 'core-hash-mismatch'),
    @($runtimeLuaPath, 'runtimeLuaSha256', 'runtime-lua-hash-mismatch'),
    @($artifactConfigPath, 'artifactConfigSha256', 'artifact-config-hash-mismatch'),
    @($showConfigPath, 'configSha256', 'show-config-hash-mismatch'),
    @($provenancePath, 'provenanceSha256', 'provenance-hash-mismatch'),
    @($evidencePath, 'evidenceSha256', 'build-evidence-hash-mismatch'),
    @($pluginLabConfigPath, 'pluginLabConfigSha256', 'plugin-lab-config-hash-mismatch')
)
foreach ($check in $actualHashChecks) {
    if ((Get-Sha256Hex -Path $check[0]) -cne $lockedHashes[$check[1]]) {
        throw $check[2]
    }
}

$checksumLine = (Get-Content -Raw -LiteralPath $checksumPath).Trim()
if ($checksumLine -cnotmatch '^([0-9a-f]{64})  JanVim-win-x64\.zip$') {
    throw 'archive-checksum-format-invalid'
}
if ($Matches[1] -cne $lockedHashes['archiveSha256']) {
    throw 'archive-checksum-mismatch'
}

$provenance = Read-JsonObject -Path $provenancePath -Reason 'provenance-invalid-json'
Assert-ProvenanceRecord -Record $provenance -Lock $lock
if ($provenanceKind -ceq 'preserved-ci-artifact') {
    if ($lockedHashes['evidenceSha256'] -cne $lockedHashes['provenanceSha256']) {
        throw 'ci-evidence-hash-mismatch'
    }
}
elseif ([string]$provenance.evidenceReference -cne "build-log-sha256:$($lockedHashes['evidenceSha256'])") {
    throw 'build-evidence-hash-mismatch'
}
else {
    Assert-BuildEvidenceContent -Path $evidencePath
}

$agentSourceRoot = Join-Path $repositoryRoot 'nvim\lua\janvim_exhibition'
$agentTargetRoot = Join-Path $repositoryRoot 'runtime\user-root\plugin-lab\local\janvim-exhibition\lua\janvim_exhibition'
if (-not (Test-Path -LiteralPath $agentSourceRoot -PathType Container)) {
    throw 'agent-source-missing'
}
foreach ($agentSourceFile in Get-ChildItem -LiteralPath $agentSourceRoot -File) {
    $agentTargetFile = Join-Path $agentTargetRoot $agentSourceFile.Name
    Assert-RequiredFile -Path $agentTargetFile -Reason "agent-runtime-file-missing:$($agentSourceFile.Name)"
    if ((Get-Sha256Hex -Path $agentSourceFile.FullName) -cne (Get-Sha256Hex -Path $agentTargetFile)) {
        throw "agent-runtime-hash-mismatch:$($agentSourceFile.Name)"
    }
}

[ordered]@{
    schema = 1
    status = 'runtime-verified'
    tag = $ExpectedTag
    commit = $ExpectedCommit
    archiveSha256 = $lockedHashes['archiveSha256']
    coreSha256 = $lockedHashes['coreSha256']
    configSha256 = $lockedHashes['configSha256']
    layoutEngine = $layoutEngine
} | ConvertTo-Json -Depth 4 -Compress
