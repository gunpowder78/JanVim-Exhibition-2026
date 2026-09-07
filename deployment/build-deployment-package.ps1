[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $SourceRoot,
    [Parameter(Mandatory = $true)][string] $JianShanCandidateRoot,
    [Parameter(Mandatory = $true)][string] $NodeExecutable,
    [Parameter(Mandatory = $true)][string] $OutputParent
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$fixedInstallRoot = 'D:\github\JanVim-Exhibition-Deploy'
$expectedNodeHash = '17347995af08dadcc73a1a154f0942559fbc3f37b9ba57d4576b4d2bcb2834a2'
$forbiddenDirectoryNames = @('.git', '.worktrees', '.operator', '.superpowers')
$forbiddenRunRootPattern = '^(?:deployment|deployment-package|display-config|joint-session|joint-show|joint-sound|joint-validate|sound)-\d{8}T\d{9}Z-[0-9a-f]{12}$'
$privateJsonStemPattern = '(?:^|[._-])(?:token|descriptor)(?=$|[._-])|(?:token|descriptor)$'
$forbiddenRuntimeNames = @(
    'active-deployment.json', 'flock-input.json', 'run-lease.json',
    'control.json', 'ready.json', 'session.json', 'summary.json'
)
$script:AllowedWorkspaceLinks = [Collections.Generic.Dictionary[string, string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)

function Resolve-BuilderPath {
    param([string] $Path, [string] $Reason)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Reason-invalid"
    }
    return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Assert-PlainItem {
    param([string] $Path, [ValidateSet('Leaf', 'Container')][string] $Kind, [string] $Reason)
    if (-not (Test-Path -LiteralPath $Path)) { throw "$Reason-missing" }
    $item = Get-Item -LiteralPath $Path -Force
    if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($Kind -ceq 'Leaf' -and $item.PSIsContainer) -or
        ($Kind -ceq 'Container' -and -not $item.PSIsContainer)
    ) { throw "$Reason-invalid" }
    return $item
}

function Assert-PlainTree {
    param([string] $Path)
    [void](Assert-PlainItem -Path $Path -Kind Container -Reason 'copy-source')
    $pending = [Collections.Generic.Stack[string]]::new()
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in Get-ChildItem -LiteralPath $directory -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                $expectedTarget = $null
                if (-not $script:AllowedWorkspaceLinks.TryGetValue($item.FullName, [ref]$expectedTarget)) {
                    throw 'copy-source-reparse-rejected'
                }
                $actualTargets = @($item.Target)
                if (
                    $item.LinkType -cne 'Junction' -or
                    $actualTargets.Count -ne 1 -or
                    -not [IO.Path]::IsPathFullyQualified([string]$actualTargets[0])
                ) {
                    throw 'copy-source-reparse-rejected'
                }
                $actualTarget = [string]$actualTargets[0]
                if (-not [string]::Equals(
                    [IO.Path]::GetFullPath($actualTarget),
                    [IO.Path]::GetFullPath($expectedTarget),
                    [StringComparison]::OrdinalIgnoreCase
                )) {
                    throw 'copy-source-reparse-rejected'
                }
                continue
            }
            if ($item.PSIsContainer) {
                if (
                    $item.Name -iin $forbiddenDirectoryNames -or
                    $item.Name -imatch $forbiddenRunRootPattern
                ) {
                    throw 'runtime-private-directory-rejected'
                }
                $pending.Push($item.FullName)
                continue
            }
            if (
                $item.Name -iin $forbiddenRuntimeNames -or
                $item.Name -ieq 'jianshan-live.toml' -or
                $item.Name -ilike 'jianshan-live-*.toml' -or
                (
                    [IO.Path]::GetExtension($item.Name) -ieq '.json' -and
                    [IO.Path]::GetFileNameWithoutExtension($item.Name) -imatch $privateJsonStemPattern
                )
            ) {
                throw 'runtime-private-file-rejected'
            }
        }
    }
}

function Copy-PlainTree {
    param([string] $Source, [string] $Destination)
    Assert-PlainTree -Path $Source
    if (Test-Path -LiteralPath $Destination) { throw 'copy-destination-exists' }
    Copy-Item -LiteralPath $Source -Destination $Destination -Recurse
    Assert-PlainTree -Path $Destination
}

function Assert-Identity {
    param([string] $Path, [int64] $Bytes, [string] $Sha256, [string] $Reason)
    $item = Assert-PlainItem -Path $Path -Kind Leaf -Reason $Reason
    if ($item.Length -ne $Bytes -or (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() -cne $Sha256) {
        throw "$Reason-identity-mismatch"
    }
}

$source = Resolve-BuilderPath -Path $SourceRoot -Reason 'source-root'
$candidate = Resolve-BuilderPath -Path $JianShanCandidateRoot -Reason 'jianshan-candidate'
$node = Resolve-BuilderPath -Path $NodeExecutable -Reason 'node'
$output = Resolve-BuilderPath -Path $OutputParent -Reason 'output-parent'
[void](Assert-PlainItem -Path $source -Kind Container -Reason 'source-root')
[void](Assert-PlainItem -Path $candidate -Kind Container -Reason 'jianshan-candidate')
[void](Assert-PlainItem -Path $output -Kind Container -Reason 'output-parent')
$script:AllowedWorkspaceLinks.Add(
    (Join-Path $source 'node_modules\@janvim-exhibition\controller'),
    (Join-Path $source 'apps\controller')
)
$script:AllowedWorkspaceLinks.Add(
    (Join-Path $source 'node_modules\@janvim-exhibition\display-configurator'),
    (Join-Path $source 'apps\display-configurator')
)
$script:AllowedWorkspaceLinks.Add(
    (Join-Path $source 'node_modules\@janvim-exhibition\secondary-screen'),
    (Join-Path $source 'apps\secondary-screen')
)
$script:AllowedWorkspaceLinks.Add(
    (Join-Path $source 'node_modules\@janvim-exhibition\show-schema'),
    (Join-Path $source 'packages\show-schema')
)

$gitStatus = @(& git -C $source status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0 -or $gitStatus.Count -ne 0) { throw 'source-worktree-not-clean' }
$sourceCommit = (& git -C $source rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -cnotmatch '^[0-9a-f]{40}$') { throw 'source-commit-invalid' }

Assert-Identity -Path $node -Bytes 86988616 -Sha256 $expectedNodeHash -Reason 'node'
if ((& $node --version).Trim() -cne 'v22.23.0' -or $LASTEXITCODE -ne 0) { throw 'node-version-invalid' }
$nodeLicense = Join-Path ([IO.Path]::GetDirectoryName($node)) 'LICENSE'
Assert-Identity `
    -Path $nodeLicense -Bytes 148217 `
    -Sha256 '8cc9bb466b19fc7e7cc99d03e9df1132021fda8b01eea2624c58bb372dbef576' `
    -Reason 'node-license'

$candidateIdentities = @(
    @('jianshan-rust\jianshan.exe', 9799168, 'ac160b7eb4e34c52906b151aed441ea683ad093d89e59459b5ecb12c3055770f'),
    @('jianshan-rust\jianshan-flock-v1.toml', 6238, '510398aeff0f567bf351aa2ce025cbb6989a6865328115f726032549821a3fae'),
    @('public\models\hand_landmarker.task', 7819105, 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1')
)
foreach ($identity in $candidateIdentities) {
    Assert-Identity `
        -Path (Join-Path $candidate $identity[0]) `
        -Bytes ([int64]$identity[1]) `
        -Sha256 $identity[2] `
        -Reason 'jianshan-candidate'
}

$id = '{0}-{1}' -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N').Substring(0, 12)
$handoffRoot = Join-Path $output "deployment-package-$id"
$packageRoot = Join-Path $handoffRoot 'JanVim-Exhibition-Deploy'
$archivePath = Join-Path $handoffRoot 'JanVim-Exhibition-Deploy.zip'
$receiptPath = Join-Path $handoffRoot 'deployment-handoff.json'
if (Test-Path -LiteralPath $handoffRoot) { throw 'handoff-root-exists' }
[void](New-Item -ItemType Directory -Path $handoffRoot)
[void](New-Item -ItemType Directory -Path $packageRoot)

$appRoot = Join-Path $packageRoot 'app'
[void](New-Item -ItemType Directory -Path $appRoot)
$allowlist = @(
    'AGENTS.md', 'README.md', 'eslint.config.js', 'janvim-artifact.lock.json',
    'package.json', 'package-lock.json', 'tsconfig.json', 'apps', 'content',
    'docs', 'node_modules', 'nvim', 'packages', 'runtime', 'scripts', 'show', 'sound'
)
foreach ($relative in $allowlist) {
    $from = Join-Path $source $relative
    $to = Join-Path $appRoot $relative
    $item = Get-Item -LiteralPath $from -Force -ErrorAction Stop
    if ($item.PSIsContainer) { Copy-PlainTree -Source $from -Destination $to }
    else {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'copy-source-reparse-rejected' }
        Copy-Item -LiteralPath $from -Destination $to
    }
}

[void](New-Item -ItemType Directory -Path (Join-Path $packageRoot 'runtime'))
Copy-PlainTree -Source (Join-Path $candidate 'jianshan-rust') -Destination (Join-Path $packageRoot 'runtime\jianshan')
Copy-PlainTree -Source (Join-Path $candidate 'public') -Destination (Join-Path $packageRoot 'runtime\public')
[void](New-Item -ItemType Directory -Path (Join-Path $packageRoot 'tools\node') -Force)
Copy-Item -LiteralPath $node -Destination (Join-Path $packageRoot 'tools\node\node.exe')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $packageRoot 'tools\node\LICENSE')
Copy-PlainTree -Source (Join-Path $source 'deployment\operator') -Destination (Join-Path $packageRoot 'operator')
Copy-PlainTree -Source (Join-Path $source 'deployment\config') -Destination (Join-Path $packageRoot 'config')
Copy-PlainTree -Source (Join-Path $source 'deployment\docs') -Destination (Join-Path $packageRoot 'docs')
[void](New-Item -ItemType Directory -Path (Join-Path $packageRoot 'evidence'))

$electronPath = Join-Path $source 'apps\controller\dist\main\electron-main.js'
$electronItem = Get-Item -LiteralPath $electronPath
$electronHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $electronPath).Hash.ToLowerInvariant()
$artifactLockPath = Join-Path $source 'janvim-artifact.lock.json'
$artifactLock = Get-Content -LiteralPath $artifactLockPath -Raw | ConvertFrom-Json -NoEnumerate -DateKind String
$sourceEvidence = [ordered]@{
    schema = 1
    sourceCommit = $sourceCommit
    fixedInstallRoot = $fixedInstallRoot
    electronMain = [ordered]@{ bytes = $electronItem.Length; sha256 = $electronHash }
    jianshan = [ordered]@{ bytes = 9799168; sha256 = $candidateIdentities[0][2] }
    node = [ordered]@{ version = 'v22.23.0'; bytes = 86988616; sha256 = $expectedNodeHash }
}
[IO.File]::WriteAllText(
    (Join-Path $packageRoot 'evidence\source-identities.json'),
    (($sourceEvidence | ConvertTo-Json -Depth 8 -Compress) + "`n"),
    [Text.UTF8Encoding]::new($false)
)

$packageNode = Join-Path $packageRoot 'tools\node\node.exe'
$manifestTool = Join-Path $packageRoot 'operator\lib\package-manifest.mjs'
$manifestOutput = & $packageNode $manifestTool create --root $packageRoot
if ($LASTEXITCODE -ne 0) { throw 'package-manifest-create-failed' }
$manifest = $manifestOutput | ConvertFrom-Json -NoEnumerate -DateKind String
$verifyOutput = & $packageNode $manifestTool verify --root $packageRoot
if ($LASTEXITCODE -ne 0) { throw 'package-manifest-verify-failed' }
$verifiedManifest = $verifyOutput | ConvertFrom-Json -NoEnumerate -DateKind String
if ($verifiedManifest.manifestSha256 -cne $manifest.manifestSha256) { throw 'package-manifest-verify-failed' }

Compress-Archive -Path (Join-Path $packageRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
$archiveItem = Get-Item -LiteralPath $archivePath
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
$receipt = [ordered]@{
    schema = 1
    sourceCommit = $sourceCommit
    packageDirectory = $packageRoot
    archivePath = $archivePath
    manifest = [ordered]@{ bytes = $manifest.manifestBytes; sha256 = $manifest.manifestSha256 }
    archive = [ordered]@{ bytes = $archiveItem.Length; sha256 = $archiveHash }
    electronMain = [ordered]@{ bytes = $electronItem.Length; sha256 = $electronHash }
    janvimArtifact = [ordered]@{
        tag = $artifactLock.tag
        commit = $artifactLock.commit
        coreBytes = $artifactLock.coreBytes
        coreSha256 = $artifactLock.coreSha256
    }
    jianshan = [ordered]@{ bytes = 9799168; sha256 = $candidateIdentities[0][2] }
    node = [ordered]@{ version = 'v22.23.0'; bytes = 86988616; sha256 = $expectedNodeHash }
    acceptance = 'awaiting-mini-pc-attended-acceptance'
}
[IO.File]::WriteAllText(
    $receiptPath,
    (($receipt | ConvertTo-Json -Depth 8 -Compress) + "`n"),
    [Text.UTF8Encoding]::new($false)
)
[ordered]@{
    schema = 1
    status = 'deployment-package-built'
    handoffRoot = $handoffRoot
    packageDirectory = $packageRoot
    archivePath = $archivePath
    receiptPath = $receiptPath
    manifestSha256 = $manifest.manifestSha256
    archiveSha256 = $archiveHash
} | ConvertTo-Json -Compress
