[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ValidateOnly', 'Soak3', 'Show')]
    [string]$Mode,

    [Parameter(Mandatory = $true)]
    [string]$RehearsalRoot,

    [Parameter(Mandatory = $true)]
    [string]$DisplayMapPath,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]{1,64}$')]
    [string]$RunId,

    [Parameter(Mandatory = $true)]
    [ValidateSet('OfflineRequired', 'DiagnosticConnected')]
    [string]$NetworkPolicy
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$rehearsalParent = 'D:\VirtualData\JanVim-Exhibition-Rehearsals'
$janVimProductRoot = 'D:\github\JanVim'
$protectedRoots = @(
    'D:\VirtualData\TempCache\janvim-root-export-quarantine-20260826-110433-6473a2d7ebbc4524b66c61c07e540504'
    'D:\VirtualData\TempCache\janvim-task5-cached-d42e9769283e47dc8b98cf94baee739d'
    'D:\VirtualData\TempCache\janvim-task5-physical-cached-e9735e8d02e34ff4a4ac8836f8e22dcb'
)
$expectedNodeVersion = 'v22.23.0'
$expectedSourceRepository = 'D:/github/JanVim'
$expectedTag = 'v0.10.1-gmk.4.punctuation.2'
$expectedCommit = 'abbd5a5b942b202e7fe4324bcd3ddab47c672cb9'
$expectedShowConfigSha256 = '4c012266c8e9119030d113b812a6e4cf14877edb92fa39a3a560ce2b707f7f9a'
$expectedPluginLabSha256 = 'b47803728c52086ed384db00d8c9dd262b345b7ea9ebe1f8f900ce7313979965'
$expectedContentLockBytes = 2332L
$expectedContentLockSha256 = '5d27312d2dfd3ccebc28771314df1846e50fcd724effabfe8dc83c0577ffd08d'
$expectedPoemSha256 = 'b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8'
$allowedContentProfiles = @('p0-baseline', 'songfeng-source', 'river-channel', 'tower-codebook')
$maximumContentLockBytes = 32768
$maximumContentPaperBytes = 32768
$maximumContentManifestBytes = 131072
$incidentExitCode = 70
$maximumJsonBytes = 4096
$maximumWatchdogAttemptsBytes = 4096
$maximumWatchdogMonotonicMilliseconds = 9007199254740991L
$windowCloseHelperTimeoutMilliseconds = 2000
$windowCloseHelperMaximumOutputBytes = 4096
$maximumEvidenceBytes = 262144
$maximumGraphManifestBytes = 262144
$maximumRuntimeImports = 64
$maximumMainBundleBytes = 16777216L
$maximumLaunchFileBytes = 268435456L
$maximumRuntimeExecutableBytes = 268435456L
$maximumTypeScriptParserBytes = 9144216L
$maximumTypeScriptPackageMetadataBytes = 65536L
$crashWindowMilliseconds = 600000L
$restartDelaysMilliseconds = @(1000, 2000, 4000)
# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_BEGIN
$reviewedElectronMainRelativePath = 'apps/controller/dist/main/electron-main.js'
$reviewedElectronMainBytes = 526566L
$reviewedElectronMainSha256 = 'e4ee50d699c7212799760830993d6c37f9706892d4614b76e1e0f10d97f8d43a'
$reviewedElectronMainRuntimeImports = @(
    'electron'
    'node:child_process'
    'node:crypto'
    'node:fs'
    'node:fs/promises'
    'node:net'
    'node:path'
    'node:perf_hooks'
    'node:url'
    'node:util'
)
# JANVIM_REVIEWED_ELECTRON_RELEASE_IDENTITY_END
$allowedElectronMainRuntimeImports = @(
    'electron'
    'node:child_process'
    'node:crypto'
    'node:fs'
    'node:fs/promises'
    'node:net'
    'node:path'
    'node:perf_hooks'
    'node:url'
    'node:util'
)

$boundedOutputTypeName = 'JanVimExhibitionBoundedOutputV1'
if ($null -eq ($boundedOutputTypeName -as [type])) {
    $boundedOutputSource = @'
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

public sealed class JanVimExhibitionBoundedOutputV1 : Stream
{
    private readonly MemoryStream buffer = new MemoryStream();
    private readonly long maximumBytes;

    public JanVimExhibitionBoundedOutputV1(long maximumBytes)
    {
        if (maximumBytes < 0) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        this.maximumBytes = maximumBytes;
    }

    public byte[] ToArray() => buffer.ToArray();
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => buffer.Length;
    public override long Position
    {
        get => buffer.Position;
        set => throw new NotSupportedException();
    }

    public override void Flush() { }
    public override int Read(byte[] destination, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] source, int offset, int count)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));
        if (offset < 0 || count < 0 || source.Length - offset < count) {
            throw new ArgumentOutOfRangeException();
        }
        if (count > maximumBytes - buffer.Length) {
            throw new IOException("bounded-output-limit-exceeded");
        }
        buffer.Write(source, offset, count);
    }

    public override Task WriteAsync(
        byte[] source,
        int offset,
        int count,
        CancellationToken cancellationToken)
    {
        if (cancellationToken.IsCancellationRequested) {
            return Task.FromCanceled(cancellationToken);
        }
        try {
            Write(source, offset, count);
            return Task.CompletedTask;
        }
        catch (Exception error) {
            return Task.FromException(error);
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) buffer.Dispose();
        base.Dispose(disposing);
    }
}
'@
    try {
        $null = Add-Type -TypeDefinition $boundedOutputSource -ErrorAction Stop
    }
    catch {
        $errorName = ([string]$_.FullyQualifiedErrorId -split ',', 2)[0]
        if ($errorName -ne 'TYPE_ALREADY_EXISTS') {
            throw
        }
    }
}
if ($null -eq ($boundedOutputTypeName -as [type])) {
    throw 'bounded-output-type-unavailable'
}

$leaseClaimTypeName = 'JanVimExhibitionLeaseClaimV1'
if ($null -eq ($leaseClaimTypeName -as [type])) {
    $leaseClaimSource = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public sealed class JanVimExhibitionLeaseClaimV1 : IDisposable
{
    private const uint GenericRead = 0x80000000;
    private const uint DeleteAccess = 0x00010000;
    private const uint OpenExisting = 3;
    private const uint FileAttributeNormal = 0x00000080;
    private const uint FileAttributeDirectory = 0x00000010;
    private const uint FileAttributeReparsePoint = 0x00000400;
    private const uint FileFlagOpenReparsePoint = 0x00200000;

    private SafeFileHandle handle;
    private FileStream stream;
    private readonly int maximumBytes;
    private bool disposed;

    public string Text { get; private set; }
    public string FileSha256 { get; private set; }

    private enum FileInfoByHandleClass
    {
        FileDispositionInfo = 4,
        FileAttributeTagInfo = 9
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileAttributeTagInfo
    {
        public uint FileAttributes;
        public uint ReparseTag;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileDispositionInfo
    {
        [MarshalAs(UnmanagedType.U1)]
        public bool DeleteFile;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(
        SafeFileHandle file,
        FileInfoByHandleClass informationClass,
        out FileAttributeTagInfo information,
        uint bufferSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(
        SafeFileHandle file,
        FileInfoByHandleClass informationClass,
        ref FileDispositionInfo information,
        uint bufferSize);

    private JanVimExhibitionLeaseClaimV1(string path, int maximumBytes)
    {
        if (String.IsNullOrWhiteSpace(path)) throw new ArgumentException("path-required", nameof(path));
        if (maximumBytes < 1) throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        this.maximumBytes = maximumBytes;

        handle = CreateFileW(
            path,
            GenericRead | DeleteAccess,
            0,
            IntPtr.Zero,
            OpenExisting,
            FileAttributeNormal | FileFlagOpenReparsePoint,
            IntPtr.Zero);
        try {
            if (handle.IsInvalid) throw new IOException("exact-file-open-failed:" + Marshal.GetLastWin32Error());

            FileAttributeTagInfo attributes;
            if (!GetFileInformationByHandleEx(
                handle,
                FileInfoByHandleClass.FileAttributeTagInfo,
                out attributes,
                (uint)Marshal.SizeOf<FileAttributeTagInfo>()))
            {
                throw new IOException("exact-file-attributes-failed:" + Marshal.GetLastWin32Error());
            }
            if ((attributes.FileAttributes & (FileAttributeDirectory | FileAttributeReparsePoint)) != 0) {
                throw new IOException("exact-file-kind-invalid");
            }

            stream = new FileStream(handle, FileAccess.Read, 4096, false);
            byte[] content = ReadBoundedContent();
            Text = new UTF8Encoding(false, true).GetString(content);
            FileSha256 = ComputeSha256(content);
        }
        catch {
            if (stream != null) stream.Dispose();
            else if (handle != null) handle.Dispose();
            disposed = true;
            throw;
        }
    }

    public static JanVimExhibitionLeaseClaimV1 Open(string path, int maximumBytes)
    {
        return new JanVimExhibitionLeaseClaimV1(path, maximumBytes);
    }

    public bool DeleteIfUnchanged(string expectedSha256)
    {
        ThrowIfDisposed();
        if (expectedSha256 == null || expectedSha256.Length != 64) {
            throw new ArgumentException("sha256-invalid", nameof(expectedSha256));
        }
        if (!String.Equals(
            ComputeSha256(ReadBoundedContent()),
            expectedSha256,
            StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        FileDispositionInfo disposition = new FileDispositionInfo { DeleteFile = true };
        if (!SetFileInformationByHandle(
            handle,
            FileInfoByHandleClass.FileDispositionInfo,
            ref disposition,
            (uint)Marshal.SizeOf<FileDispositionInfo>()))
        {
            throw new IOException("exact-file-delete-failed:" + Marshal.GetLastWin32Error());
        }
        return true;
    }

    private byte[] ReadBoundedContent()
    {
        ThrowIfDisposed();
        stream.Position = 0;
        byte[] buffer = new byte[maximumBytes + 1];
        int totalBytes = 0;
        while (totalBytes < buffer.Length) {
            int readBytes = stream.Read(buffer, totalBytes, buffer.Length - totalBytes);
            if (readBytes == 0) break;
            totalBytes += readBytes;
        }
        if (totalBytes > maximumBytes) throw new IOException("exact-file-size-limit-exceeded");
        byte[] content = new byte[totalBytes];
        if (totalBytes > 0) Buffer.BlockCopy(buffer, 0, content, 0, totalBytes);
        return content;
    }

    private static string ComputeSha256(byte[] content)
    {
        using (SHA256 sha256 = SHA256.Create()) {
            return BitConverter.ToString(sha256.ComputeHash(content)).Replace("-", "").ToLowerInvariant();
        }
    }

    private void ThrowIfDisposed()
    {
        if (disposed) throw new ObjectDisposedException(nameof(JanVimExhibitionLeaseClaimV1));
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (stream != null) stream.Dispose();
        else if (handle != null) handle.Dispose();
        stream = null;
        handle = null;
        GC.SuppressFinalize(this);
    }

    ~JanVimExhibitionLeaseClaimV1()
    {
        if (!disposed) {
            if (stream != null) stream.Dispose();
            else if (handle != null) handle.Dispose();
        }
    }
}
'@
    try {
        $null = Add-Type -TypeDefinition $leaseClaimSource -ErrorAction Stop
    }
    catch {
        $errorName = ([string]$_.FullyQualifiedErrorId -split ',', 2)[0]
        if ($errorName -ne 'TYPE_ALREADY_EXISTS') {
            throw
        }
    }
}
if ($null -eq ($leaseClaimTypeName -as [type])) {
    throw 'lease-claim-type-unavailable'
}

function Resolve-ShowFullPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not [IO.Path]::IsPathFullyQualified($Path)) {
        throw "$Label-must-be-absolute"
    }
    $resolved = [IO.Path]::GetFullPath($Path)
    if ($resolved.Length -gt 3) {
        $resolved = $resolved.TrimEnd([char[]]@('\', '/'))
    }
    return $resolved
}

function Test-ShowPathEqual {
    param(
        [Parameter(Mandatory = $true)][string]$Left,
        [Parameter(Mandatory = $true)][string]$Right
    )

    return [string]::Equals(
        (Resolve-ShowFullPath -Path $Left -Label 'left-path'),
        (Resolve-ShowFullPath -Path $Right -Label 'right-path'),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Test-ShowAtOrBelow {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$Root
    )

    $resolvedCandidate = Resolve-ShowFullPath -Path $Candidate -Label 'candidate-path'
    $resolvedRoot = Resolve-ShowFullPath -Path $Root -Label 'root-path'
    if ([string]::Equals($resolvedCandidate, $resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $resolvedCandidate.StartsWith("$resolvedRoot\", [StringComparison]::OrdinalIgnoreCase)
}

function Test-UserNvimPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    return (Resolve-ShowFullPath -Path $Path -Label 'candidate-path') -match '\\AppData\\Local\\nvim(?:\\|$)'
}

function Assert-RequiredLeaf {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw $Reason
    }
}

function Assert-NotReparsePoint {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw $Reason
    }
}

function Assert-NoReparseTraversal {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $currentPath = Resolve-ShowFullPath -Path $Path -Label 'reparse-traversal-path'
    while ($null -ne $currentPath) {
        $item = Get-Item -LiteralPath $currentPath -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw $Reason
        }
        $parentPath = [IO.Path]::GetDirectoryName($currentPath)
        if ([string]::IsNullOrWhiteSpace($parentPath) -or (Test-ShowPathEqual -Left $parentPath -Right $currentPath)) {
            break
        }
        $currentPath = $parentPath
    }
}

function Read-BoundedFileSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Assert-RequiredLeaf -Path $Path -Reason $Reason
    $stream = $null
    try {
        $stream = [IO.File]::Open(
            $Path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::Read
        )
        $buffer = [byte[]]::new($MaximumBytes + 1)
        $offset = 0
        while ($offset -lt $buffer.Length) {
            $read = $stream.Read($buffer, $offset, $buffer.Length - $offset)
            if ($read -eq 0) {
                break
            }
            $offset += $read
        }
        if ($offset -gt $MaximumBytes) {
            throw $Reason
        }
        $bytes = [byte[]]::new($offset)
        if ($offset -gt 0) {
            [Array]::Copy($buffer, $bytes, $offset)
        }
        $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes)
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $hash = [Convert]::ToHexString($sha256.ComputeHash($bytes)).ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
        return [pscustomobject]@{
            Text = $text
            ByteLength = $offset
            FileSha256 = $hash
        }
    }
    catch {
        throw $Reason
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function Read-BoundedText {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    return (Read-BoundedFileSnapshot -Path $Path -MaximumBytes $MaximumBytes -Reason $Reason).Text
}

function Read-BoundedJsonSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $fileSnapshot = Read-BoundedFileSnapshot -Path $Path -MaximumBytes $MaximumBytes -Reason $Reason
    try {
        $value = $fileSnapshot.Text | ConvertFrom-Json -Depth 64 -DateKind String
    }
    catch {
        throw $Reason
    }
    if ($null -eq $value -or $value -isnot [psobject]) {
        throw $Reason
    }
    return [pscustomobject]@{
        Value = $value
        Text = $fileSnapshot.Text
        ByteLength = $fileSnapshot.ByteLength
        FileSha256 = $fileSnapshot.FileSha256
    }
}

function Read-BoundedJson {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    return (Read-BoundedJsonSnapshot -Path $Path -MaximumBytes $MaximumBytes -Reason $Reason).Value
}

function Get-RequiredPropertyValue {
    param(
        [Parameter(Mandatory = $true)][psobject]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $properties = @($InputObject.PSObject.Properties | Where-Object { $_.Name -ceq $Name })
    if ($properties.Count -ne 1 -or $null -eq $properties[0].Value) {
        throw $Reason
    }
    return ,$properties[0].Value
}

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory = $true)][psobject]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$ExpectedNames,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $actualNames = @($InputObject.PSObject.Properties.Name)
    if ($actualNames.Count -ne $ExpectedNames.Count) {
        throw $Reason
    }
    foreach ($expectedName in $ExpectedNames) {
        if ($actualNames -cnotcontains $expectedName) {
            throw $Reason
        }
    }
}

function Get-ExactStreamSha256 {
    param(
        [Parameter(Mandatory = $true)][IO.FileStream]$Stream,
        [Parameter(Mandatory = $true)][long]$ExpectedBytes,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($ExpectedBytes -lt 1 -or $ExpectedBytes -gt $MaximumBytes -or $Stream.Length -ne $ExpectedBytes) {
        throw $Reason
    }
    $sha256 = $null
    try {
        $Stream.Position = 0
        $sha256 = [Security.Cryptography.IncrementalHash]::CreateHash(
            [Security.Cryptography.HashAlgorithmName]::SHA256
        )
        $buffer = [byte[]]::new(1048576)
        $remaining = $ExpectedBytes
        while ($remaining -gt 0) {
            $requested = [int][Math]::Min([long]$buffer.Length, $remaining)
            $read = $Stream.Read($buffer, 0, $requested)
            if ($read -eq 0) {
                throw $Reason
            }
            $sha256.AppendData($buffer, 0, $read)
            $remaining -= $read
        }
        if ($Stream.ReadByte() -ne -1) {
            throw $Reason
        }
        return [Convert]::ToHexString($sha256.GetHashAndReset()).ToLowerInvariant()
    }
    catch {
        throw $Reason
    }
    finally {
        if ($null -ne $sha256) {
            $sha256.Dispose()
        }
    }
}

function Get-ExactFileSha256 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$ExpectedBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $stream = $null
    try {
        Assert-RequiredLeaf -Path $Path -Reason $Reason
        $stream = [IO.File]::Open(
            $Path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::Read
        )
        return Get-ExactStreamSha256 `
            -Stream $stream `
            -ExpectedBytes $ExpectedBytes `
            -MaximumBytes $maximumRuntimeExecutableBytes `
            -Reason $Reason
    }
    catch {
        throw $Reason
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }
}

function New-FrozenInputClaimSpecification {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    try {
        Assert-RequiredLeaf -Path $Path -Reason $Reason
        $item = Get-Item -LiteralPath $Path -Force
        if ($item.Length -lt 1 -or $item.Length -gt $MaximumBytes) {
            throw $Reason
        }
        $fileSha256 = Get-ExactFileSha256 `
            -Path $Path `
            -ExpectedBytes ([long]$item.Length) `
            -Reason $Reason
        return [pscustomobject]@{
            Path = $Path
            ExpectedBytes = [long]$item.Length
            MaximumBytes = $MaximumBytes
            ExpectedSha256 = $fileSha256
        }
    }
    catch {
        throw $Reason
    }
}

function Open-FrozenInputClaims {
    param([Parameter(Mandatory = $true)][object[]]$Specifications)

    $claims = [Collections.Generic.List[IO.FileStream]]::new()
    $candidate = $null
    try {
        foreach ($specification in $Specifications) {
            Assert-ExactPropertySet `
                -InputObject $specification `
                -ExpectedNames @('Path', 'ExpectedBytes', 'MaximumBytes', 'ExpectedSha256') `
                -Reason 'frozen-input-claim-failed'
            $path = [string](Get-RequiredPropertyValue `
                -InputObject $specification `
                -Name 'Path' `
                -Reason 'frozen-input-claim-failed')
            $expectedBytes = Get-RequiredPropertyValue `
                -InputObject $specification `
                -Name 'ExpectedBytes' `
                -Reason 'frozen-input-claim-failed'
            $maximumBytes = Get-RequiredPropertyValue `
                -InputObject $specification `
                -Name 'MaximumBytes' `
                -Reason 'frozen-input-claim-failed'
            $expectedSha256 = Get-RequiredPropertyValue `
                -InputObject $specification `
                -Name 'ExpectedSha256' `
                -Reason 'frozen-input-claim-failed'
            if (
                -not (Test-PositiveInteger -Value $expectedBytes) -or
                -not (Test-PositiveInteger -Value $maximumBytes) -or
                -not (Test-HashValue -Value $expectedSha256)
            ) {
                throw 'frozen-input-claim-failed'
            }
            Assert-RequiredLeaf -Path $path -Reason 'frozen-input-claim-failed'
            $candidate = [IO.File]::Open(
                $path,
                [IO.FileMode]::Open,
                [IO.FileAccess]::Read,
                [IO.FileShare]::Read
            )
            $actualSha256 = Get-ExactStreamSha256 `
                -Stream $candidate `
                -ExpectedBytes ([long]$expectedBytes) `
                -MaximumBytes ([long]$maximumBytes) `
                -Reason 'frozen-input-claim-failed'
            if ($actualSha256 -cne $expectedSha256) {
                throw 'frozen-input-claim-failed'
            }
            $claims.Add($candidate)
            $candidate = $null
        }
        return ,$claims
    }
    catch {
        if ($null -ne $candidate) {
            $candidate.Dispose()
        }
        foreach ($claim in $claims) {
            $claim.Dispose()
        }
        throw 'frozen-input-claim-failed'
    }
}

function Test-HashValue {
    param([Parameter(Mandatory = $true)][object]$Value)

    return $Value -is [string] -and $Value -cmatch '^[0-9a-f]{64}$'
}

function Resolve-ExactContentMemberPath {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][object]$RelativePath,
        [Parameter(Mandatory = $true)][string]$ExpectedRelativePath,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if (
        $RelativePath -isnot [string] -or
        $RelativePath -cne $ExpectedRelativePath -or
        $RelativePath -cnotmatch '^[A-Za-z0-9./-]+$'
    ) {
        throw $Reason
    }
    $resolved = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot $RelativePath.Replace('/', '\')))
    if (-not (Test-ShowAtOrBelow -Candidate $resolved -Root $RepositoryRoot)) {
        throw $Reason
    }
    return $resolved
}

function Read-LockedContentMember {
    param(
        [Parameter(Mandatory = $true)][psobject]$Record,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$ExpectedRelativePath,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    Assert-ExactPropertySet `
        -InputObject $Record `
        -ExpectedNames @('path', 'bytes', 'sha256') `
        -Reason $Reason
    $relativePath = Get-RequiredPropertyValue -InputObject $Record -Name 'path' -Reason $Reason
    $expectedBytes = Get-RequiredPropertyValue -InputObject $Record -Name 'bytes' -Reason $Reason
    $expectedHash = Get-RequiredPropertyValue -InputObject $Record -Name 'sha256' -Reason $Reason
    if (
        -not (Test-HashValue -Value $expectedHash) -or
        -not (Test-ExactJsonInteger -Value $expectedBytes -Expected ([long]$expectedBytes)) -or
        [long]$expectedBytes -lt 1 -or
        [long]$expectedBytes -gt $MaximumBytes
    ) {
        throw $Reason
    }
    $path = Resolve-ExactContentMemberPath `
        -RepositoryRoot $RepositoryRoot `
        -RelativePath $relativePath `
        -ExpectedRelativePath $ExpectedRelativePath `
        -Reason $Reason
    Assert-NoReparseTraversal -Path $path -Reason $Reason
    $snapshot = Read-BoundedFileSnapshot -Path $path -MaximumBytes $MaximumBytes -Reason $Reason
    if (
        $snapshot.ByteLength -ne [long]$expectedBytes -or
        $snapshot.FileSha256 -cne $expectedHash
    ) {
        throw $Reason
    }
    return [pscustomobject]@{ Path = $path; Snapshot = $snapshot }
}

function Assert-ContentProfileManifest {
    param(
        [Parameter(Mandatory = $true)][psobject]$Manifest,
        [Parameter(Mandatory = $true)][string]$ProfileId,
        [Parameter(Mandatory = $true)][string]$ExpectedRevision
    )

    $reason = 'content-profile-manifest-invalid'
    Assert-ExactPropertySet `
        -InputObject $Manifest `
        -ExpectedNames @('schema', 'loopId', 'loopDurationMs', 'poemSha256', 'contentRevision', 'preparedBy', 'cues') `
        -Reason $reason
    $duration = Get-RequiredPropertyValue -InputObject $Manifest -Name 'loopDurationMs' -Reason $reason
    $expectedDuration = 90000L
    if (
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $Manifest -Name 'schema' -Reason $reason) -Expected 1) -or
        -not (Test-ExactJsonInteger -Value $duration -Expected $expectedDuration) -or
        (Get-RequiredPropertyValue -InputObject $Manifest -Name 'contentRevision' -Reason $reason) -cne $ExpectedRevision -or
        (Get-RequiredPropertyValue -InputObject $Manifest -Name 'poemSha256' -Reason $reason) -cne $expectedPoemSha256
    ) {
        throw $reason
    }
    $cues = Get-RequiredPropertyValue -InputObject $Manifest -Name 'cues' -Reason $reason
    if ($cues.Count -lt 1 -or $cues.Count -gt 256) {
        throw $reason
    }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $previousAtMs = -1L
    $insertCount = 0
    $moveCount = 0
    $resetCount = 0
    foreach ($cue in $cues) {
        Assert-ExactPropertySet `
            -InputObject $cue `
            -ExpectedNames @('id', 'atMs', 'target', 'kind', 'payload') `
            -Reason $reason
        $cueId = Get-RequiredPropertyValue -InputObject $cue -Name 'id' -Reason $reason
        $atMs = Get-RequiredPropertyValue -InputObject $cue -Name 'atMs' -Reason $reason
        $kind = Get-RequiredPropertyValue -InputObject $cue -Name 'kind' -Reason $reason
        if (
            $cueId -isnot [string] -or
            [string]::IsNullOrWhiteSpace($cueId) -or
            -not $seen.Add($cueId) -or
            -not (Test-ExactJsonInteger -Value $atMs -Expected ([long]$atMs)) -or
            [long]$atMs -lt $previousAtMs -or
            [long]$atMs -gt $expectedDuration
        ) {
            throw $reason
        }
        $previousAtMs = [long]$atMs
        if ($kind -ceq 'editor-action') {
            $payload = Get-RequiredPropertyValue -InputObject $cue -Name 'payload' -Reason $reason
            Assert-ExactPropertySet `
                -InputObject $payload `
                -ExpectedNames @('action', 'displayKeys', 'semanticLabel', 'critical') `
                -Reason $reason
            if (-not (Test-ExactJsonTrue -Value (Get-RequiredPropertyValue -InputObject $payload -Name 'critical' -Reason $reason))) {
                throw $reason
            }
            $action = Get-RequiredPropertyValue -InputObject $payload -Name 'action' -Reason $reason
            $actionType = Get-RequiredPropertyValue -InputObject $action -Name 'type' -Reason $reason
            if ($actionType -ceq 'insert') {
                Assert-ExactPropertySet -InputObject $action -ExpectedNames @('type', 'text', 'charsPerSecond') -Reason $reason
                $text = Get-RequiredPropertyValue -InputObject $action -Name 'text' -Reason $reason
                $rate = Get-RequiredPropertyValue -InputObject $action -Name 'charsPerSecond' -Reason $reason
                if (
                    $text -isnot [string] -or
                    [Text.Encoding]::UTF8.GetByteCount($text) -gt 512 -or
                    $rate -isnot [ValueType] -or
                    [double]$rate -lt 0 -or
                    [double]$rate -gt 1000
                ) {
                    throw $reason
                }
                $insertCount++
            }
            elseif ($actionType -ceq 'move') {
                Assert-ExactPropertySet -InputObject $action -ExpectedNames @('type', 'keys', 'repeat') -Reason $reason
                $keys = Get-RequiredPropertyValue -InputObject $action -Name 'keys' -Reason $reason
                $repeat = Get-RequiredPropertyValue -InputObject $action -Name 'repeat' -Reason $reason
                if (
                    $keys -cnotin @('h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '$', 'G') -or
                    -not (Test-ExactJsonInteger -Value $repeat -Expected ([long]$repeat)) -or
                    [long]$repeat -lt 0 -or
                    [long]$repeat -gt 256
                ) {
                    throw $reason
                }
                $moveCount++
            }
            elseif ($actionType -ceq 'reset') {
                Assert-ExactPropertySet -InputObject $action -ExpectedNames @('type') -Reason $reason
                $resetCount++
            }
            else {
                throw $reason
            }
        }
    }
    $finalCue = $cues[-1]
    $finalPayload = Get-RequiredPropertyValue -InputObject $finalCue -Name 'payload' -Reason 'content-profile-reset-invalid'
    $finalAction = Get-RequiredPropertyValue -InputObject $finalPayload -Name 'action' -Reason 'content-profile-reset-invalid'
    if (
        (Get-RequiredPropertyValue -InputObject $finalCue -Name 'kind' -Reason 'content-profile-reset-invalid') -cne 'editor-action' -or
        (Get-RequiredPropertyValue -InputObject $finalCue -Name 'target' -Reason 'content-profile-reset-invalid') -cne 'both' -or
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $finalCue -Name 'atMs' -Reason 'content-profile-reset-invalid') -Expected $expectedDuration) -or
        (Get-RequiredPropertyValue -InputObject $finalAction -Name 'type' -Reason 'content-profile-reset-invalid') -cne 'reset' -or
        $resetCount -ne 1
    ) {
        throw 'content-profile-reset-invalid'
    }
    if (
        $ProfileId -cne 'p0-baseline' -and
        ($insertCount -lt 12 -or $insertCount -gt 18 -or $moveCount -lt 18 -or $moveCount -gt 28)
    ) {
        throw $reason
    }
}

function Read-SelectedContentProfile {
    param(
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$ContentLockPath,
        [Parameter(Mandatory = $true)][psobject]$ActiveManifestSnapshot
    )

    $lockSnapshot = Read-BoundedJsonSnapshot `
        -Path $ContentLockPath `
        -MaximumBytes $maximumContentLockBytes `
        -Reason 'content-lock-invalid'
    if (
        $lockSnapshot.ByteLength -ne $expectedContentLockBytes -or
        $lockSnapshot.FileSha256 -cne $expectedContentLockSha256
    ) {
        throw 'content-lock-hash-mismatch'
    }
    $lock = $lockSnapshot.Value
    Assert-ExactPropertySet `
        -InputObject $lock `
        -ExpectedNames @('schema', 'revision', 'poem', 'profiles') `
        -Reason 'content-lock-invalid'
    if (
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $lock -Name 'schema' -Reason 'content-lock-invalid') -Expected 1) -or
        (Get-RequiredPropertyValue -InputObject $lock -Name 'revision' -Reason 'content-lock-invalid') -cne '20260902-p0.1-r8'
    ) {
        throw 'content-lock-invalid'
    }
    $profiles = Get-RequiredPropertyValue -InputObject $lock -Name 'profiles' -Reason 'content-lock-invalid'
    if ($profiles.Count -ne $allowedContentProfiles.Count) {
        throw 'content-profile-allowlist-invalid'
    }
    $matches = [Collections.Generic.List[psobject]]::new()
    for ($index = 0; $index -lt $allowedContentProfiles.Count; $index++) {
        $profile = $profiles[$index]
        Assert-ExactPropertySet `
            -InputObject $profile `
            -ExpectedNames @('id', 'title', 'revision', 'paper', 'manifest') `
            -Reason 'content-profile-record-invalid'
        $profileId = Get-RequiredPropertyValue -InputObject $profile -Name 'id' -Reason 'content-profile-record-invalid'
        if ($profileId -cne $allowedContentProfiles[$index]) {
            throw 'content-profile-allowlist-invalid'
        }
        $manifestRecord = Get-RequiredPropertyValue -InputObject $profile -Name 'manifest' -Reason 'content-profile-record-invalid'
        Assert-ExactPropertySet -InputObject $manifestRecord -ExpectedNames @('path', 'bytes', 'sha256') -Reason 'content-profile-record-invalid'
        $manifestBytes = Get-RequiredPropertyValue -InputObject $manifestRecord -Name 'bytes' -Reason 'content-profile-record-invalid'
        $manifestHash = Get-RequiredPropertyValue -InputObject $manifestRecord -Name 'sha256' -Reason 'content-profile-record-invalid'
        if (
            (Test-ExactJsonInteger -Value $manifestBytes -Expected $ActiveManifestSnapshot.ByteLength) -and
            (Test-HashValue -Value $manifestHash) -and
            $manifestHash -ceq $ActiveManifestSnapshot.FileSha256
        ) {
            $matches.Add($profile)
        }
    }
    if ($matches.Count -ne 1) {
        throw 'active-manifest-not-allowlisted'
    }
    $selected = $matches[0]
    $selectedId = Get-RequiredPropertyValue -InputObject $selected -Name 'id' -Reason 'content-profile-record-invalid'
    $selectedRevision = Get-RequiredPropertyValue -InputObject $selected -Name 'revision' -Reason 'content-profile-record-invalid'
    $paper = Read-LockedContentMember `
        -Record (Get-RequiredPropertyValue -InputObject $selected -Name 'paper' -Reason 'content-profile-record-invalid') `
        -RepositoryRoot $RepositoryRoot `
        -ExpectedRelativePath "content/p0.1/profiles/$selectedId/paper.md" `
        -MaximumBytes $maximumContentPaperBytes `
        -Reason 'content-profile-paper-invalid'
    $manifestSource = Read-LockedContentMember `
        -Record (Get-RequiredPropertyValue -InputObject $selected -Name 'manifest' -Reason 'content-profile-record-invalid') `
        -RepositoryRoot $RepositoryRoot `
        -ExpectedRelativePath "content/p0.1/profiles/$selectedId/show.manifest.json" `
        -MaximumBytes $maximumContentManifestBytes `
        -Reason 'content-profile-manifest-invalid'
    $poem = Read-LockedContentMember `
        -Record (Get-RequiredPropertyValue -InputObject $lock -Name 'poem' -Reason 'content-lock-invalid') `
        -RepositoryRoot $RepositoryRoot `
        -ExpectedRelativePath 'content/fixture/poem.txt' `
        -MaximumBytes 65536 `
        -Reason 'content-poem-invalid'
    if ($poem.Snapshot.FileSha256 -cne $expectedPoemSha256) {
        throw 'content-poem-invalid'
    }
    Assert-ContentProfileManifest `
        -Manifest $ActiveManifestSnapshot.Value `
        -ProfileId $selectedId `
        -ExpectedRevision $selectedRevision
    return [pscustomobject]@{
        ProfileId = $selectedId
        Revision = $selectedRevision
        LockPath = $ContentLockPath
        LockSnapshot = $lockSnapshot
        PaperPath = $paper.Path
        PaperSnapshot = $paper.Snapshot
        ManifestSourcePath = $manifestSource.Path
        ManifestSourceSnapshot = $manifestSource.Snapshot
    }
}

function Assert-NoDuplicateJsonPropertyNamesForReason {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Reason,
        [ValidateRange(1, 64)][int]$MaximumDepth = 8
    )

    $document = $null
    try {
        $options = [System.Text.Json.JsonDocumentOptions]::new()
        $options.AllowTrailingCommas = $false
        $options.CommentHandling = [System.Text.Json.JsonCommentHandling]::Disallow
        $options.MaxDepth = $MaximumDepth
        $document = [System.Text.Json.JsonDocument]::Parse($Text, $options)
        $pending = [Collections.Generic.Stack[System.Text.Json.JsonElement]]::new()
        $pending.Push($document.RootElement)
        while ($pending.Count -gt 0) {
            $element = $pending.Pop()
            if ($element.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
                $propertyNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
                foreach ($property in $element.EnumerateObject()) {
                    if (-not $propertyNames.Add($property.Name)) {
                        throw $Reason
                    }
                    $pending.Push($property.Value)
                }
            }
            elseif ($element.ValueKind -eq [System.Text.Json.JsonValueKind]::Array) {
                foreach ($item in $element.EnumerateArray()) {
                    $pending.Push($item)
                }
            }
        }
    }
    catch {
        throw $Reason
    }
    finally {
        if ($null -ne $document) {
            $document.Dispose()
        }
    }
}

function Assert-NoDuplicateJsonPropertyNames {
    param([Parameter(Mandatory = $true)][string]$Text)

    Assert-NoDuplicateJsonPropertyNamesForReason `
        -Text $Text `
        -Reason 'electron-module-graph-invalid' `
        -MaximumDepth 8
}

function Read-StrictElectronModuleGraph {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$RepositoryRoot,
        [Parameter(Mandatory = $true)][string]$CompiledEntry
    )

    Assert-NoDuplicateJsonPropertyNames -Text $Text
    try {
        $manifest = $Text | ConvertFrom-Json -Depth 8 -DateKind String
    }
    catch {
        throw 'electron-module-graph-invalid'
    }
    if ($null -eq $manifest -or $manifest -isnot [pscustomobject]) {
        throw 'electron-module-graph-invalid'
    }
    Assert-ExactPropertySet `
        -InputObject $manifest `
        -ExpectedNames @('schema', 'status', 'files', 'runtimeImports') `
        -Reason 'electron-module-graph-invalid'
    if (
        -not (Test-ExactJsonInteger `
            -Value (Get-RequiredPropertyValue -InputObject $manifest -Name 'schema' -Reason 'electron-module-graph-invalid') `
            -Expected 2) -or
        (Get-RequiredPropertyValue -InputObject $manifest -Name 'status' -Reason 'electron-module-graph-invalid') -cne 'compiled-electron-main-bundle-verified'
    ) {
        throw 'electron-module-graph-invalid'
    }
    $filesValue = Get-RequiredPropertyValue `
        -InputObject $manifest `
        -Name 'files' `
        -Reason 'electron-module-graph-invalid'
    if ($filesValue -isnot [array]) {
        throw 'electron-module-graph-invalid'
    }
    $files = @($filesValue)
    if ($files.Count -ne 1) {
        throw 'electron-module-graph-invalid'
    }

    $file = $files[0]
    if ($file -isnot [pscustomobject]) {
        throw 'electron-module-graph-invalid'
    }
    Assert-ExactPropertySet `
        -InputObject $file `
        -ExpectedNames @('relativePath', 'bytes', 'sha256') `
        -Reason 'electron-module-graph-invalid'
    $relativePath = Get-RequiredPropertyValue -InputObject $file -Name 'relativePath' -Reason 'electron-module-graph-invalid'
    $bytes = Get-RequiredPropertyValue -InputObject $file -Name 'bytes' -Reason 'electron-module-graph-invalid'
    $sha256 = Get-RequiredPropertyValue -InputObject $file -Name 'sha256' -Reason 'electron-module-graph-invalid'
    if (
        $relativePath -isnot [string] -or
        $relativePath -cne $reviewedElectronMainRelativePath -or
        -not (Test-PositiveInteger -Value $bytes) -or
        [long]$bytes -gt $maximumMainBundleBytes -or
        -not (Test-HashValue -Value $sha256)
    ) {
        throw 'electron-module-graph-invalid'
    }
    if (
        [long]$bytes -ne $reviewedElectronMainBytes -or
        $sha256 -cne $reviewedElectronMainSha256
    ) {
        throw 'electron-module-release-identity-mismatch'
    }
    $path = Resolve-ShowFullPath -Path (Join-Path $RepositoryRoot $relativePath) -Label 'electron-module-graph-path'
    if (
        -not (Test-ShowPathEqual -Left $path -Right $CompiledEntry) -or
        ([IO.Path]::GetRelativePath($RepositoryRoot, $path).Replace('\', '/')) -cne $relativePath
    ) {
        throw 'electron-module-graph-invalid'
    }
    Assert-RequiredLeaf -Path $path -Reason 'electron-module-graph-invalid'
    Assert-NoReparseTraversal -Path $path -Reason 'electron-module-graph-invalid'

    $runtimeImportsValue = Get-RequiredPropertyValue `
        -InputObject $manifest `
        -Name 'runtimeImports' `
        -Reason 'electron-module-graph-invalid'
    if ($runtimeImportsValue -isnot [array]) {
        throw 'electron-module-graph-invalid'
    }
    $runtimeImports = @($runtimeImportsValue)
    if ($runtimeImports.Count -lt 1 -or $runtimeImports.Count -gt $maximumRuntimeImports) {
        throw 'electron-module-graph-invalid'
    }
    $allowedImports = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($allowedImport in $allowedElectronMainRuntimeImports) {
        [void]$allowedImports.Add($allowedImport)
    }
    $seenImports = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $previousImport = $null
    $electronSeen = $false
    foreach ($runtimeImport in $runtimeImports) {
        if (
            $runtimeImport -isnot [string] -or
            $runtimeImport.Length -lt 1 -or
            $runtimeImport.Length -gt 128 -or
            -not $allowedImports.Contains($runtimeImport) -or
            -not $seenImports.Add($runtimeImport) -or
            ($null -ne $previousImport -and [string]::CompareOrdinal($previousImport, $runtimeImport) -ge 0)
        ) {
            throw 'electron-module-graph-invalid'
        }
        if ($runtimeImport -ceq 'electron') {
            $electronSeen = $true
        }
        $previousImport = $runtimeImport
    }
    if (-not $electronSeen) {
        throw 'electron-module-graph-invalid'
    }
    if ($runtimeImports.Count -ne $reviewedElectronMainRuntimeImports.Count) {
        throw 'electron-module-release-identity-mismatch'
    }
    for ($index = 0; $index -lt $reviewedElectronMainRuntimeImports.Count; $index += 1) {
        if ($runtimeImports[$index] -cne $reviewedElectronMainRuntimeImports[$index]) {
            throw 'electron-module-release-identity-mismatch'
        }
    }

    return [pscustomobject]@{
        Path = $path
        ExpectedBytes = $reviewedElectronMainBytes
        MaximumBytes = $maximumMainBundleBytes
        ExpectedSha256 = $reviewedElectronMainSha256
    }
}

function Test-JsonInteger {
    param([Parameter(Mandatory = $true)][object]$Value)

    return $Value -is [int] -or $Value -is [long]
}

function Test-FinitePositiveJsonNumber {
    param([Parameter(Mandatory = $true)][object]$Value)

    if ($Value -isnot [int] -and $Value -isnot [long] -and $Value -isnot [double] -and $Value -isnot [decimal]) {
        return $false
    }
    $number = [double]$Value
    return [double]::IsFinite($number) -and $number -gt 0
}

function Get-DisplayGeometrySha256 {
    param([Parameter(Mandatory = $true)][pscustomobject]$Role)

    $bounds = $Role.bounds
    $displayIdJson = ConvertTo-Json -Compress -InputObject ([string]$Role.displayId)
    $scaleText = ([double]$Role.scaleFactor).ToString(
        'R',
        [Globalization.CultureInfo]::InvariantCulture
    ).ToLowerInvariant()
    $scaleText = $scaleText -replace 'e\+', 'e'
    $scaleText = $scaleText -replace 'e(-?)0+([0-9]+)$', 'e$1$2'
    $canonical = '[{0},{1},{2},{3},{4},{5}]' -f @(
        $displayIdJson,
        [long]$bounds.x,
        [long]$bounds.y,
        [long]$bounds.width,
        [long]$bounds.height,
        $scaleText
    )
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($canonical)
        return [Convert]::ToHexString($sha256.ComputeHash($bytes)).ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Assert-ConfirmedDisplayRole {
    param(
        [Parameter(Mandatory = $true)][object]$Role,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Role -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet `
        -InputObject $Role `
        -ExpectedNames @('displayId', 'bounds', 'scaleFactor', 'geometrySha256') `
        -Reason $Reason
    $bounds = Get-RequiredPropertyValue -InputObject $Role -Name 'bounds' -Reason $Reason
    if ($bounds -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet -InputObject $bounds -ExpectedNames @('x', 'y', 'width', 'height') -Reason $Reason
    $displayId = Get-RequiredPropertyValue -InputObject $Role -Name 'displayId' -Reason $Reason
    $scaleFactor = Get-RequiredPropertyValue -InputObject $Role -Name 'scaleFactor' -Reason $Reason
    $geometrySha256 = Get-RequiredPropertyValue -InputObject $Role -Name 'geometrySha256' -Reason $Reason
    if (
        $displayId -isnot [string] -or
        [string]::IsNullOrWhiteSpace($displayId) -or
        -not (Test-JsonInteger -Value (Get-RequiredPropertyValue -InputObject $bounds -Name 'x' -Reason $Reason)) -or
        -not (Test-JsonInteger -Value (Get-RequiredPropertyValue -InputObject $bounds -Name 'y' -Reason $Reason)) -or
        -not (Test-PositiveInteger -Value (Get-RequiredPropertyValue -InputObject $bounds -Name 'width' -Reason $Reason)) -or
        -not (Test-PositiveInteger -Value (Get-RequiredPropertyValue -InputObject $bounds -Name 'height' -Reason $Reason)) -or
        -not (Test-FinitePositiveJsonNumber -Value $scaleFactor) -or
        -not (Test-HashValue -Value $geometrySha256) -or
        (Get-DisplayGeometrySha256 -Role $Role) -cne $geometrySha256
    ) {
        throw $Reason
    }
}

function Get-DisplayRoutingSha256 {
    param([Parameter(Mandatory = $true)][string]$Canonical)

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.UTF8Encoding]::new($false, $true).GetBytes($Canonical)
        return [Convert]::ToHexString($sha256.ComputeHash($bytes)).ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-CanonicalDisplayJsonNumber {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Value -is [int] -or $Value -is [long]) {
        return ([long]$Value).ToString([Globalization.CultureInfo]::InvariantCulture)
    }
    if ($Value -isnot [double] -and $Value -isnot [decimal]) {
        throw $Reason
    }
    $number = [double]$Value
    if (-not [double]::IsFinite($number)) {
        throw $Reason
    }
    $text = $number.ToString('R', [Globalization.CultureInfo]::InvariantCulture).ToLowerInvariant()
    $text = $text -replace 'e\+', 'e'
    $text = $text -replace 'e(-?)0+([0-9]+)$', 'e$1$2'
    return $text
}

function Test-SafeDisplayJsonInteger {
    param([Parameter(Mandatory = $true)][object]$Value)

    return (
        ($Value -is [int] -or $Value -is [long]) -and
        [decimal]$Value -ge -9007199254740991 -and
        [decimal]$Value -le 9007199254740991
    )
}

function Assert-DisplayRoutingText {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][int]$MaximumBytes,
        [Parameter(Mandatory = $true)][string]$Reason,
        [switch]$AllowEmpty
    )

    if (
        $Value -isnot [string] -or
        ($Value.Length -eq 0 -and -not $AllowEmpty) -or
        [Text.Encoding]::UTF8.GetByteCount($Value) -gt $MaximumBytes -or
        $Value -match '[\x00-\x1f\x7f-\x9f]'
    ) {
        throw $Reason
    }
}

function Assert-DisplayRectangleV2 {
    param(
        [Parameter(Mandatory = $true)][object]$Rectangle,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Rectangle -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet `
        -InputObject $Rectangle `
        -ExpectedNames @('x', 'y', 'width', 'height') `
        -Reason $Reason
    $x = Get-RequiredPropertyValue -InputObject $Rectangle -Name 'x' -Reason $Reason
    $y = Get-RequiredPropertyValue -InputObject $Rectangle -Name 'y' -Reason $Reason
    $width = Get-RequiredPropertyValue -InputObject $Rectangle -Name 'width' -Reason $Reason
    $height = Get-RequiredPropertyValue -InputObject $Rectangle -Name 'height' -Reason $Reason
    if (
        -not (Test-SafeDisplayJsonInteger -Value $x) -or
        -not (Test-SafeDisplayJsonInteger -Value $y) -or
        -not (Test-SafeDisplayJsonInteger -Value $width) -or
        -not (Test-SafeDisplayJsonInteger -Value $height) -or
        [long]$width -le 0 -or
        [long]$height -le 0 -or
        [decimal]$x + [decimal]$width -lt -9007199254740991 -or
        [decimal]$x + [decimal]$width -gt 9007199254740991 -or
        [decimal]$y + [decimal]$height -lt -9007199254740991 -or
        [decimal]$y + [decimal]$height -gt 9007199254740991
    ) {
        throw $Reason
    }
}

function Get-DisplayGeometryV2Sha256 {
    param(
        [Parameter(Mandatory = $true)][pscustomobject]$Display,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $bounds = $Display.bounds
    $workingArea = $Display.workingArea
    $canonical = '[{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10}]' -f @(
        (ConvertTo-Json -Compress -InputObject ([string]$Display.displayId)),
        (Get-CanonicalDisplayJsonNumber -Value $bounds.x -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $bounds.y -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $bounds.width -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $bounds.height -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $workingArea.x -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $workingArea.y -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $workingArea.width -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $workingArea.height -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $Display.scaleFactor -Reason $Reason),
        (Get-CanonicalDisplayJsonNumber -Value $Display.rotation -Reason $Reason)
    )
    return Get-DisplayRoutingSha256 -Canonical $canonical
}

function Assert-DisplayPhysicalV2 {
    param(
        [Parameter(Mandatory = $true)][object]$Display,
        [Parameter(Mandatory = $true)][bool]$Binding,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Display -isnot [pscustomobject]) {
        throw $Reason
    }
    $expectedNames = @(
        if ($Binding) { 'softId' }
        'displayId'
        'label'
        'bounds'
        'workingArea'
        'scaleFactor'
        'rotation'
        'geometrySha256'
    )
    Assert-ExactPropertySet -InputObject $Display -ExpectedNames $expectedNames -Reason $Reason
    if ($Binding) {
        $softId = Get-RequiredPropertyValue -InputObject $Display -Name 'softId' -Reason $Reason
        if ($softId -isnot [string] -or $softId -cnotin @('SCREEN-1', 'SCREEN-2', 'SCREEN-3')) {
            throw $Reason
        }
    }
    $displayId = Get-RequiredPropertyValue -InputObject $Display -Name 'displayId' -Reason $Reason
    $label = Get-RequiredPropertyValue -InputObject $Display -Name 'label' -Reason $Reason
    Assert-DisplayRoutingText -Value $displayId -MaximumBytes 256 -Reason $Reason
    Assert-DisplayRoutingText -Value $label -MaximumBytes 512 -Reason $Reason -AllowEmpty
    $bounds = Get-RequiredPropertyValue -InputObject $Display -Name 'bounds' -Reason $Reason
    $workingArea = Get-RequiredPropertyValue -InputObject $Display -Name 'workingArea' -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $bounds -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $workingArea -Reason $Reason
    $scaleFactor = Get-RequiredPropertyValue -InputObject $Display -Name 'scaleFactor' -Reason $Reason
    $rotation = Get-RequiredPropertyValue -InputObject $Display -Name 'rotation' -Reason $Reason
    $geometrySha256 = Get-RequiredPropertyValue -InputObject $Display -Name 'geometrySha256' -Reason $Reason
    if (
        -not (Test-FinitePositiveJsonNumber -Value $scaleFactor) -or
        -not (Test-SafeDisplayJsonInteger -Value $rotation) -or
        [long]$rotation -cnotin @(0L, 90L, 180L, 270L) -or
        -not (Test-HashValue -Value $geometrySha256) -or
        (Get-DisplayGeometryV2Sha256 -Display $Display -Reason $Reason) -cne $geometrySha256
    ) {
        throw $Reason
    }
}

function Get-DisplayTopologyV2Sha256 {
    param(
        [Parameter(Mandatory = $true)][object[]]$Displays,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $sorted = @($Displays)
    for ($index = 1; $index -lt $sorted.Count; $index += 1) {
        $candidate = $sorted[$index]
        $cursor = $index - 1
        while (
            $cursor -ge 0 -and
            [StringComparer]::Ordinal.Compare(
                [string]$sorted[$cursor].displayId,
                [string]$candidate.displayId
            ) -gt 0
        ) {
            $sorted[$cursor + 1] = $sorted[$cursor]
            $cursor -= 1
        }
        $sorted[$cursor + 1] = $candidate
    }
    $rows = [Collections.Generic.List[string]]::new()
    foreach ($display in $sorted) {
        $softIdJson = 'null'
        $softIdProperty = @($display.PSObject.Properties | Where-Object { $_.Name -ceq 'softId' })
        if ($softIdProperty.Count -eq 1) {
            $softIdJson = ConvertTo-Json -Compress -InputObject ([string]$softIdProperty[0].Value)
        }
        $bounds = $display.bounds
        $workingArea = $display.workingArea
        $rows.Add(('[{0},{1},{2},{3},{4},{5},{6},{7},{8},{9},{10},{11},{12}]' -f @(
            $softIdJson,
            (ConvertTo-Json -Compress -InputObject ([string]$display.displayId)),
            (ConvertTo-Json -Compress -InputObject ([string]$display.label)),
            (Get-CanonicalDisplayJsonNumber -Value $bounds.x -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $bounds.y -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $bounds.width -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $bounds.height -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $workingArea.x -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $workingArea.y -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $workingArea.width -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $workingArea.height -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $display.scaleFactor -Reason $Reason),
            (Get-CanonicalDisplayJsonNumber -Value $display.rotation -Reason $Reason)
        )))
    }
    return Get-DisplayRoutingSha256 -Canonical ('[' + [string]::Join(',', $rows) + ']')
}

function Assert-DisplayLayoutV1 {
    param(
        [Parameter(Mandatory = $true)][object]$Layout,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Layout -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet -InputObject $Layout -ExpectedNames @('schema', 'roles', 'modes') -Reason $Reason
    if (-not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $Layout -Name 'schema' -Reason $Reason) -Expected 1)) {
        throw $Reason
    }
    $rolesValue = Get-RequiredPropertyValue -InputObject $Layout -Name 'roles' -Reason $Reason
    if ($rolesValue -isnot [array]) {
        throw $Reason
    }
    $roles = @($rolesValue)
    $expectedRoleSoftIds = @('SCREEN-1', 'SCREEN-2', 'SCREEN-3')
    $expectedRoleSurfaces = @('janvim', 'narrative', 'jianshan-placeholder')
    if ($roles.Count -ne $expectedRoleSoftIds.Count) {
        throw $Reason
    }
    for ($index = 0; $index -lt $expectedRoleSoftIds.Count; $index += 1) {
        Assert-ExactPropertySet -InputObject $roles[$index] -ExpectedNames @('softId', 'surface') -Reason $Reason
        if (
            $roles[$index].softId -cne $expectedRoleSoftIds[$index] -or
            $roles[$index].surface -cne $expectedRoleSurfaces[$index]
        ) {
            throw $Reason
        }
    }
    $modesValue = Get-RequiredPropertyValue -InputObject $Layout -Name 'modes' -Reason $Reason
    if ($modesValue -isnot [array]) {
        throw $Reason
    }
    $modes = @($modesValue)
    if ($modes.Count -ne 2) {
        throw $Reason
    }
    foreach ($mode in $modes) {
        Assert-ExactPropertySet -InputObject $mode -ExpectedNames @('mode', 'activeRoles', 'skippedRoles') -Reason $Reason
        if (
            (Get-RequiredPropertyValue -InputObject $mode -Name 'activeRoles' -Reason $Reason) -isnot [array] -or
            (Get-RequiredPropertyValue -InputObject $mode -Name 'skippedRoles' -Reason $Reason) -isnot [array]
        ) {
            throw $Reason
        }
    }
    if (
        $modes[0].mode -cne 'production-3' -or
        [string]::Join(',', @($modes[0].activeRoles)) -cne 'SCREEN-1,SCREEN-2,SCREEN-3' -or
        @($modes[0].skippedRoles).Count -ne 0 -or
        $modes[1].mode -cne 'single-display-preview' -or
        [string]::Join(',', @($modes[1].activeRoles)) -cne 'SCREEN-1' -or
        [string]::Join(',', @($modes[1].skippedRoles)) -cne 'SCREEN-2,SCREEN-3'
    ) {
        throw $Reason
    }
}

function Assert-DisplayMapV2 {
    param(
        [Parameter(Mandatory = $true)][object]$Map,
        [Parameter(Mandatory = $true)][string]$ExpectedLayoutSha256,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Map -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet `
        -InputObject $Map `
        -ExpectedNames @('schema', 'mappingStatus', 'mode', 'layoutSha256', 'capturedAtUtc', 'topologySha256', 'bindings', 'unassignedDisplays') `
        -Reason $Reason
    $mode = Get-RequiredPropertyValue -InputObject $Map -Name 'mode' -Reason $Reason
    $layoutSha256 = Get-RequiredPropertyValue -InputObject $Map -Name 'layoutSha256' -Reason $Reason
    $capturedAtUtc = Get-RequiredPropertyValue -InputObject $Map -Name 'capturedAtUtc' -Reason $Reason
    $topologySha256 = Get-RequiredPropertyValue -InputObject $Map -Name 'topologySha256' -Reason $Reason
    if (
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $Map -Name 'schema' -Reason $Reason) -Expected 2) -or
        (Get-RequiredPropertyValue -InputObject $Map -Name 'mappingStatus' -Reason $Reason) -cne 'confirmed' -or
        $mode -cnotin @('production-3', 'single-display-preview') -or
        -not (Test-HashValue -Value $layoutSha256) -or
        $layoutSha256 -cne $ExpectedLayoutSha256 -or
        -not (Test-HashValue -Value $topologySha256) -or
        $capturedAtUtc -isnot [string] -or
        $capturedAtUtc -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
    ) {
        throw $Reason
    }
    $timestamp = [DateTimeOffset]::MinValue
    if (
        -not [DateTimeOffset]::TryParseExact(
            $capturedAtUtc,
            'yyyy-MM-ddTHH:mm:ss.fffZ',
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::AssumeUniversal,
            [ref]$timestamp
        ) -or
        $timestamp.ToUniversalTime().ToString(
            'yyyy-MM-ddTHH:mm:ss.fffZ',
            [Globalization.CultureInfo]::InvariantCulture
        ) -cne $capturedAtUtc
    ) {
        throw $Reason
    }
    $bindingsValue = Get-RequiredPropertyValue -InputObject $Map -Name 'bindings' -Reason $Reason
    $unassignedValue = Get-RequiredPropertyValue -InputObject $Map -Name 'unassignedDisplays' -Reason $Reason
    if ($bindingsValue -isnot [array] -or $unassignedValue -isnot [array]) {
        throw $Reason
    }
    $bindings = @($bindingsValue)
    $unassigned = @($unassignedValue)
    if ($bindings.Count + $unassigned.Count -gt 16) {
        throw $Reason
    }
    $displayIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $softIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($binding in $bindings) {
        Assert-DisplayPhysicalV2 -Display $binding -Binding $true -Reason $Reason
        if (
            -not $displayIds.Add([string]$binding.displayId) -or
            -not $softIds.Add([string]$binding.softId)
        ) {
            throw $Reason
        }
    }
    foreach ($display in $unassigned) {
        Assert-DisplayPhysicalV2 -Display $display -Binding $false -Reason $Reason
        if (-not $displayIds.Add([string]$display.displayId)) {
            throw $Reason
        }
    }
    if (
        ($mode -ceq 'production-3' -and (
            $bindings.Count -ne 3 -or
            -not $softIds.Contains('SCREEN-1') -or
            -not $softIds.Contains('SCREEN-2') -or
            -not $softIds.Contains('SCREEN-3')
        )) -or
        ($mode -ceq 'single-display-preview' -and (
            $bindings.Count -ne 1 -or
            $bindings[0].softId -cne 'SCREEN-1' -or
            $unassigned.Count -ne 0
        )) -or
        (Get-DisplayTopologyV2Sha256 -Displays @($bindings + $unassigned) -Reason $Reason) -cne $topologySha256
    ) {
        throw $Reason
    }
}

function Test-PositiveInteger {
    param([Parameter(Mandatory = $true)][object]$Value)

    return ($Value -is [int] -or $Value -is [long]) -and [long]$Value -gt 0
}

function Test-ExactJsonInteger {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][long]$Expected
    )

    return ($Value -is [int] -or $Value -is [long]) -and [long]$Value -eq $Expected
}

function Test-ExactJsonTrue {
    param([Parameter(Mandatory = $true)][object]$Value)

    return $Value -is [bool] -and $Value -eq $true
}

function Get-CreationTimeProof {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Value -isnot [string]) {
        throw "$Reason-type"
    }
    if ($Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$') {
        throw "$Reason-format"
    }
    $parsed = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParse(
        $Value,
        [Globalization.CultureInfo]::InvariantCulture,
        $styles,
        [ref]$parsed
    )) {
        throw "$Reason-parse"
    }
    return [pscustomobject]@{
        Milliseconds = $parsed.ToUnixTimeMilliseconds()
        UtcTicks = $parsed.UtcDateTime.Ticks
    }
}

function Normalize-Hwnd {
    param(
        [Parameter(Mandatory = $true)][object]$Value,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Value -isnot [string] -or $Value -cnotmatch '^0x(?<digits>[0-9A-Fa-f]{1,16})$') {
        throw $Reason
    }
    $handleValue = [UInt64]0
    if (-not [UInt64]::TryParse(
        $Matches['digits'],
        [Globalization.NumberStyles]::AllowHexSpecifier,
        [Globalization.CultureInfo]::InvariantCulture,
        [ref]$handleValue
    ) -or $handleValue -eq 0) {
        throw $Reason
    }
    return '0x{0:X16}' -f $handleValue
}

function Invoke-BoundedProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][int]$TimeoutMilliseconds,
        [Parameter(Mandatory = $true)][int]$MaximumOutputBytes,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.WorkingDirectory = $WorkingDirectory
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $stdoutSink = [JanVimExhibitionBoundedOutputV1]::new($MaximumOutputBytes)
    $stderrSink = [JanVimExhibitionBoundedOutputV1]::new($MaximumOutputBytes)
    try {
        if (-not $process.Start()) {
            throw $Reason
        }
        $stdoutTask = $process.StandardOutput.BaseStream.CopyToAsync($stdoutSink)
        $stderrTask = $process.StandardError.BaseStream.CopyToAsync($stderrSink)
        $copyTasks = [Threading.Tasks.Task[]]@($stdoutTask, $stderrTask)
        $processClock = [Diagnostics.Stopwatch]::StartNew()
        $processFailure = $null
        while ($true) {
            if ($stdoutTask.IsFaulted -or $stderrTask.IsFaulted) {
                $processFailure = 'output-limit'
                break
            }
            if ($process.WaitForExit(25)) {
                break
            }
            if ($processClock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
                $processFailure = 'timeout'
                break
            }
        }
        if ($null -ne $processFailure) {
            try {
                if (-not $process.HasExited) {
                    $process.Kill($true)
                }
                [void]$process.WaitForExit(2000)
            }
            catch {
            }
        }
        $copyCompleted = $false
        try {
            $copyCompleted = [Threading.Tasks.Task]::WaitAll($copyTasks, 2000)
        }
        catch {
        }
        if (
            $null -ne $processFailure -or
            -not $copyCompleted -or
            $stdoutTask.IsFaulted -or
            $stderrTask.IsFaulted
        ) {
            throw $Reason
        }
        $stdout = [Text.UTF8Encoding]::new($false, $true).GetString($stdoutSink.ToArray())
        $stderr = [Text.UTF8Encoding]::new($false, $true).GetString($stderrSink.ToArray())
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Stdout = $stdout
            Stderr = $stderr
        }
    }
    finally {
        $stdoutSink.Dispose()
        $stderrSink.Dispose()
        $process.Dispose()
    }
}

function Write-ControllerIncident {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][int]$ControllerProcessId,
        [Parameter(Mandatory = $true)][int]$ControllerExitCode
    )

    $record = [ordered]@{
        schema = 1
        runId = $RunId
        controllerRunId = $ControllerRunId
        controllerPid = $ControllerProcessId
        controllerExitCode = $ControllerExitCode
        reason = $Reason
        occurredAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    }
    $serialized = ($record | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes($serialized)
    if ($bytes.Length -gt $maximumJsonBytes) {
        throw 'controller-incident-too-large'
    }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    }
    finally {
        $stream.Dispose()
    }
}

function Write-WatchdogAttempt {
    param(
        [Parameter(Mandatory = $true)][IO.FileStream]$Stream,
        [Parameter(Mandatory = $true)][IO.StreamWriter]$Writer,
        [Parameter(Mandatory = $true)][object]$TopLevelRunId,
        [Parameter(Mandatory = $true)][object]$FailedControllerRunId,
        [Parameter(Mandatory = $true)][object]$FailedControllerProcessId,
        [Parameter(Mandatory = $true)][object]$FailedControllerExitCode,
        [Parameter(Mandatory = $true)][object]$Attempt,
        [Parameter(Mandatory = $true)][object]$DelayMilliseconds,
        [Parameter(Mandatory = $true)][object]$ObservedAtMonotonicMilliseconds
    )

    if (
        $TopLevelRunId -isnot [string] -or
        $TopLevelRunId -cnotmatch '^[A-Za-z0-9._-]{1,64}$' -or
        $FailedControllerRunId -isnot [string] -or
        $FailedControllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
        -not (Test-PositiveInteger -Value $FailedControllerProcessId) -or
        [long]$FailedControllerProcessId -gt [int]::MaxValue -or
        -not (Test-JsonInteger -Value $FailedControllerExitCode) -or
        [long]$FailedControllerExitCode -lt [int]::MinValue -or
        [long]$FailedControllerExitCode -gt [int]::MaxValue -or
        -not (Test-PositiveInteger -Value $Attempt) -or
        [long]$Attempt -gt $restartDelaysMilliseconds.Count -or
        -not (Test-PositiveInteger -Value $DelayMilliseconds) -or
        [long]$DelayMilliseconds -ne [long]$restartDelaysMilliseconds[[int]$Attempt - 1] -or
        -not (Test-JsonInteger -Value $ObservedAtMonotonicMilliseconds) -or
        [long]$ObservedAtMonotonicMilliseconds -lt 0 -or
        [long]$ObservedAtMonotonicMilliseconds -gt $maximumWatchdogMonotonicMilliseconds -or
        -not [object]::ReferenceEquals($Writer.BaseStream, $Stream) -or
        -not $Stream.CanWrite
    ) {
        throw 'watchdog-attempt-invalid'
    }

    $record = [ordered]@{
        schema = 1
        runId = [string]$TopLevelRunId
        failedControllerRunId = [string]$FailedControllerRunId
        failedControllerPid = [int]$FailedControllerProcessId
        failedControllerExitCode = [int]$FailedControllerExitCode
        attempt = [int]$Attempt
        delayMs = [int]$DelayMilliseconds
        observedAtMonotonicMs = [long]$ObservedAtMonotonicMilliseconds
    }
    $serialized = $record | ConvertTo-Json -Compress -Depth 4
    if ($serialized -match '[\r\n]') {
        throw 'watchdog-attempt-invalid'
    }

    $Writer.Flush()
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    $recordBytes = $encoding.GetByteCount($serialized + $Writer.NewLine)
    if (
        $recordBytes -lt 1 -or
        $recordBytes -gt $maximumWatchdogAttemptsBytes -or
        $Stream.Length -gt $maximumWatchdogAttemptsBytes - $recordBytes
    ) {
        throw 'watchdog-attempt-size-limit-exceeded'
    }

    $Writer.WriteLine($serialized)
    $Writer.Flush()
    $Stream.Flush($true)
    if ($Stream.Length -gt $maximumWatchdogAttemptsBytes) {
        throw 'watchdog-attempt-size-limit-exceeded'
    }
}

function Read-StrictTerminalMarker {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][int]$ControllerProcessId,
        [Parameter(Mandatory = $true)][int]$ControllerExitCode
    )

    $marker = Read-BoundedJson -Path $Path -MaximumBytes $maximumJsonBytes -Reason 'controller-terminal-invalid'
    Assert-ExactPropertySet -InputObject $marker -ExpectedNames @(
        'schema', 'runId', 'controllerRunId', 'controllerPid', 'outcome', 'reason'
    ) -Reason 'controller-terminal-invalid'
    $markerSchema = Get-RequiredPropertyValue -InputObject $marker -Name 'schema' -Reason 'controller-terminal-invalid'
    $markerRunId = Get-RequiredPropertyValue -InputObject $marker -Name 'runId' -Reason 'controller-terminal-invalid'
    $markerControllerRunId = Get-RequiredPropertyValue -InputObject $marker -Name 'controllerRunId' -Reason 'controller-terminal-invalid'
    $markerProcessId = Get-RequiredPropertyValue -InputObject $marker -Name 'controllerPid' -Reason 'controller-terminal-invalid'
    if (
        -not (Test-ExactJsonInteger -Value $markerSchema -Expected 1) -or
        $markerRunId -isnot [string] -or
        $markerRunId -cne $RunId -or
        $markerControllerRunId -isnot [string] -or
        $markerControllerRunId -cne $ControllerRunId -or
        -not (Test-PositiveInteger -Value $markerProcessId) -or
        [long]$markerProcessId -gt [int]::MaxValue -or
        [int]$markerProcessId -ne $ControllerProcessId
    ) {
        throw 'controller-terminal-invalid'
    }
    $outcome = Get-RequiredPropertyValue -InputObject $marker -Name 'outcome' -Reason 'controller-terminal-invalid'
    $reason = Get-RequiredPropertyValue -InputObject $marker -Name 'reason' -Reason 'controller-terminal-invalid'
    if (
        $outcome -isnot [string] -or
        $outcome -cnotin @('intentional-success', 'intentional-failure') -or
        $reason -isnot [string] -or
        $reason -cnotmatch '^[a-z0-9-]{1,128}$'
    ) {
        throw 'controller-terminal-invalid'
    }
    if (
        ($outcome -ceq 'intentional-success' -and $ControllerExitCode -ne 0) -or
        ($outcome -ceq 'intentional-failure' -and $ControllerExitCode -eq 0)
    ) {
        throw 'controller-terminal-invalid'
    }
    return $marker
}

function Test-ShowEvidenceRectangleEqual {
    param(
        [Parameter(Mandatory = $true)][object]$Left,
        [Parameter(Mandatory = $true)][object]$Right
    )

    return (
        [long]$Left.x -eq [long]$Right.x -and
        [long]$Left.y -eq [long]$Right.y -and
        [long]$Left.width -eq [long]$Right.width -and
        [long]$Left.height -eq [long]$Right.height
    )
}

function Assert-ShowEvidenceCompatibilityDisplay {
    param(
        [Parameter(Mandatory = $true)][object]$Display,
        [Parameter(Mandatory = $true)][string]$Reason,
        [object]$ExpectedBinding
    )

    if ($Display -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet `
        -InputObject $Display `
        -ExpectedNames @('id', 'bounds', 'workingArea', 'scaleFactor', 'rotation', 'geometrySha256') `
        -Reason $Reason
    $displayId = Get-RequiredPropertyValue -InputObject $Display -Name 'id' -Reason $Reason
    $bounds = Get-RequiredPropertyValue -InputObject $Display -Name 'bounds' -Reason $Reason
    $workingArea = Get-RequiredPropertyValue -InputObject $Display -Name 'workingArea' -Reason $Reason
    $scaleFactor = Get-RequiredPropertyValue -InputObject $Display -Name 'scaleFactor' -Reason $Reason
    $rotation = Get-RequiredPropertyValue -InputObject $Display -Name 'rotation' -Reason $Reason
    $geometrySha256 = Get-RequiredPropertyValue -InputObject $Display -Name 'geometrySha256' -Reason $Reason
    Assert-DisplayRoutingText -Value $displayId -MaximumBytes 256 -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $bounds -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $workingArea -Reason $Reason
    if (
        -not (Test-FinitePositiveJsonNumber -Value $scaleFactor) -or
        -not (Test-SafeDisplayJsonInteger -Value $rotation) -or
        [long]$rotation -cnotin @(0L, 90L, 180L, 270L) -or
        -not (Test-HashValue -Value $geometrySha256)
    ) {
        throw $Reason
    }
    $legacyRole = [pscustomobject]@{
        displayId = [string]$displayId
        bounds = $bounds
        scaleFactor = $scaleFactor
    }
    if ((Get-DisplayGeometrySha256 -Role $legacyRole) -cne $geometrySha256) {
        throw $Reason
    }
    if ($null -ne $ExpectedBinding) {
        if (
            $ExpectedBinding -isnot [pscustomobject] -or
            [string]$displayId -cne [string]$ExpectedBinding.displayId -or
            -not (Test-ShowEvidenceRectangleEqual -Left $bounds -Right $ExpectedBinding.bounds) -or
            -not (Test-ShowEvidenceRectangleEqual -Left $workingArea -Right $ExpectedBinding.workingArea) -or
            [double]$scaleFactor -ne [double]$ExpectedBinding.scaleFactor -or
            [long]$rotation -ne [long]$ExpectedBinding.rotation
        ) {
            throw $Reason
        }
    }
}

function Get-ExpectedDisplayBinding {
    param(
        [Parameter(Mandatory = $true)][pscustomobject]$DisplayMap,
        [Parameter(Mandatory = $true)][string]$SoftId,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    $matches = @($DisplayMap.bindings | Where-Object { $_.softId -ceq $SoftId })
    if ($matches.Count -ne 1) {
        throw $Reason
    }
    return $matches[0]
}

function Assert-ShowEvidenceRoutingRole {
    param(
        [Parameter(Mandatory = $true)][object]$Role,
        [Parameter(Mandatory = $true)][pscustomobject]$ExpectedBinding,
        [Parameter(Mandatory = $true)][string]$ExpectedSoftId,
        [Parameter(Mandatory = $true)][string]$Reason
    )

    if ($Role -isnot [pscustomobject]) {
        throw $Reason
    }
    Assert-ExactPropertySet `
        -InputObject $Role `
        -ExpectedNames @('softId', 'displayId', 'bounds', 'workingArea', 'scaleFactor', 'rotation', 'geometrySha256') `
        -Reason $Reason
    $softId = Get-RequiredPropertyValue -InputObject $Role -Name 'softId' -Reason $Reason
    $displayId = Get-RequiredPropertyValue -InputObject $Role -Name 'displayId' -Reason $Reason
    $bounds = Get-RequiredPropertyValue -InputObject $Role -Name 'bounds' -Reason $Reason
    $workingArea = Get-RequiredPropertyValue -InputObject $Role -Name 'workingArea' -Reason $Reason
    $scaleFactor = Get-RequiredPropertyValue -InputObject $Role -Name 'scaleFactor' -Reason $Reason
    $rotation = Get-RequiredPropertyValue -InputObject $Role -Name 'rotation' -Reason $Reason
    $geometrySha256 = Get-RequiredPropertyValue -InputObject $Role -Name 'geometrySha256' -Reason $Reason
    Assert-DisplayRoutingText -Value $displayId -MaximumBytes 256 -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $bounds -Reason $Reason
    Assert-DisplayRectangleV2 -Rectangle $workingArea -Reason $Reason
    if (
        $softId -isnot [string] -or
        $softId -cne $ExpectedSoftId -or
        $displayId -cne [string]$ExpectedBinding.displayId -or
        -not (Test-FinitePositiveJsonNumber -Value $scaleFactor) -or
        -not (Test-SafeDisplayJsonInteger -Value $rotation) -or
        [long]$rotation -cnotin @(0L, 90L, 180L, 270L) -or
        -not (Test-HashValue -Value $geometrySha256) -or
        -not (Test-ShowEvidenceRectangleEqual -Left $bounds -Right $ExpectedBinding.bounds) -or
        -not (Test-ShowEvidenceRectangleEqual -Left $workingArea -Right $ExpectedBinding.workingArea) -or
        [double]$scaleFactor -ne [double]$ExpectedBinding.scaleFactor -or
        [long]$rotation -ne [long]$ExpectedBinding.rotation
    ) {
        throw $Reason
    }
    $physical = [pscustomobject]@{
        displayId = [string]$displayId
        bounds = $bounds
        workingArea = $workingArea
        scaleFactor = $scaleFactor
        rotation = $rotation
    }
    if (
        (Get-DisplayGeometryV2Sha256 -Display $physical -Reason $Reason) -cne $geometrySha256 -or
        $geometrySha256 -cne [string]$ExpectedBinding.geometrySha256
    ) {
        throw $Reason
    }
}

function Read-StrictShowRunIdentityEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][string]$ExpectedMode,
        [Parameter(Mandatory = $true)][string]$ExpectedDisplayMapSha256,
        [Parameter(Mandatory = $true)][long]$ExpectedDisplayMapSchema,
        [Parameter(Mandatory = $true)][pscustomobject]$ExpectedDisplayMap,
        [Parameter(Mandatory = $true)][string]$ExpectedDisplayLayoutSha256,
        [Parameter(Mandatory = $true)][string]$ExpectedArtifactTag,
        [Parameter(Mandatory = $true)][string]$ExpectedArtifactCommit,
        [Parameter(Mandatory = $true)][string]$ExpectedArtifactLayoutEngine,
        [Parameter(Mandatory = $true)][string]$ExpectedArtifactLockSha256,
        [Parameter(Mandatory = $true)][long]$ExpectedCoreBytes,
        [Parameter(Mandatory = $true)][string]$ExpectedCoreSha256,
        [Parameter(Mandatory = $true)][string]$ExpectedContentRevision,
        [Parameter(Mandatory = $true)][long]$ExpectedManifestBytes,
        [Parameter(Mandatory = $true)][string]$ExpectedManifestSha256,
        [Parameter(Mandatory = $true)][long]$ExpectedPoemBytes,
        [Parameter(Mandatory = $true)][string]$ExpectedPoemSha256,
        [Parameter(Mandatory = $true)][string]$ExpectedConfigSha256
    )

    $reason = 'show-run-evidence-invalid'
    $evidence = Read-BoundedJson `
        -Path $Path `
        -MaximumBytes $maximumEvidenceBytes `
        -Reason $reason
    $expectedTopLevelNames = @(
        'schema',
        'runId',
        'controllerRunId',
        'mode',
        'acceptanceScope',
        'physicalProjectorsTested',
        'display',
        'artifact',
        'content',
        'offlineSnapshots',
        'offlineVerified',
        'loops',
        'aggregate',
        'recoveries',
        'shutdown',
        'loggingIncomplete',
        'operatorNotes'
    )
    if ($ExpectedDisplayMapSchema -eq 2) {
        $expectedTopLevelNames += 'routing'
    }
    Assert-ExactPropertySet -InputObject $evidence -ExpectedNames $expectedTopLevelNames -Reason $reason

    $display = Get-RequiredPropertyValue -InputObject $evidence -Name 'display' -Reason $reason
    $artifact = Get-RequiredPropertyValue -InputObject $evidence -Name 'artifact' -Reason $reason
    $content = Get-RequiredPropertyValue -InputObject $evidence -Name 'content' -Reason $reason
    $aggregate = Get-RequiredPropertyValue -InputObject $evidence -Name 'aggregate' -Reason $reason
    $shutdown = Get-RequiredPropertyValue -InputObject $evidence -Name 'shutdown' -Reason $reason
    if (
        $display -isnot [pscustomobject] -or
        $artifact -isnot [pscustomobject] -or
        $content -isnot [pscustomobject] -or
        $aggregate -isnot [pscustomobject] -or
        $shutdown -isnot [pscustomobject]
    ) {
        throw $reason
    }
    $expectedDisplayNames = @('mapSha256', 'primary')
    if (
        $ExpectedDisplayMapSchema -eq 1 -or
        ($ExpectedDisplayMapSchema -eq 2 -and $ExpectedDisplayMap.mode -ceq 'production-3')
    ) {
        $expectedDisplayNames += 'secondary'
    }
    Assert-ExactPropertySet -InputObject $display -ExpectedNames $expectedDisplayNames -Reason $reason
    Assert-ExactPropertySet -InputObject $artifact -ExpectedNames @(
        'tag', 'commit', 'layoutEngine', 'lockSha256', 'coreBytes', 'coreSha256'
    ) -Reason $reason
    Assert-ExactPropertySet -InputObject $content -ExpectedNames @(
        'revision',
        'manifestBytes',
        'manifestSha256',
        'poemBytes',
        'poemSha256',
        'configSha256',
        'mediaManifest'
    ) -Reason $reason

    $schema = Get-RequiredPropertyValue -InputObject $evidence -Name 'schema' -Reason $reason
    $evidenceRunId = Get-RequiredPropertyValue -InputObject $evidence -Name 'runId' -Reason $reason
    $evidenceControllerRunId = Get-RequiredPropertyValue -InputObject $evidence -Name 'controllerRunId' -Reason $reason
    $evidenceMode = Get-RequiredPropertyValue -InputObject $evidence -Name 'mode' -Reason $reason
    $acceptanceScope = Get-RequiredPropertyValue -InputObject $evidence -Name 'acceptanceScope' -Reason $reason
    $physicalProjectorsTested = Get-RequiredPropertyValue -InputObject $evidence -Name 'physicalProjectorsTested' -Reason $reason
    $offlineSnapshots = Get-RequiredPropertyValue -InputObject $evidence -Name 'offlineSnapshots' -Reason $reason
    $offlineVerified = Get-RequiredPropertyValue -InputObject $evidence -Name 'offlineVerified' -Reason $reason
    $loops = Get-RequiredPropertyValue -InputObject $evidence -Name 'loops' -Reason $reason
    $recoveries = Get-RequiredPropertyValue -InputObject $evidence -Name 'recoveries' -Reason $reason
    $loggingIncomplete = Get-RequiredPropertyValue -InputObject $evidence -Name 'loggingIncomplete' -Reason $reason
    $operatorNotes = Get-RequiredPropertyValue -InputObject $evidence -Name 'operatorNotes' -Reason $reason
    if (
        -not (Test-ExactJsonInteger -Value $schema -Expected 2) -or
        $evidenceRunId -isnot [string] -or
        $evidenceRunId -cne $RunId -or
        $evidenceControllerRunId -isnot [string] -or
        $evidenceControllerRunId -cne $ControllerRunId -or
        $evidenceMode -isnot [string] -or
        $evidenceMode -cne $ExpectedMode -or
        $acceptanceScope -isnot [string] -or
        $acceptanceScope -cnotin @('monitor-simulation', 'physical-projectors', 'single-display-preview') -or
        $physicalProjectorsTested -isnot [bool] -or
        $offlineSnapshots -isnot [array] -or
        $offlineVerified -isnot [bool] -or
        $loops -isnot [array] -or
        $recoveries -isnot [array] -or
        $loggingIncomplete -isnot [bool] -or
        $operatorNotes -isnot [array]
    ) {
        throw $reason
    }

    $displayMapSha256 = Get-RequiredPropertyValue -InputObject $display -Name 'mapSha256' -Reason $reason
    $displayPrimary = Get-RequiredPropertyValue -InputObject $display -Name 'primary' -Reason $reason
    $displaySecondary = $null
    if ($expectedDisplayNames -ccontains 'secondary') {
        $displaySecondary = Get-RequiredPropertyValue -InputObject $display -Name 'secondary' -Reason $reason
    }
    if (
        -not (Test-HashValue -Value $displayMapSha256) -or
        $displayMapSha256 -cne $ExpectedDisplayMapSha256 -or
        $displayPrimary -isnot [pscustomobject] -or
        ($expectedDisplayNames -ccontains 'secondary' -and $displaySecondary -isnot [pscustomobject])
    ) {
        throw $reason
    }

    if ($ExpectedDisplayMapSchema -eq 1) {
        if ($acceptanceScope -ceq 'single-display-preview') {
            throw $reason
        }
    }
    elseif ($ExpectedDisplayMapSchema -eq 2) {
        $routing = Get-RequiredPropertyValue -InputObject $evidence -Name 'routing' -Reason $reason
        if ($routing -isnot [pscustomobject]) {
            throw $reason
        }
        Assert-ExactPropertySet `
            -InputObject $routing `
            -ExpectedNames @(
                'mode',
                'layoutSha256',
                'mapSha256',
                'topologySha256',
                'selectedRoles',
                'skippedRoles',
                'unassignedDisplayCount',
                'standbyUsed',
                'topologyStopped'
            ) `
            -Reason $reason
        $routingMode = Get-RequiredPropertyValue -InputObject $routing -Name 'mode' -Reason $reason
        $layoutSha256 = Get-RequiredPropertyValue -InputObject $routing -Name 'layoutSha256' -Reason $reason
        $routingMapSha256 = Get-RequiredPropertyValue -InputObject $routing -Name 'mapSha256' -Reason $reason
        $topologySha256 = Get-RequiredPropertyValue -InputObject $routing -Name 'topologySha256' -Reason $reason
        $selectedRolesValue = Get-RequiredPropertyValue -InputObject $routing -Name 'selectedRoles' -Reason $reason
        $skippedRolesValue = Get-RequiredPropertyValue -InputObject $routing -Name 'skippedRoles' -Reason $reason
        $unassignedDisplayCount = Get-RequiredPropertyValue -InputObject $routing -Name 'unassignedDisplayCount' -Reason $reason
        $standbyUsed = Get-RequiredPropertyValue -InputObject $routing -Name 'standbyUsed' -Reason $reason
        $topologyStopped = Get-RequiredPropertyValue -InputObject $routing -Name 'topologyStopped' -Reason $reason
        if (
            $routingMode -isnot [string] -or
            $routingMode -cne [string]$ExpectedDisplayMap.mode -or
            -not (Test-HashValue -Value $layoutSha256) -or
            $layoutSha256 -cne $ExpectedDisplayLayoutSha256 -or
            -not (Test-HashValue -Value $routingMapSha256) -or
            $routingMapSha256 -cne $ExpectedDisplayMapSha256 -or
            -not (Test-HashValue -Value $topologySha256) -or
            $topologySha256 -cne [string]$ExpectedDisplayMap.topologySha256 -or
            $selectedRolesValue -isnot [array] -or
            $skippedRolesValue -isnot [array] -or
            -not (Test-SafeDisplayJsonInteger -Value $unassignedDisplayCount) -or
            [long]$unassignedDisplayCount -lt 0 -or
            $standbyUsed -isnot [bool] -or
            $topologyStopped -isnot [bool]
        ) {
            throw $reason
        }
        $selectedRoles = @($routing.selectedRoles)
        $skippedRoles = @($routing.skippedRoles)
        $expectedSoftIds = if ($routingMode -ceq 'production-3') {
            @('SCREEN-1', 'SCREEN-2', 'SCREEN-3')
        }
        else {
            @('SCREEN-1')
        }
        [string[]]$expectedSkippedRoles = @()
        if ($routingMode -ceq 'single-display-preview') {
            $expectedSkippedRoles = @('SCREEN-2', 'SCREEN-3')
        }
        if (
            $selectedRoles.Count -ne $expectedSoftIds.Count -or
            $selectedRoles.Count + [long]$unassignedDisplayCount -gt 16 -or
            [string]::Join(',', $skippedRoles) -cne [string]::Join(',', $expectedSkippedRoles) -or
            $standbyUsed -ne ($routingMode -ceq 'production-3')
        ) {
            throw $reason
        }
        for ($index = 0; $index -lt $expectedSoftIds.Count; $index += 1) {
            $expectedBinding = Get-ExpectedDisplayBinding `
                -DisplayMap $ExpectedDisplayMap `
                -SoftId $expectedSoftIds[$index] `
                -Reason $reason
            Assert-ShowEvidenceRoutingRole `
                -Role $selectedRoles[$index] `
                -ExpectedBinding $expectedBinding `
                -ExpectedSoftId $expectedSoftIds[$index] `
                -Reason $reason
        }
        $primaryBinding = Get-ExpectedDisplayBinding `
            -DisplayMap $ExpectedDisplayMap `
            -SoftId 'SCREEN-1' `
            -Reason $reason
        Assert-ShowEvidenceCompatibilityDisplay `
            -Display $displayPrimary `
            -ExpectedBinding $primaryBinding `
            -Reason $reason
        if ($routingMode -ceq 'production-3') {
            if ($acceptanceScope -ceq 'single-display-preview') {
                throw $reason
            }
            $secondaryBinding = Get-ExpectedDisplayBinding `
                -DisplayMap $ExpectedDisplayMap `
                -SoftId 'SCREEN-2' `
                -Reason $reason
            Assert-ShowEvidenceCompatibilityDisplay `
                -Display $displaySecondary `
                -ExpectedBinding $secondaryBinding `
                -Reason $reason
        }
        elseif (
            $acceptanceScope -cne 'single-display-preview' -or
            $physicalProjectorsTested
        ) {
            throw $reason
        }
    }
    else {
        throw $reason
    }

    $artifactTag = Get-RequiredPropertyValue -InputObject $artifact -Name 'tag' -Reason $reason
    $artifactCommit = Get-RequiredPropertyValue -InputObject $artifact -Name 'commit' -Reason $reason
    $artifactLayoutEngine = Get-RequiredPropertyValue -InputObject $artifact -Name 'layoutEngine' -Reason $reason
    $artifactLockSha256 = Get-RequiredPropertyValue -InputObject $artifact -Name 'lockSha256' -Reason $reason
    $artifactCoreBytes = Get-RequiredPropertyValue -InputObject $artifact -Name 'coreBytes' -Reason $reason
    $artifactCoreSha256 = Get-RequiredPropertyValue -InputObject $artifact -Name 'coreSha256' -Reason $reason
    if (
        $artifactTag -isnot [string] -or
        $artifactTag -cne $ExpectedArtifactTag -or
        $artifactCommit -isnot [string] -or
        $artifactCommit -cne $ExpectedArtifactCommit -or
        $artifactLayoutEngine -isnot [string] -or
        $artifactLayoutEngine -cne $ExpectedArtifactLayoutEngine -or
        -not (Test-HashValue -Value $artifactLockSha256) -or
        $artifactLockSha256 -cne $ExpectedArtifactLockSha256 -or
        -not (Test-ExactJsonInteger -Value $artifactCoreBytes -Expected $ExpectedCoreBytes) -or
        -not (Test-HashValue -Value $artifactCoreSha256) -or
        $artifactCoreSha256 -cne $ExpectedCoreSha256
    ) {
        throw $reason
    }

    $contentRevision = Get-RequiredPropertyValue -InputObject $content -Name 'revision' -Reason $reason
    $manifestBytes = Get-RequiredPropertyValue -InputObject $content -Name 'manifestBytes' -Reason $reason
    $manifestSha256 = Get-RequiredPropertyValue -InputObject $content -Name 'manifestSha256' -Reason $reason
    $poemBytes = Get-RequiredPropertyValue -InputObject $content -Name 'poemBytes' -Reason $reason
    $poemSha256 = Get-RequiredPropertyValue -InputObject $content -Name 'poemSha256' -Reason $reason
    $configSha256 = Get-RequiredPropertyValue -InputObject $content -Name 'configSha256' -Reason $reason
    $mediaManifest = Get-RequiredPropertyValue -InputObject $content -Name 'mediaManifest' -Reason $reason
    if (
        $contentRevision -isnot [string] -or
        $contentRevision -cne $ExpectedContentRevision -or
        -not (Test-ExactJsonInteger -Value $manifestBytes -Expected $ExpectedManifestBytes) -or
        -not (Test-HashValue -Value $manifestSha256) -or
        $manifestSha256 -cne $ExpectedManifestSha256 -or
        -not (Test-ExactJsonInteger -Value $poemBytes -Expected $ExpectedPoemBytes) -or
        -not (Test-HashValue -Value $poemSha256) -or
        $poemSha256 -cne $ExpectedPoemSha256 -or
        -not (Test-HashValue -Value $configSha256) -or
        $configSha256 -cne $ExpectedConfigSha256 -or
        $mediaManifest -isnot [pscustomobject]
    ) {
        throw $reason
    }
    return $evidence
}

function Read-StrictLeaseSnapshot {
    param([Parameter(Mandatory = $true)][JanVimExhibitionLeaseClaimV1]$Claim)

    try {
        $lease = $Claim.Text | ConvertFrom-Json -Depth 64 -DateKind String
    }
    catch {
        throw 'run-lease-json-invalid'
    }
    if ($null -eq $lease -or $lease -isnot [psobject]) {
        throw 'run-lease-json-invalid'
    }
    Assert-ExactPropertySet -InputObject $lease -ExpectedNames @(
        'schema', 'runId', 'controllerRunId', 'generationId', 'controller', 'janvim'
    ) -Reason 'run-lease-top-fields-invalid'
    $controllerIdentity = Get-RequiredPropertyValue -InputObject $lease -Name 'controller' -Reason 'run-lease-controller-missing'
    $janvimIdentity = Get-RequiredPropertyValue -InputObject $lease -Name 'janvim' -Reason 'run-lease-janvim-missing'
    if ($controllerIdentity -isnot [psobject] -or $janvimIdentity -isnot [psobject]) {
        throw 'run-lease-nested-types-invalid'
    }
    Assert-ExactPropertySet -InputObject $controllerIdentity -ExpectedNames @('pid', 'startedAtUtc') -Reason 'run-lease-controller-fields-invalid'
    Assert-ExactPropertySet -InputObject $janvimIdentity -ExpectedNames @(
        'pid', 'startedAtUtc', 'hwnd', 'executableRelativePath', 'executableSha256'
    ) -Reason 'run-lease-janvim-fields-invalid'

    $schema = Get-RequiredPropertyValue -InputObject $lease -Name 'schema' -Reason 'run-lease-invalid'
    $leaseRunId = Get-RequiredPropertyValue -InputObject $lease -Name 'runId' -Reason 'run-lease-invalid'
    $leaseControllerRunId = Get-RequiredPropertyValue -InputObject $lease -Name 'controllerRunId' -Reason 'run-lease-invalid'
    $generationId = Get-RequiredPropertyValue -InputObject $lease -Name 'generationId' -Reason 'run-lease-invalid'
    $controllerProcessId = Get-RequiredPropertyValue -InputObject $controllerIdentity -Name 'pid' -Reason 'run-lease-invalid'
    $controllerStartedAtUtc = Get-RequiredPropertyValue -InputObject $controllerIdentity -Name 'startedAtUtc' -Reason 'run-lease-invalid'
    $janvimProcessId = Get-RequiredPropertyValue -InputObject $janvimIdentity -Name 'pid' -Reason 'run-lease-invalid'
    $janvimStartedAtUtc = Get-RequiredPropertyValue -InputObject $janvimIdentity -Name 'startedAtUtc' -Reason 'run-lease-invalid'
    $janvimHwnd = Get-RequiredPropertyValue -InputObject $janvimIdentity -Name 'hwnd' -Reason 'run-lease-invalid'
    $relativeExecutable = Get-RequiredPropertyValue -InputObject $janvimIdentity -Name 'executableRelativePath' -Reason 'run-lease-invalid'
    $executableSha256 = Get-RequiredPropertyValue -InputObject $janvimIdentity -Name 'executableSha256' -Reason 'run-lease-invalid'

    if (
        -not (Test-ExactJsonInteger -Value $schema -Expected 1) -or
        $leaseRunId -isnot [string] -or $leaseRunId -cne $RunId -or
        $leaseControllerRunId -isnot [string] -or $leaseControllerRunId -cnotmatch '^[A-Za-z0-9._-]{1,96}$' -or
        -not (Test-PositiveInteger -Value $generationId) -or
        -not (Test-PositiveInteger -Value $controllerProcessId) -or
        -not (Test-PositiveInteger -Value $janvimProcessId) -or
        $relativeExecutable -isnot [string] -or $relativeExecutable -cne 'janvim-core.exe' -or
        -not (Test-HashValue -Value $executableSha256)
    ) {
        throw 'run-lease-scalars-invalid'
    }
    $controllerStartedAt = Get-CreationTimeProof -Value $controllerStartedAtUtc -Reason 'run-lease-controller-time-invalid'
    $janvimStartedAt = Get-CreationTimeProof -Value $janvimStartedAtUtc -Reason 'run-lease-janvim-time-invalid'
    $normalizedHwnd = Normalize-Hwnd -Value $janvimHwnd -Reason 'run-lease-hwnd-invalid'

    return [pscustomobject]@{
        Value = $lease
        FileSha256 = $Claim.FileSha256
        ControllerRunId = [string]$leaseControllerRunId
        ControllerProcessId = [int]$controllerProcessId
        ControllerStartedAtMilliseconds = [long]$controllerStartedAt.Milliseconds
        JanVimProcessId = [int]$janvimProcessId
        JanVimStartedAtUtcTicks = [long]$janvimStartedAt.UtcTicks
        JanVimHwnd = [string]$janvimHwnd
        JanVimNormalizedHwnd = $normalizedHwnd
        ExecutableSha256 = [string]$executableSha256
    }
}

function Get-LeaseProof {
    param(
        [Parameter(Mandatory = $true)][psobject]$LeaseSnapshot,
        [Parameter(Mandatory = $true)][string]$ExpectedControllerRunId,
        [Parameter(Mandatory = $true)][int]$ExpectedControllerProcessId,
        [Parameter(Mandatory = $true)][long]$ExpectedControllerStartedAtMilliseconds,
        [Parameter(Mandatory = $true)][psobject]$ArtifactLock,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot
    )

    $janvimProcess = $null
    try {
        $snapshot = $LeaseSnapshot
        if (
            $snapshot.ControllerRunId -cne $ExpectedControllerRunId -or
            $snapshot.ControllerProcessId -ne $ExpectedControllerProcessId -or
            $snapshot.ControllerStartedAtMilliseconds -ne $ExpectedControllerStartedAtMilliseconds
        ) {
            return [pscustomobject]@{ Status = 'unprovable'; Reason = 'controller-identity-mismatch' }
        }

        $expectedCoreHash = Get-RequiredPropertyValue -InputObject $ArtifactLock -Name 'coreSha256' -Reason 'run-lease-invalid'
        $expectedCoreBytes = Get-RequiredPropertyValue -InputObject $ArtifactLock -Name 'coreBytes' -Reason 'run-lease-invalid'
        if (-not (Test-HashValue -Value $expectedCoreHash) -or -not (Test-PositiveInteger -Value $expectedCoreBytes)) {
            return [pscustomobject]@{ Status = 'unprovable'; Reason = 'lock-identity-invalid' }
        }
        if ($snapshot.ExecutableSha256 -cne $expectedCoreHash) {
            return [pscustomobject]@{ Status = 'unprovable'; Reason = 'lease-hash-mismatch' }
        }

        $expectedExecutablePath = Resolve-ShowFullPath -Path (Join-Path $RuntimeRoot 'janvim-core.exe') -Label 'runtime-executable'
        Assert-RequiredLeaf -Path $expectedExecutablePath -Reason 'run-lease-invalid'
        Assert-NotReparsePoint -Path $expectedExecutablePath -Reason 'run-lease-invalid'
        $actualExecutableSha256 = Get-ExactFileSha256 `
            -Path $expectedExecutablePath `
            -ExpectedBytes ([long]$expectedCoreBytes) `
            -Reason 'run-lease-invalid'

        $janvimProcess = Get-Process -Id $snapshot.JanVimProcessId -ErrorAction SilentlyContinue
        if ($null -eq $janvimProcess) {
            return [pscustomobject]@{
                Status = 'janvim-not-found'
                Reason = 'janvim-not-found'
                Snapshot = $snapshot
            }
        }
        try {
            [void]$janvimProcess.Handle
            $actualExecutablePath = Resolve-ShowFullPath -Path $janvimProcess.Path -Label 'janvim-process-path'
            $actualStartedAtUtcTicks = $janvimProcess.StartTime.ToUniversalTime().Ticks
        }
        catch {
            $janvimProcess.Dispose()
            $janvimProcess = $null
            return [pscustomobject]@{ Status = 'unprovable'; Reason = 'process-inspection-failed' }
        }
        if (
            -not (Test-ShowPathEqual -Left $actualExecutablePath -Right $expectedExecutablePath) -or
            $actualStartedAtUtcTicks -ne $snapshot.JanVimStartedAtUtcTicks -or
            $actualExecutableSha256 -cne $snapshot.ExecutableSha256
        ) {
            $janvimProcess.Dispose()
            $janvimProcess = $null
            return [pscustomobject]@{ Status = 'unprovable'; Reason = 'process-identity-mismatch' }
        }
        return [pscustomobject]@{
            Status = 'proven'
            Reason = 'identity-proven'
            Snapshot = $snapshot
            Process = $janvimProcess
        }
    }
    catch {
        if ($null -ne $janvimProcess) {
            $janvimProcess.Dispose()
        }
        return [pscustomobject]@{ Status = 'unprovable'; Reason = 'lease-proof-exception' }
    }
}

function Invoke-ExactWindowClose {
    param(
        [Parameter(Mandatory = $true)][string]$HelperPath,
        [Parameter(Mandatory = $true)][psobject]$LeaseSnapshot,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    $helperArguments = @(
        '-NoProfile'
        '-NonInteractive'
        '-File'
        $HelperPath
        '-ChildProcessId'
        [string]$LeaseSnapshot.JanVimProcessId
        '-Hwnd'
        $LeaseSnapshot.JanVimHwnd
    )
    Assert-NetworkPolicySnapshot -WorkingDirectory $WorkingDirectory
    $result = Invoke-BoundedProcess `
        -FilePath 'pwsh' `
        -Arguments $helperArguments `
        -WorkingDirectory $WorkingDirectory `
        -TimeoutMilliseconds $windowCloseHelperTimeoutMilliseconds `
        -MaximumOutputBytes $windowCloseHelperMaximumOutputBytes `
        -Reason 'window-close-helper-failed'
    if ($result.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($result.Stderr)) {
        throw 'window-close-helper-failed'
    }
    try {
        $receipt = $result.Stdout | ConvertFrom-Json -Depth 8
    }
    catch {
        throw 'window-close-helper-failed'
    }
    Assert-ExactPropertySet -InputObject $receipt -ExpectedNames @(
        'schema', 'pid', 'hwnd', 'ownershipVerified', 'topLevel', 'closePosted'
    ) -Reason 'window-close-helper-failed'
    $receiptHwnd = Normalize-Hwnd `
        -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'hwnd' -Reason 'window-close-helper-failed') `
        -Reason 'window-close-helper-failed'
    if (
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'schema' -Reason 'window-close-helper-failed') -Expected 1) -or
        -not (Test-PositiveInteger -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'pid' -Reason 'window-close-helper-failed')) -or
        [long](Get-RequiredPropertyValue -InputObject $receipt -Name 'pid' -Reason 'window-close-helper-failed') -ne $LeaseSnapshot.JanVimProcessId -or
        $receiptHwnd -cne $LeaseSnapshot.JanVimNormalizedHwnd -or
        -not (Test-ExactJsonTrue -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'ownershipVerified' -Reason 'window-close-helper-failed')) -or
        -not (Test-ExactJsonTrue -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'topLevel' -Reason 'window-close-helper-failed')) -or
        -not (Test-ExactJsonTrue -Value (Get-RequiredPropertyValue -InputObject $receipt -Name 'closePosted' -Reason 'window-close-helper-failed'))
    ) {
        throw 'window-close-helper-failed'
    }
}

function Resolve-UnexpectedLease {
    param(
        [Parameter(Mandatory = $true)][string]$LeasePath,
        [Parameter(Mandatory = $true)][string]$ExpectedControllerRunId,
        [Parameter(Mandatory = $true)][int]$ExpectedControllerProcessId,
        [Parameter(Mandatory = $true)][long]$ExpectedControllerStartedAtMilliseconds,
        [Parameter(Mandatory = $true)][psobject]$ArtifactLock,
        [Parameter(Mandatory = $true)][string]$RuntimeRoot,
        [Parameter(Mandatory = $true)][string]$WindowCloseHelper,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory
    )

    if (-not (Test-Path -LiteralPath $LeasePath -PathType Leaf)) {
        return 'no-lease'
    }
    $leaseClaim = $null
    try {
        try {
            $leaseClaim = [JanVimExhibitionLeaseClaimV1]::Open($LeasePath, $maximumJsonBytes)
            $leaseSnapshot = Read-StrictLeaseSnapshot -Claim $leaseClaim
        }
        catch {
            return 'operator-intervention'
        }

        $proofArguments = @{
            LeaseSnapshot = $leaseSnapshot
            ExpectedControllerRunId = $ExpectedControllerRunId
            ExpectedControllerProcessId = $ExpectedControllerProcessId
            ExpectedControllerStartedAtMilliseconds = $ExpectedControllerStartedAtMilliseconds
            ArtifactLock = $ArtifactLock
            RuntimeRoot = $RuntimeRoot
        }
        $initialProof = Get-LeaseProof @proofArguments
        if ($initialProof.Status -cne 'proven') {
            return 'operator-intervention'
        }
        try {
            Invoke-ExactWindowClose `
                -HelperPath $WindowCloseHelper `
                -LeaseSnapshot $initialProof.Snapshot `
                -WorkingDirectory $WorkingDirectory
            [void]$initialProof.Process.WaitForExit(5000)
        }
        catch {
            return 'operator-intervention'
        }
        finally {
            $initialProof.Process.Dispose()
        }

        $secondProof = Get-LeaseProof @proofArguments
        if (
            $secondProof.Status -ceq 'janvim-not-found' -and
            $secondProof.Snapshot.FileSha256 -ceq $initialProof.Snapshot.FileSha256
        ) {
            try {
                if ($leaseClaim.DeleteIfUnchanged($initialProof.Snapshot.FileSha256)) {
                    return 'settled'
                }
            }
            catch {
            }
            return 'operator-intervention'
        }
        if (
            $secondProof.Status -cne 'proven' -or
            $secondProof.Snapshot.FileSha256 -cne $initialProof.Snapshot.FileSha256
        ) {
            if ($secondProof.Status -ceq 'proven') {
                $secondProof.Process.Dispose()
            }
            return 'operator-intervention'
        }

        try {
            $secondProof.Process.Kill()
            if (-not $secondProof.Process.WaitForExit(5000)) {
                return 'operator-intervention'
            }
        }
        catch {
            return 'operator-intervention'
        }
        finally {
            $secondProof.Process.Dispose()
        }
        $finalProof = Get-LeaseProof @proofArguments
        try {
            if (
                $finalProof.Status -cne 'janvim-not-found' -or
                $finalProof.Snapshot.FileSha256 -cne $initialProof.Snapshot.FileSha256
            ) {
                return 'operator-intervention'
            }
            try {
                if (-not $leaseClaim.DeleteIfUnchanged($initialProof.Snapshot.FileSha256)) {
                    return 'operator-intervention'
                }
            }
            catch {
                return 'operator-intervention'
            }
            return 'settled'
        }
        finally {
            if ($finalProof.Status -ceq 'proven') {
                $finalProof.Process.Dispose()
            }
        }
    }
    finally {
        if ($null -ne $leaseClaim) {
            $leaseClaim.Dispose()
        }
    }
}

function Write-LauncherReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$ControllerRunId,
        [Parameter(Mandatory = $true)][int]$ControllerProcessId,
        [Parameter(Mandatory = $true)][int]$ControllerExitCode,
        [Parameter(Mandatory = $true)][string]$Termination
    )

    [ordered]@{
        schema = 1
        mode = $Mode
        runId = $RunId
        controllerRunId = $ControllerRunId
        controllerPid = $ControllerProcessId
        exitCode = $ControllerExitCode
        termination = $Termination
    } | ConvertTo-Json -Compress
}

function Assert-NetworkPolicySnapshot {
    param([Parameter(Mandatory = $true)][string]$WorkingDirectory)

    $snapshotScript = @'
$ErrorActionPreference = 'Stop'
$WarningPreference = 'Stop'
$InformationPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
Import-Module -Name 'NetTCPIP' -ErrorAction Stop
Import-Module -Name 'NetConnection' -ErrorAction Stop
$routes = @(
    Get-NetRoute -ErrorAction Stop |
        Select-Object -First 1025 |
        ForEach-Object {
            [pscustomobject]@{
                State = [string]$_.State
                DestinationPrefix = [string]$_.DestinationPrefix
            }
        }
)
if ($routes.Count -gt 1024) {
    throw 'network-route-cap-exceeded'
}
$activeExternalRoute = @(
    $routes |
        Where-Object {
            $_.State -ceq 'Alive' -and
                ($_.DestinationPrefix -ceq '0.0.0.0/0' -or
                    $_.DestinationPrefix -ceq '::/0')
        } |
        Select-Object -First 1
).Count
$profiles = @(
    Get-NetConnectionProfile -ErrorAction Stop |
        Select-Object -First 257 |
        ForEach-Object {
            [pscustomobject]@{
                IPv4Connectivity = [string]$_.IPv4Connectivity
                IPv6Connectivity = [string]$_.IPv6Connectivity
            }
        }
)
if ($profiles.Count -gt 256) {
    throw 'network-profile-cap-exceeded'
}
$connectedExternalProfile = @(
    $profiles |
        Where-Object {
            $_.IPv4Connectivity -cin @('Subnet', 'LocalNetwork', 'Internet') -or
                $_.IPv6Connectivity -cin @('Subnet', 'LocalNetwork', 'Internet')
        } |
        Select-Object -First 1
).Count
[ordered]@{
    schema = 1
    activeExternalRoutes = $activeExternalRoute
    connectedExternalProfiles = $connectedExternalProfile
} | ConvertTo-Json -Compress
'@
    $result = Invoke-BoundedProcess `
        -FilePath 'pwsh' `
        -Arguments @('-NoProfile', '-NonInteractive', '-Command', $snapshotScript) `
        -WorkingDirectory $WorkingDirectory `
        -TimeoutMilliseconds 5000 `
        -MaximumOutputBytes $maximumJsonBytes `
        -Reason 'network-snapshot-failed'
    if ($result.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($result.Stderr)) {
        throw 'network-snapshot-failed'
    }
    try {
        $snapshot = $result.Stdout | ConvertFrom-Json -Depth 8 -DateKind String
    }
    catch {
        throw 'network-snapshot-failed'
    }
    Assert-ExactPropertySet -InputObject $snapshot -ExpectedNames @(
        'schema', 'activeExternalRoutes', 'connectedExternalProfiles'
    ) -Reason 'network-snapshot-failed'
    $activeExternalRoutes = Get-RequiredPropertyValue `
        -InputObject $snapshot `
        -Name 'activeExternalRoutes' `
        -Reason 'network-snapshot-failed'
    $connectedProfiles = Get-RequiredPropertyValue `
        -InputObject $snapshot `
        -Name 'connectedExternalProfiles' `
        -Reason 'network-snapshot-failed'
    if (
        -not (Test-ExactJsonInteger `
            -Value (Get-RequiredPropertyValue -InputObject $snapshot -Name 'schema' -Reason 'network-snapshot-failed') `
            -Expected 1) -or
        -not (Test-JsonInteger -Value $activeExternalRoutes) -or
        [long]$activeExternalRoutes -notin @(0L, 1L) -or
        -not (Test-JsonInteger -Value $connectedProfiles) -or
        [long]$connectedProfiles -notin @(0L, 1L)
    ) {
        throw 'network-snapshot-failed'
    }
    if (
        $NetworkPolicy -ceq 'OfflineRequired' -and
        ([long]$activeExternalRoutes -gt 0 -or [long]$connectedProfiles -gt 0)
    ) {
        throw 'offline-network-snapshot-rejected'
    }
}

$repositoryRoot = Resolve-ShowFullPath -Path (Join-Path $PSScriptRoot '..') -Label 'repository-root'
$agentsPath = Join-Path $repositoryRoot 'AGENTS.md'
Assert-RequiredLeaf -Path $agentsPath -Reason 'exhibition-agents-marker-missing'
Assert-NoReparseTraversal -Path $repositoryRoot -Reason 'exhibition-repository-reparse-rejected'
Assert-NoReparseTraversal -Path $agentsPath -Reason 'exhibition-agents-marker-reparse-rejected'
if ((Read-BoundedText -Path $agentsPath -MaximumBytes 65536 -Reason 'exhibition-agents-marker-invalid') -cnotmatch 'JanVim Exhibition 2026 agent instructions') {
    throw 'exhibition-agents-marker-invalid'
}

$resolvedRehearsalRoot = Resolve-ShowFullPath -Path $RehearsalRoot -Label 'rehearsal-root'
$resolvedDisplayMapPath = Resolve-ShowFullPath -Path $DisplayMapPath -Label 'display-map-path'
foreach ($candidate in @($resolvedRehearsalRoot, $resolvedDisplayMapPath)) {
    if (
        (Test-ShowAtOrBelow -Candidate $candidate -Root $repositoryRoot) -or
        (Test-ShowAtOrBelow -Candidate $candidate -Root $janVimProductRoot) -or
        (Test-UserNvimPath -Path $candidate)
    ) {
        throw 'forbidden-show-path'
    }
    foreach ($protectedRoot in $protectedRoots) {
        if (Test-ShowAtOrBelow -Candidate $candidate -Root $protectedRoot) {
            throw 'protected-show-path'
        }
    }
}

$resolvedParent = Resolve-ShowFullPath -Path $rehearsalParent -Label 'rehearsal-parent'
if (-not (Test-ShowPathEqual -Left ([IO.Path]::GetDirectoryName($resolvedRehearsalRoot)) -Right $resolvedParent)) {
    throw 'rehearsal-root-must-be-direct-child'
}
if ($RunId -cne [IO.Path]::GetFileName($resolvedRehearsalRoot)) {
    throw 'run-id-must-match-rehearsal-root'
}
if (
    [IO.Path]::GetFileName($resolvedDisplayMapPath) -cne 'display-map.json' -or
    -not (Test-ShowPathEqual -Left ([IO.Path]::GetDirectoryName($resolvedDisplayMapPath)) -Right $resolvedRehearsalRoot)
) {
    throw 'display-map-must-be-direct-child'
}
if (-not (Test-Path -LiteralPath $resolvedRehearsalRoot -PathType Container)) {
    throw 'rehearsal-root-missing'
}
Assert-RequiredLeaf -Path $resolvedDisplayMapPath -Reason 'display-map-missing'
Assert-NotReparsePoint -Path $resolvedRehearsalRoot -Reason 'rehearsal-root-reparse-rejected'
Assert-NotReparsePoint -Path $resolvedDisplayMapPath -Reason 'display-map-reparse-rejected'
Assert-NoReparseTraversal -Path $resolvedParent -Reason 'rehearsal-parent-reparse-rejected'
Assert-NoReparseTraversal -Path $resolvedRehearsalRoot -Reason 'rehearsal-root-reparse-rejected'
Assert-NoReparseTraversal -Path $resolvedDisplayMapPath -Reason 'display-map-reparse-rejected'

$terminalMarkerPath = Join-Path $resolvedRehearsalRoot 'controller-terminal.json'
$leasePath = Join-Path $resolvedRehearsalRoot 'run-lease.json'
$incidentPath = Join-Path $resolvedRehearsalRoot 'controller-incident.json'
$evidencePath = Join-Path $resolvedRehearsalRoot 'show-run.json'
$watchdogAttemptsPath = Join-Path $resolvedRehearsalRoot 'watchdog-attempts.jsonl'
foreach ($conflictingPath in @(
    $terminalMarkerPath
    $leasePath
    $incidentPath
    $evidencePath
    $watchdogAttemptsPath
)) {
    if (Test-Path -LiteralPath $conflictingPath) {
        throw "conflicting-show-state:$([IO.Path]::GetFileName($conflictingPath))"
    }
}

$displayMapSnapshot = Read-BoundedJsonSnapshot `
    -Path $resolvedDisplayMapPath `
    -MaximumBytes 65536 `
    -Reason 'display-map-invalid'
$displayMap = $displayMapSnapshot.Value
$displayMapSchema = Get-RequiredPropertyValue -InputObject $displayMap -Name 'schema' -Reason 'display-map-invalid'
if (-not (Test-JsonInteger -Value $displayMapSchema)) {
    throw 'display-map-invalid'
}
$displayLayoutPath = Join-Path $repositoryRoot 'show\display-layout.json'
$displayLayoutSnapshot = $null
if ([long]$displayMapSchema -eq 1) {
    Assert-ExactPropertySet `
        -InputObject $displayMap `
        -ExpectedNames @('schema', 'mappingStatus', 'expectedDisplayCount', 'primary', 'secondary') `
        -Reason 'display-map-invalid'
    if (
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $displayMap -Name 'schema' -Reason 'display-map-invalid') -Expected 1) -or
        (Get-RequiredPropertyValue -InputObject $displayMap -Name 'mappingStatus' -Reason 'display-map-invalid') -cne 'confirmed' -or
        -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $displayMap -Name 'expectedDisplayCount' -Reason 'display-map-invalid') -Expected 2)
    ) {
        throw 'display-map-not-confirmed'
    }
    $primaryDisplay = Get-RequiredPropertyValue -InputObject $displayMap -Name 'primary' -Reason 'display-map-invalid'
    $secondaryDisplay = Get-RequiredPropertyValue -InputObject $displayMap -Name 'secondary' -Reason 'display-map-invalid'
    Assert-ConfirmedDisplayRole -Role $primaryDisplay -Reason 'display-map-invalid'
    Assert-ConfirmedDisplayRole -Role $secondaryDisplay -Reason 'display-map-invalid'
    if ($primaryDisplay.displayId -ceq $secondaryDisplay.displayId) {
        throw 'display-map-invalid'
    }
}
elseif ([long]$displayMapSchema -eq 2) {
    Assert-NoDuplicateJsonPropertyNamesForReason `
        -Text $displayMapSnapshot.Text `
        -Reason 'display-map-v2-duplicate-property' `
        -MaximumDepth 16
    Assert-RequiredLeaf -Path $displayLayoutPath -Reason 'display-layout-invalid'
    Assert-NoReparseTraversal -Path $displayLayoutPath -Reason 'display-layout-invalid'
    $displayLayoutSnapshot = Read-BoundedJsonSnapshot `
        -Path $displayLayoutPath `
        -MaximumBytes 16384 `
        -Reason 'display-layout-invalid'
    Assert-NoDuplicateJsonPropertyNamesForReason `
        -Text $displayLayoutSnapshot.Text `
        -Reason 'display-layout-duplicate-property' `
        -MaximumDepth 16
    Assert-DisplayLayoutV1 -Layout $displayLayoutSnapshot.Value -Reason 'display-layout-invalid'
    Assert-DisplayMapV2 `
        -Map $displayMap `
        -ExpectedLayoutSha256 $displayLayoutSnapshot.FileSha256 `
        -Reason 'display-map-invalid'
}
else {
    throw 'display-map-invalid'
}
$expectedDisplayLayoutSha256 = if ($null -eq $displayLayoutSnapshot) {
    $displayMapSnapshot.FileSha256
}
else {
    $displayLayoutSnapshot.FileSha256
}

$controllerPackage = Join-Path $repositoryRoot 'apps\controller'
$controllerPackageManifestPath = Join-Path $controllerPackage 'package.json'
$electronCommand = Join-Path $repositoryRoot 'node_modules\.bin\electron.cmd'
$electronExecutable = Join-Path $repositoryRoot 'node_modules\electron\dist\electron.exe'
$compiledEntry = Join-Path $controllerPackage 'dist\main\electron-main.js'
$moduleGraphVerifier = Join-Path $repositoryRoot 'scripts\verify-electron-module-graph.mjs'
$typescriptParser = Join-Path $repositoryRoot 'node_modules\typescript\lib\typescript.js'
$typescriptPackageManifest = Join-Path $repositoryRoot 'node_modules\typescript\package.json'
$verifyRuntime = Join-Path $repositoryRoot 'scripts\verify-runtime.ps1'
$windowCloseHelper = Join-Path $repositoryRoot 'scripts\close-janvim-window.ps1'
$artifactLockPath = Join-Path $repositoryRoot 'janvim-artifact.lock.json'
$showConfigPath = Join-Path $repositoryRoot 'show\janvim-show.toml'
$contentLockPath = Join-Path $repositoryRoot 'content\p0.1\content-lock.json'
$manifestPath = Join-Path $repositoryRoot 'content\fixture\show.manifest.json'
$poemPath = Join-Path $repositoryRoot 'content\fixture\poem.txt'
$pluginLabPath = Join-Path $repositoryRoot 'runtime\user-root\plugin-lab\config\init.lua'
$runtimeRoot = Join-Path $repositoryRoot 'runtime\janvim'
$janvimExecutablePath = Join-Path $runtimeRoot 'janvim-core.exe'
foreach ($requiredFile in @(
    $electronCommand,
    $electronExecutable,
    $controllerPackageManifestPath,
    $compiledEntry,
    $moduleGraphVerifier,
    $typescriptParser,
    $typescriptPackageManifest,
    $verifyRuntime,
    $windowCloseHelper,
    $artifactLockPath,
    $showConfigPath,
    $contentLockPath,
    $manifestPath,
    $poemPath,
    $pluginLabPath,
    $janvimExecutablePath
)) {
    Assert-RequiredLeaf -Path $requiredFile -Reason "required-show-file-missing:$requiredFile"
    Assert-NoReparseTraversal -Path $requiredFile -Reason "required-show-file-reparse-rejected:$requiredFile"
}

Assert-NetworkPolicySnapshot -WorkingDirectory $repositoryRoot

$verifierClaimSpecifications = @(
    New-FrozenInputClaimSpecification `
        -Path $moduleGraphVerifier `
        -MaximumBytes 1048576L `
        -Reason 'graph-verifier-snapshot-failed'
    New-FrozenInputClaimSpecification `
        -Path $verifyRuntime `
        -MaximumBytes 1048576L `
        -Reason 'runtime-verifier-snapshot-failed'
    New-FrozenInputClaimSpecification `
        -Path $typescriptParser `
        -MaximumBytes $maximumTypeScriptParserBytes `
        -Reason 'typescript-parser-snapshot-failed'
    New-FrozenInputClaimSpecification `
        -Path $typescriptPackageManifest `
        -MaximumBytes $maximumTypeScriptPackageMetadataBytes `
        -Reason 'typescript-package-metadata-snapshot-failed'
)
$frozenInputClaims = Open-FrozenInputClaims -Specifications $verifierClaimSpecifications
$watchdogAttemptsStream = $null
$watchdogAttemptsWriter = $null
try {

$nodeCandidates = @(Get-Command -Name 'node' -CommandType Application -All -ErrorAction SilentlyContinue)
$normalizedNodeCommands = [Collections.Generic.List[string]]::new()
$seenNodeCommands = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($nodeCandidate in $nodeCandidates) {
    if ($nodeCandidate.Source -isnot [string] -or [string]::IsNullOrWhiteSpace($nodeCandidate.Source)) {
        throw 'node-command-invalid'
    }
    $normalizedNodeCommand = Resolve-ShowFullPath -Path $nodeCandidate.Source -Label 'node-command'
    Assert-RequiredLeaf -Path $normalizedNodeCommand -Reason 'node-command-missing'
    Assert-NoReparseTraversal -Path $normalizedNodeCommand -Reason 'node-command-reparse-rejected'
    $normalizedNodeCommand = [IO.Path]::GetFullPath(
        (Get-Item -LiteralPath $normalizedNodeCommand -Force -ErrorAction Stop).FullName
    )
    if ($seenNodeCommands.Add($normalizedNodeCommand)) {
        $normalizedNodeCommands.Add($normalizedNodeCommand)
    }
}
if ($normalizedNodeCommands.Count -lt 1) {
    throw 'node-command-missing'
}
if ($normalizedNodeCommands.Count -ne 1) {
    throw 'node-command-ambiguous'
}
$nodeCommand = $normalizedNodeCommands[0]
$nodeClaimSpecifications = @(
    New-FrozenInputClaimSpecification `
        -Path $nodeCommand `
        -MaximumBytes $maximumLaunchFileBytes `
        -Reason 'node-executable-snapshot-failed'
)
$nodeClaims = Open-FrozenInputClaims -Specifications $nodeClaimSpecifications
foreach ($nodeClaim in $nodeClaims) {
    $frozenInputClaims.Add($nodeClaim)
}
$nodeVersionResult = Invoke-BoundedProcess `
    -FilePath $nodeCommand `
    -Arguments @('--version') `
    -WorkingDirectory $repositoryRoot `
    -TimeoutMilliseconds 1000 `
    -MaximumOutputBytes 4096 `
    -Reason 'node-version-check-failed'
if (
    $nodeVersionResult.ExitCode -ne 0 -or
    -not [string]::IsNullOrWhiteSpace($nodeVersionResult.Stderr) -or
    $nodeVersionResult.Stdout.Trim() -cne $expectedNodeVersion
) {
    throw 'node-version-mismatch'
}

$moduleGraphResult = Invoke-BoundedProcess `
    -FilePath $nodeCommand `
    -Arguments @($moduleGraphVerifier) `
    -WorkingDirectory $repositoryRoot `
    -TimeoutMilliseconds 30000 `
    -MaximumOutputBytes $maximumGraphManifestBytes `
    -Reason 'electron-module-graph-verification-failed'
if (
    $moduleGraphResult.ExitCode -ne 0 -or
    -not [string]::IsNullOrWhiteSpace($moduleGraphResult.Stderr)
) {
    throw 'electron-module-graph-verification-failed'
}
$moduleGraphSpecifications = @(Read-StrictElectronModuleGraph `
    -Text $moduleGraphResult.Stdout `
    -RepositoryRoot $repositoryRoot `
    -CompiledEntry $compiledEntry)

$controllerPackageSnapshot = Read-BoundedJsonSnapshot `
    -Path $controllerPackageManifestPath `
    -MaximumBytes 65536 `
    -Reason 'controller-package-invalid'
$controllerPackageManifest = $controllerPackageSnapshot.Value
if (
    (Get-RequiredPropertyValue -InputObject $controllerPackageManifest -Name 'main' -Reason 'controller-package-invalid') -cne 'dist/main/electron-main.js' -or
    (Get-RequiredPropertyValue -InputObject $controllerPackageManifest -Name 'type' -Reason 'controller-package-invalid') -cne 'module'
) {
    throw 'controller-package-invalid'
}

$artifactLockSnapshot = Read-BoundedJsonSnapshot `
    -Path $artifactLockPath `
    -MaximumBytes 65536 `
    -Reason 'artifact-lock-invalid'
$artifactLock = $artifactLockSnapshot.Value
if (
    -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'schema' -Reason 'artifact-lock-invalid') -Expected 1) -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'sourceRepository' -Reason 'artifact-lock-invalid') -cne $expectedSourceRepository -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'tag' -Reason 'artifact-lock-invalid') -cne $expectedTag -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'commit' -Reason 'artifact-lock-invalid') -cne $expectedCommit -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'core' -Reason 'artifact-lock-invalid') -cne 'janvim-core.exe' -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'config' -Reason 'artifact-lock-invalid') -cne 'show/janvim-show.toml' -or
    (Get-RequiredPropertyValue -InputObject $artifactLock -Name 'pluginLabConfig' -Reason 'artifact-lock-invalid') -cne 'runtime/user-root/plugin-lab/config/init.lua'
) {
    throw 'artifact-lock-invalid'
}
$lockedConfigHash = Get-RequiredPropertyValue -InputObject $artifactLock -Name 'configSha256' -Reason 'artifact-lock-invalid'
$lockedPluginHash = Get-RequiredPropertyValue -InputObject $artifactLock -Name 'pluginLabConfigSha256' -Reason 'artifact-lock-invalid'
$lockedCoreHash = Get-RequiredPropertyValue -InputObject $artifactLock -Name 'coreSha256' -Reason 'artifact-lock-invalid'
$lockedCoreBytes = Get-RequiredPropertyValue -InputObject $artifactLock -Name 'coreBytes' -Reason 'artifact-lock-invalid'
$lockedLayoutEngine = Get-RequiredPropertyValue -InputObject $artifactLock -Name 'layoutEngine' -Reason 'artifact-lock-invalid'
$showConfigSnapshot = Read-BoundedFileSnapshot `
    -Path $showConfigPath `
    -MaximumBytes 65536 `
    -Reason 'show-config-size-invalid'
$pluginLabSnapshot = Read-BoundedFileSnapshot `
    -Path $pluginLabPath `
    -MaximumBytes 65536 `
    -Reason 'plugin-lab-config-size-invalid'
if (
    -not (Test-HashValue -Value $lockedConfigHash) -or
    -not (Test-HashValue -Value $lockedPluginHash) -or
    $lockedConfigHash -cne $expectedShowConfigSha256 -or
    $lockedPluginHash -cne $expectedPluginLabSha256 -or
    $showConfigSnapshot.FileSha256 -cne $lockedConfigHash -or
    $pluginLabSnapshot.FileSha256 -cne $lockedPluginHash
) {
    throw 'frozen-config-hash-mismatch'
}
if (
    -not (Test-HashValue -Value $lockedCoreHash) -or
    -not (Test-PositiveInteger -Value $lockedCoreBytes) -or
    [long]$lockedCoreBytes -gt $maximumRuntimeExecutableBytes -or
    (Get-ExactFileSha256 `
        -Path $janvimExecutablePath `
        -ExpectedBytes ([long]$lockedCoreBytes) `
        -Reason 'frozen-runtime-size-invalid') -cne $lockedCoreHash
) {
    throw 'frozen-runtime-hash-mismatch'
}

$manifestSnapshot = Read-BoundedJsonSnapshot `
    -Path $manifestPath `
    -MaximumBytes $maximumContentManifestBytes `
    -Reason 'show-manifest-invalid'
$selectedContentProfile = Read-SelectedContentProfile `
    -RepositoryRoot $repositoryRoot `
    -ContentLockPath $contentLockPath `
    -ActiveManifestSnapshot $manifestSnapshot
$manifest = $manifestSnapshot.Value
$manifestPoemHash = Get-RequiredPropertyValue -InputObject $manifest -Name 'poemSha256' -Reason 'show-manifest-invalid'
$contentRevision = Get-RequiredPropertyValue -InputObject $manifest -Name 'contentRevision' -Reason 'show-manifest-invalid'
$poemSnapshot = Read-BoundedFileSnapshot -Path $poemPath -MaximumBytes 65536 -Reason 'show-poem-size-invalid'
if (
    -not (Test-ExactJsonInteger -Value (Get-RequiredPropertyValue -InputObject $manifest -Name 'schema' -Reason 'show-manifest-invalid') -Expected 1) -or
    $manifestPoemHash -cne $expectedPoemSha256 -or
    $poemSnapshot.FileSha256 -cne $manifestPoemHash
) {
    throw 'frozen-poem-hash-mismatch'
}

$displayLayoutClaimSpecification = $null
if ($null -ne $displayLayoutSnapshot) {
    $displayLayoutClaimSpecification = [pscustomobject]@{
        Path = $displayLayoutPath
        ExpectedBytes = [long]$displayLayoutSnapshot.ByteLength
        MaximumBytes = 16384L
        ExpectedSha256 = $displayLayoutSnapshot.FileSha256
    }
}
$launchClaimSpecifications = @(
    New-FrozenInputClaimSpecification `
        -Path $electronExecutable `
        -MaximumBytes $maximumLaunchFileBytes `
        -Reason 'electron-executable-snapshot-failed'
    New-FrozenInputClaimSpecification `
        -Path $electronCommand `
        -MaximumBytes 1048576L `
        -Reason 'electron-command-snapshot-failed'
    New-FrozenInputClaimSpecification `
        -Path $windowCloseHelper `
        -MaximumBytes 1048576L `
        -Reason 'window-close-helper-snapshot-failed'
    [pscustomobject]@{
        Path = $controllerPackageManifestPath
        ExpectedBytes = [long]$controllerPackageSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $controllerPackageSnapshot.FileSha256
    }
    $moduleGraphSpecifications
    [pscustomobject]@{
        Path = $resolvedDisplayMapPath
        ExpectedBytes = [long]$displayMapSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $displayMapSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $artifactLockPath
        ExpectedBytes = [long]$artifactLockSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $artifactLockSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $showConfigPath
        ExpectedBytes = [long]$showConfigSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $showConfigSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $selectedContentProfile.LockPath
        ExpectedBytes = [long]$selectedContentProfile.LockSnapshot.ByteLength
        MaximumBytes = [long]$maximumContentLockBytes
        ExpectedSha256 = $selectedContentProfile.LockSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $selectedContentProfile.PaperPath
        ExpectedBytes = [long]$selectedContentProfile.PaperSnapshot.ByteLength
        MaximumBytes = [long]$maximumContentPaperBytes
        ExpectedSha256 = $selectedContentProfile.PaperSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $selectedContentProfile.ManifestSourcePath
        ExpectedBytes = [long]$selectedContentProfile.ManifestSourceSnapshot.ByteLength
        MaximumBytes = [long]$maximumContentManifestBytes
        ExpectedSha256 = $selectedContentProfile.ManifestSourceSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $pluginLabPath
        ExpectedBytes = [long]$pluginLabSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $pluginLabSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $manifestPath
        ExpectedBytes = [long]$manifestSnapshot.ByteLength
        MaximumBytes = [long]$maximumContentManifestBytes
        ExpectedSha256 = $manifestSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $poemPath
        ExpectedBytes = [long]$poemSnapshot.ByteLength
        MaximumBytes = 65536L
        ExpectedSha256 = $poemSnapshot.FileSha256
    },
    [pscustomobject]@{
        Path = $janvimExecutablePath
        ExpectedBytes = [long]$lockedCoreBytes
        MaximumBytes = $maximumRuntimeExecutableBytes
        ExpectedSha256 = $lockedCoreHash
    }
)
if ($null -ne $displayLayoutClaimSpecification) {
    $launchClaimSpecifications += $displayLayoutClaimSpecification
}
$launchClaims = Open-FrozenInputClaims -Specifications $launchClaimSpecifications
foreach ($launchClaim in $launchClaims) {
    $frozenInputClaims.Add($launchClaim)
}
$verificationArguments = @('-NoProfile', '-NonInteractive', '-File', $verifyRuntime)
Assert-NetworkPolicySnapshot -WorkingDirectory $repositoryRoot
$verificationResult = Invoke-BoundedProcess `
    -FilePath 'pwsh' `
    -Arguments $verificationArguments `
    -WorkingDirectory $repositoryRoot `
    -TimeoutMilliseconds 120000 `
    -MaximumOutputBytes 8192 `
    -Reason 'runtime-verification-failed'
if ($verificationResult.ExitCode -ne 0) {
    throw "runtime-verification-failed:$($verificationResult.ExitCode)"
}

$networkPolicyFlag = if ($NetworkPolicy -ceq 'OfflineRequired') {
    'offline-required'
}
else {
    'diagnostic-connected'
}
$showModeFlag = $Mode.ToLowerInvariant()
$evidenceMode = if ($Mode -ceq 'Show') { 'Show' } else { 'Soak3' }
$watchdogClock = [Diagnostics.Stopwatch]::StartNew()
$crashTimes = [Collections.Generic.List[long]]::new()
$watchdogAttemptCount = 0

while ($true) {
    $controllerRunId = "ctl-$([Guid]::NewGuid().ToString('N'))"
    $electronArguments = @(
        $controllerPackage
        "--show-mode=$showModeFlag"
        "--rehearsal-root=$resolvedRehearsalRoot"
        "--display-map=$resolvedDisplayMapPath"
        "--run-id=$RunId"
        "--controller-run-id=$controllerRunId"
        "--network-policy=$networkPolicyFlag"
    )
    $electronCommandLineArguments = @($electronArguments | ForEach-Object {
        if ($_ -match '["\r\n]') {
            throw 'electron-argument-invalid'
        }
        '"{0}"' -f $_
    })
    Assert-NetworkPolicySnapshot -WorkingDirectory $repositoryRoot
    $controller = Start-Process `
        -FilePath $electronExecutable `
        -WorkingDirectory $repositoryRoot `
        -ArgumentList $electronCommandLineArguments `
        -WindowStyle Hidden `
        -PassThru
    try {
        $controllerStartedAtMilliseconds = ([DateTimeOffset]$controller.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()
        while (-not $controller.WaitForExit(1000)) {
        }
        $controller.Refresh()
        $controllerExitCode = [int]$controller.ExitCode
        $controllerProcessId = [int]$controller.Id
    }
    finally {
        $controller.Dispose()
    }

    if ($controllerExitCode -eq 2) {
        $configurationRequiredDirty = $false
        foreach ($runtimeArtifact in @(
            $terminalMarkerPath,
            $evidencePath,
            $leasePath,
            $incidentPath,
            $watchdogAttemptsPath
        )) {
            if (Test-Path -LiteralPath $runtimeArtifact) {
                $configurationRequiredDirty = $true
                break
            }
        }
        if ($configurationRequiredDirty) {
            exit $incidentExitCode
        }
        Write-LauncherReceipt `
            -ControllerRunId $controllerRunId `
            -ControllerProcessId $controllerProcessId `
            -ControllerExitCode $controllerExitCode `
            -Termination 'configuration-required'
        exit 2
    }

    if ($Mode -ceq 'ValidateOnly') {
        Write-LauncherReceipt `
            -ControllerRunId $controllerRunId `
            -ControllerProcessId $controllerProcessId `
            -ControllerExitCode $controllerExitCode `
            -Termination 'validate-only'
        exit $controllerExitCode
    }

    if (Test-Path -LiteralPath $terminalMarkerPath -PathType Leaf) {
        if (Test-Path -LiteralPath $leasePath -PathType Leaf) {
            Write-ControllerIncident `
                -Path $incidentPath `
                -Reason 'controller-terminal-with-run-lease' `
                -ControllerRunId $controllerRunId `
                -ControllerProcessId $controllerProcessId `
                -ControllerExitCode $controllerExitCode
            exit $incidentExitCode
        }
        try {
            $null = Read-StrictTerminalMarker `
                -Path $terminalMarkerPath `
                -ControllerRunId $controllerRunId `
                -ControllerProcessId $controllerProcessId `
                -ControllerExitCode $controllerExitCode
        }
        catch {
            Write-ControllerIncident `
                -Path $incidentPath `
                -Reason 'controller-terminal-invalid' `
                -ControllerRunId $controllerRunId `
                -ControllerProcessId $controllerProcessId `
                -ControllerExitCode $controllerExitCode
            exit $incidentExitCode
        }
        try {
            $null = Read-StrictShowRunIdentityEvidence `
                -Path $evidencePath `
                -ControllerRunId $controllerRunId `
                -ExpectedMode $evidenceMode `
                -ExpectedDisplayMapSha256 $displayMapSnapshot.FileSha256 `
                -ExpectedDisplayMapSchema ([long]$displayMapSchema) `
                -ExpectedDisplayMap $displayMap `
                -ExpectedDisplayLayoutSha256 $expectedDisplayLayoutSha256 `
                -ExpectedArtifactTag $expectedTag `
                -ExpectedArtifactCommit $expectedCommit `
                -ExpectedArtifactLayoutEngine $lockedLayoutEngine `
                -ExpectedArtifactLockSha256 $artifactLockSnapshot.FileSha256 `
                -ExpectedCoreBytes ([long]$lockedCoreBytes) `
                -ExpectedCoreSha256 $lockedCoreHash `
                -ExpectedContentRevision $contentRevision `
                -ExpectedManifestBytes ([long]$manifestSnapshot.ByteLength) `
                -ExpectedManifestSha256 $manifestSnapshot.FileSha256 `
                -ExpectedPoemBytes ([long]$poemSnapshot.ByteLength) `
                -ExpectedPoemSha256 $poemSnapshot.FileSha256 `
                -ExpectedConfigSha256 $showConfigSnapshot.FileSha256
        }
        catch {
            Write-ControllerIncident `
                -Path $incidentPath `
                -Reason 'show-run-evidence-invalid' `
                -ControllerRunId $controllerRunId `
                -ControllerProcessId $controllerProcessId `
                -ControllerExitCode $controllerExitCode
            exit $incidentExitCode
        }
        Write-LauncherReceipt `
            -ControllerRunId $controllerRunId `
            -ControllerProcessId $controllerProcessId `
            -ControllerExitCode $controllerExitCode `
            -Termination 'intentional'
        exit $controllerExitCode
    }

    $leaseResolution = Resolve-UnexpectedLease `
        -LeasePath $leasePath `
        -ExpectedControllerRunId $controllerRunId `
        -ExpectedControllerProcessId $controllerProcessId `
        -ExpectedControllerStartedAtMilliseconds $controllerStartedAtMilliseconds `
        -ArtifactLock $artifactLock `
        -RuntimeRoot $runtimeRoot `
        -WindowCloseHelper $windowCloseHelper `
        -WorkingDirectory $repositoryRoot
    if ($leaseResolution -ceq 'operator-intervention') {
        Write-ControllerIncident `
            -Path $incidentPath `
            -Reason 'run-lease-unprovable' `
            -ControllerRunId $controllerRunId `
            -ControllerProcessId $controllerProcessId `
            -ControllerExitCode $controllerExitCode
        exit $incidentExitCode
    }

    $now = $watchdogClock.ElapsedMilliseconds
    for ($index = $crashTimes.Count - 1; $index -ge 0; $index--) {
        if ($now - $crashTimes[$index] -gt $crashWindowMilliseconds) {
            $crashTimes.RemoveAt($index)
        }
    }
    if (
        $watchdogAttemptCount -ge $restartDelaysMilliseconds.Count -or
        $crashTimes.Count -ge $restartDelaysMilliseconds.Count
    ) {
        Write-ControllerIncident `
            -Path $incidentPath `
            -Reason 'watchdog-crash-budget-exhausted' `
            -ControllerRunId $controllerRunId `
            -ControllerProcessId $controllerProcessId `
            -ControllerExitCode $controllerExitCode
        exit $incidentExitCode
    }
    $restartDelay = $restartDelaysMilliseconds[$watchdogAttemptCount]
    $watchdogAttempt = $watchdogAttemptCount + 1
    if ($null -eq $watchdogAttemptsStream) {
        $watchdogAttemptsStream = [IO.File]::Open(
            $watchdogAttemptsPath,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::Read
        )
        $watchdogAttemptsWriter = [IO.StreamWriter]::new(
            $watchdogAttemptsStream,
            [Text.UTF8Encoding]::new($false, $true),
            4096,
            $true
        )
    }
    Write-WatchdogAttempt `
        -Stream $watchdogAttemptsStream `
        -Writer $watchdogAttemptsWriter `
        -TopLevelRunId $RunId `
        -FailedControllerRunId $controllerRunId `
        -FailedControllerProcessId $controllerProcessId `
        -FailedControllerExitCode $controllerExitCode `
        -Attempt $watchdogAttempt `
        -DelayMilliseconds $restartDelay `
        -ObservedAtMonotonicMilliseconds $now
    $crashTimes.Add($now)
    $watchdogAttemptCount = $watchdogAttempt
    Start-Sleep -Milliseconds $restartDelay
}
}
finally {
    try {
        if ($null -ne $watchdogAttemptsWriter) {
            $watchdogAttemptsWriter.Dispose()
        }
    }
    finally {
        try {
            if ($null -ne $watchdogAttemptsStream) {
                $watchdogAttemptsStream.Dispose()
            }
        }
        finally {
            foreach ($frozenInputClaim in $frozenInputClaims) {
                $frozenInputClaim.Dispose()
            }
        }
    }
}
