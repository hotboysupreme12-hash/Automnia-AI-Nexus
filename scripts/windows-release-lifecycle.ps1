param(
  [string]$InstallerPath = $env:AUTOMNIA_WINDOWS_INSTALLER_PATH,
  [string]$PreviousInstallerPath = $(if ($env:AUTOMNIA_PREVIOUS_WINDOWS_INSTALLER_PATH) { $env:AUTOMNIA_PREVIOUS_WINDOWS_INSTALLER_PATH } else { $env:AUTOMNIA_PREVIOUS_WINDOWS_INSTALLER_PATH }),
  [string]$EvidenceDir = $env:AUTOMNIA_RELEASE_EVIDENCE_DIR,
  [string]$UpdateManifestPath = $env:AUTOMNIA_UPDATE_MANIFEST_PATH,
  [string]$UpdateSignaturePath = $env:AUTOMNIA_UPDATE_SIGNATURE_PATH,
  [string]$UpdatePublicKeyPath = $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$PlatformSigningRequired = -not ($env:AUTOMNIA_PLATFORM_SIGNING_REQUIRED -match '^(0|false|no)$')

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PackageMetadata = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
$ProductName = [string]$PackageMetadata.build.productName
if (-not $ProductName) { $ProductName = [string]$PackageMetadata.productName }
if (-not $ProductName) { $ProductName = [string]$PackageMetadata.name }
$ExpectedAppExeName = "$ProductName.exe"
if (-not $EvidenceDir) { $EvidenceDir = Join-Path $Root 'release\evidence' }
if (-not $UpdateManifestPath) { $UpdateManifestPath = Join-Path $Root 'release\updates\update-manifest.json' }
if (-not $UpdateSignaturePath) { $UpdateSignaturePath = Join-Path $Root 'release\updates\update-manifest.json.sig' }
if (-not $UpdatePublicKeyPath) { $UpdatePublicKeyPath = Join-Path $Root 'release\updates\update-manifest-public-key.pem' }
if (-not $InstallerPath) {
  $InstallerPath = Get-ChildItem (Join-Path $Root 'release') -File -Recurse |
    Where-Object { $_.Extension -eq '.exe' -and $_.Name -notmatch '^Uninstall' -and $_.FullName -notmatch 'win-unpacked' } |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $InstallerPath -or -not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
  throw 'A built Windows installer is required. Set AUTOMNIA_WINDOWS_INSTALLER_PATH or run npm run dist:win.'
}

$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$EvidenceDir = [IO.Path]::GetFullPath($EvidenceDir)
$LifecycleDir = Join-Path $EvidenceDir 'lifecycle'
New-Item -ItemType Directory -Force -Path $LifecycleDir | Out-Null
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ("automnia-release-lifecycle-{0}-{1}" -f $PID, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$InstallRoot = Join-Path $TempRoot 'installed'
$CorruptRoot = Join-Path $TempRoot 'corrupted-release'
$InstallerTimeoutSeconds = 900
if ($env:AUTOMNIA_WINDOWS_INSTALLER_TIMEOUT_SECONDS) {
  $ParsedInstallerTimeoutSeconds = 0
  if (-not [int]::TryParse($env:AUTOMNIA_WINDOWS_INSTALLER_TIMEOUT_SECONDS, [ref]$ParsedInstallerTimeoutSeconds) -or $ParsedInstallerTimeoutSeconds -lt 1) {
    throw 'AUTOMNIA_WINDOWS_INSTALLER_TIMEOUT_SECONDS must be a positive integer.'
  }
  $InstallerTimeoutSeconds = $ParsedInstallerTimeoutSeconds
}
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null

function Write-LifecycleLog {
  param([string]$Name, [string[]]$Lines)
  $Path = Join-Path $LifecycleDir $Name
  $Lines | Set-Content -LiteralPath $Path -Encoding UTF8
  return $Path
}

function Get-FreePort {
  $Listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $Listener.Start()
  try { return ([Net.IPEndPoint]$Listener.LocalEndpoint).Port }
  finally { $Listener.Stop() }
}

function Invoke-CheckedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$Label,
    [int]$TimeoutSeconds = 300
  )
  $StartParameters = @{
    FilePath = $FilePath
    PassThru = $true
    WindowStyle = 'Hidden'
  }
  if ($ArgumentList -and $ArgumentList.Count -gt 0) {
    $StartParameters.ArgumentList = $ArgumentList
  }
  $Process = Start-Process @StartParameters
  if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $Process.Kill($true) } catch {}
    throw "$Label timed out after $TimeoutSeconds seconds."
  }
  if ($Process.ExitCode -ne 0) { throw "$Label exited with code $($Process.ExitCode)." }
  return $Process.ExitCode
}

function Install-Automnia {
  param([string]$Path, [string]$Label)
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  Invoke-CheckedProcess -FilePath $Path -ArgumentList @('/S', "/D=$InstallRoot") -Label $Label -TimeoutSeconds $InstallerTimeoutSeconds | Out-Null
  $PayloadDeadline = [DateTime]::UtcNow.AddSeconds(120)
  $RequiredPayload = @(
    (Join-Path $InstallRoot $ExpectedAppExeName),
    (Join-Path $InstallRoot 'resources\app.asar'),
    (Join-Path $InstallRoot 'resources\dist\index.html'),
    (Join-Path $InstallRoot 'resources\dist-server\index.cjs')
  )
  while ([DateTime]::UtcNow -lt $PayloadDeadline -and ($RequiredPayload | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) })) {
    Start-Sleep -Milliseconds 250
  }
  $MissingPayload = $RequiredPayload | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
  if ($MissingPayload) { throw "$Label did not expose the complete packaged payload: $($MissingPayload -join ', ')" }
  $AppExe = Join-Path $InstallRoot $ExpectedAppExeName
  if (-not (Test-Path -LiteralPath $AppExe -PathType Leaf)) { throw "$Label did not install $ExpectedAppExeName at $AppExe." }
  return $AppExe
}

function Wait-ForE2eLog {
  param(
    [string]$Path,
    [string]$Label,
    [int]$TimeoutSeconds = 120
  )
  $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $Deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      try {
        $Log = Get-Content -LiteralPath $Path -Raw
        if ($Log -match 'quit-cleanup-complete') { return $Log }
      } catch {
        # The packaged child may still be appending its first log lines.
      }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "$Label did not record quit-cleanup-complete within $TimeoutSeconds seconds."
}

function Invoke-InstalledSmoke {
  param([string]$AppExe, [string]$Label)
  $LogPath = Join-Path $LifecycleDir ("{0}.e2e.log" -f $Label)
  Set-Content -LiteralPath $LogPath -Value '' -Encoding UTF8
  $Old = @{}
  foreach ($Name in @(
    'CONTROL_CENTER_PORT', 'CONTROL_CENTER_FRONTEND_PORT', 'OPENCLAW_GATEWAY_PORT', 'OPENCLAW_BROWSER_RELAY_PORT',
    'CONTROL_CENTER_AUTOSTART_GATEWAY', 'AUTOMNIA_ELECTRON_E2E', 'AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS',
    'AUTOMNIA_ELECTRON_E2E_ASSERT_NAVIGATION', 'AUTOMNIA_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL',
    'AUTOMNIA_ELECTRON_E2E_SKIP_PORT_CLEANUP', 'AUTOMNIA_ELECTRON_E2E_LOG_PATH', 'AUTOMNIA_USER_DATA_DIR',
    'OPENCLAW_STATE_DIR', 'OPENCLAW_HOME', 'CONTROL_CENTER_WORKSPACE_ROOT'
  )) { $Old[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process') }
  try {
    $env:CONTROL_CENTER_PORT = [string](Get-FreePort)
    $env:CONTROL_CENTER_FRONTEND_PORT = [string](Get-FreePort)
    $env:OPENCLAW_GATEWAY_PORT = [string](Get-FreePort)
    $env:OPENCLAW_BROWSER_RELAY_PORT = [string](Get-FreePort)
    $env:CONTROL_CENTER_AUTOSTART_GATEWAY = '0'
    $env:AUTOMNIA_ELECTRON_E2E = '1'
    $env:AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS = '3500'
    $env:AUTOMNIA_ELECTRON_E2E_ASSERT_NAVIGATION = '1'
    $env:AUTOMNIA_ELECTRON_E2E_DISABLE_OPEN_EXTERNAL = '1'
    $env:AUTOMNIA_ELECTRON_E2E_SKIP_PORT_CLEANUP = '1'
    $env:AUTOMNIA_ELECTRON_E2E_LOG_PATH = $LogPath
    $env:AUTOMNIA_USER_DATA_DIR = Join-Path $TempRoot ("user-data-$Label")
    $env:OPENCLAW_STATE_DIR = Join-Path $TempRoot ("openclaw-$Label")
    $env:OPENCLAW_HOME = $env:OPENCLAW_STATE_DIR
    $env:CONTROL_CENTER_WORKSPACE_ROOT = Join-Path $TempRoot ("workspace-$Label")
    Invoke-CheckedProcess -FilePath $AppExe -ArgumentList @() -Label "$Label packaged launch" -TimeoutSeconds 120 | Out-Null
    $Log = Wait-ForE2eLog -Path $LogPath -Label "$Label packaged launch" -TimeoutSeconds 120
    foreach ($Marker in @('server-ready', 'navigation-policy-ok', 'quit-cleanup-complete')) {
      if ($Log -notmatch [Regex]::Escape($Marker)) { throw "$Label packaged launch did not record $Marker." }
    }
    return $LogPath
  } finally {
    foreach ($Name in $Old.Keys) {
      [Environment]::SetEnvironmentVariable($Name, $Old[$Name], 'Process')
    }
  }
}

function Verify-UpdateChannel {
  $OldRoot = $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT
  $OldManifest = $env:AUTOMNIA_UPDATE_MANIFEST_PATH
  $OldSignature = $env:AUTOMNIA_UPDATE_SIGNATURE_PATH
  $OldPublic = $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH
  $OldRequire = $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING
  try {
    $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT = Join-Path $Root 'release'
    $env:AUTOMNIA_UPDATE_MANIFEST_PATH = $UpdateManifestPath
    $env:AUTOMNIA_UPDATE_SIGNATURE_PATH = $UpdateSignaturePath
    $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH = $UpdatePublicKeyPath
    $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING = '1'
    & node (Join-Path $Root 'scripts\verify-update-manifest.cjs') *>&1 | Tee-Object -FilePath (Join-Path $LifecycleDir 'update-verify.log')
    if ($LASTEXITCODE -ne 0) { throw 'Signed update manifest verification failed.' }
  } finally {
    $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT = $OldRoot
    $env:AUTOMNIA_UPDATE_MANIFEST_PATH = $OldManifest
    $env:AUTOMNIA_UPDATE_SIGNATURE_PATH = $OldSignature
    $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH = $OldPublic
    $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING = $OldRequire
  }
}

function Test-CorruptedUpdateRejection {
  $Manifest = Get-Content -LiteralPath $UpdateManifestPath -Raw | ConvertFrom-Json
  $WindowsArtifact = $Manifest.artifacts | Where-Object { $_.platform -eq 'windows' } | Select-Object -First 1
  if (-not $WindowsArtifact) { throw 'Update manifest does not contain a Windows artifact.' }
  New-Item -ItemType Directory -Force -Path (Join-Path $CorruptRoot 'updates') | Out-Null
  Copy-Item -LiteralPath $UpdateManifestPath -Destination (Join-Path $CorruptRoot 'updates\update-manifest.json')
  Copy-Item -LiteralPath $UpdateSignaturePath -Destination (Join-Path $CorruptRoot 'updates\update-manifest.json.sig')
  Copy-Item -LiteralPath $UpdatePublicKeyPath -Destination (Join-Path $CorruptRoot 'updates\update-manifest-public-key.pem')
  $Target = Join-Path $CorruptRoot ([string]$WindowsArtifact.file)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  Copy-Item -LiteralPath (Join-Path (Join-Path $Root 'release') ([string]$WindowsArtifact.file)) -Destination $Target
  $Stream = [IO.File]::Open($Target, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
  try {
    if ($Stream.Length -lt 1) { throw 'Cannot corrupt an empty update artifact.' }
    $Stream.Seek(-1, [IO.SeekOrigin]::End) | Out-Null
    $Original = $Stream.ReadByte()
    $Stream.Seek(-1, [IO.SeekOrigin]::End) | Out-Null
    $Stream.WriteByte(($Original -bxor 0xFF))
  } finally { $Stream.Dispose() }

  $OldRoot = $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT
  $OldManifest = $env:AUTOMNIA_UPDATE_MANIFEST_PATH
  $OldSignature = $env:AUTOMNIA_UPDATE_SIGNATURE_PATH
  $OldPublic = $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH
  $OldRequire = $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING
  try {
    $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT = $CorruptRoot
    $env:AUTOMNIA_UPDATE_MANIFEST_PATH = Join-Path $CorruptRoot 'updates\update-manifest.json'
    $env:AUTOMNIA_UPDATE_SIGNATURE_PATH = Join-Path $CorruptRoot 'updates\update-manifest.json.sig'
    $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH = Join-Path $CorruptRoot 'updates\update-manifest-public-key.pem'
    $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING = '1'
    $OldErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $Output = @(& node (Join-Path $Root 'scripts\verify-update-manifest.cjs') *>&1)
      $ExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $OldErrorActionPreference
    }
    $Output | Set-Content -LiteralPath (Join-Path $LifecycleDir 'corrupted-update.log') -Encoding UTF8
    if ($ExitCode -eq 0) { throw 'Corrupted update artifact was incorrectly accepted.' }
    if (($Output -join "`n") -notmatch 'size mismatch|checksum mismatch') { throw 'Corrupted update rejection did not report an integrity failure.' }
  } finally {
    $env:AUTOMNIA_RELEASE_ARTIFACT_ROOT = $OldRoot
    $env:AUTOMNIA_UPDATE_MANIFEST_PATH = $OldManifest
    $env:AUTOMNIA_UPDATE_SIGNATURE_PATH = $OldSignature
    $env:AUTOMNIA_UPDATE_PUBLIC_KEY_PATH = $OldPublic
    $env:AUTOMNIA_UPDATE_REQUIRE_SIGNING = $OldRequire
  }
}

try {
  if ($PlatformSigningRequired) {
    $Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
    if ($Signature.Status -ne 'Valid') { throw "Installer Authenticode status is $($Signature.Status): $($Signature.StatusMessage)" }
    $Signer = $Signature.SignerCertificate.Subject
    $Thumbprint = $Signature.SignerCertificate.Thumbprint
    $Signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($Signtool) {
      & $Signtool.Source verify /pa /tw $InstallerPath *>&1 | Tee-Object -FilePath (Join-Path $LifecycleDir 'authenticode-verify.log')
      if ($LASTEXITCODE -ne 0) { throw 'signtool timestamp verification failed.' }
    } else {
      Write-LifecycleLog -Name 'authenticode-verify.log' -Lines @('signtool.exe unavailable; Get-AuthenticodeSignature returned Valid.') | Out-Null
    }
  } else {
    Write-LifecycleLog -Name 'authenticode-verify.log' -Lines @(
      'Platform signing verification skipped because AUTOMNIA_PLATFORM_SIGNING_REQUIRED=0.',
      'The installer is intentionally unsigned for early distribution; update-channel signature verification remains required.'
    ) | Out-Null
  }

  Verify-UpdateChannel

  if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
  $FreshExe = Install-Automnia -Path $InstallerPath -Label 'fresh install'
  $FreshLog = Invoke-InstalledSmoke -AppExe $FreshExe -Label 'fresh-install'
  Write-LifecycleLog -Name 'fresh-install.log' -Lines @("Installer: $InstallerPath", "Install root: $InstallRoot", "Application: $FreshExe", "E2E log: $FreshLog", 'Status: passed') | Out-Null

  if ($PreviousInstallerPath -and (Test-Path -LiteralPath $PreviousInstallerPath -PathType Leaf)) {
    if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    Install-Automnia -Path (Resolve-Path -LiteralPath $PreviousInstallerPath).Path -Label 'previous-version install' | Out-Null
    $UpgradeMode = 'previous-version'
  } else {
    $ExistingUninstaller = Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse | Select-Object -First 1 -ExpandProperty FullName
    if (-not $ExistingUninstaller) { throw 'same-version reinstall could not find the existing NSIS uninstaller.' }
    Invoke-CheckedProcess -FilePath $ExistingUninstaller -ArgumentList @('/S') -Label 'same-version uninstall before clean reinstall' -TimeoutSeconds 180 | Out-Null
    $UninstallDeadline = [DateTime]::UtcNow.AddSeconds(30)
    while ((Test-Path -LiteralPath $InstallRoot) -and [DateTime]::UtcNow -lt $UninstallDeadline) { Start-Sleep -Milliseconds 250 }
    if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    $UpgradeMode = 'clean-reinstall'
  }
  $UpgradeExe = Install-Automnia -Path $InstallerPath -Label 'upgrade install'
  $UpgradeLog = Invoke-InstalledSmoke -AppExe $UpgradeExe -Label 'upgrade'
  Write-LifecycleLog -Name 'upgrade.log' -Lines @("Mode: $UpgradeMode", "Application: $UpgradeExe", "E2E log: $UpgradeLog", 'Status: passed') | Out-Null

  Test-CorruptedUpdateRejection
  $RollbackLog = Invoke-InstalledSmoke -AppExe $UpgradeExe -Label 'rollback-existing-version'
  Add-Content -LiteralPath (Join-Path $LifecycleDir 'corrupted-update.log') -Value "Existing installed version remained launchable: $RollbackLog"

  $Uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse | Select-Object -First 1 -ExpandProperty FullName
  if (-not $Uninstaller) { throw 'NSIS uninstaller was not found after installation.' }
  Invoke-CheckedProcess -FilePath $Uninstaller -ArgumentList @('/S') -Label 'silent uninstall' -TimeoutSeconds 180 | Out-Null
  $Deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $UpgradeExe) -and [DateTime]::UtcNow -lt $Deadline) { Start-Sleep -Milliseconds 250 }
  if (Test-Path -LiteralPath $UpgradeExe) { throw "$ExpectedAppExeName remained after silent uninstall." }
  Write-LifecycleLog -Name 'uninstall.log' -Lines @("Uninstaller: $Uninstaller", "$ExpectedAppExeName removed: true", 'Status: passed') | Out-Null

  if ($PlatformSigningRequired) {
    $GeneratedAt = [DateTime]::UtcNow.ToString('o')
    $ArtifactRelative = $InstallerPath.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
    $Evidence = [ordered]@{
      schema = 1
      generatedAt = $GeneratedAt
      artifacts = @(
        [ordered]@{
          platform = 'windows'
          artifact = $ArtifactRelative
          signing = [ordered]@{
            type = 'authenticode'
            status = 'verified'
            signer = $Signer
            thumbprint = $Thumbprint
            timestamp = $GeneratedAt
            verificationCommand = "Get-AuthenticodeSignature; signtool verify /pa /tw `"$ArtifactRelative`""
          }
        }
      )
      updateChannel = [ordered]@{
        signed = $true
        rollbackTested = $true
        verificationCommand = 'node scripts/verify-update-manifest.cjs; reject corrupted artifact; relaunch installed prior version'
      }
      installTests = [ordered]@{
        freshInstall = [ordered]@{ status = 'passed'; evidence = 'release/evidence/lifecycle/fresh-install.log' }
        upgrade = [ordered]@{ status = 'passed'; evidence = 'release/evidence/lifecycle/upgrade.log' }
        uninstall = [ordered]@{ status = 'passed'; evidence = 'release/evidence/lifecycle/uninstall.log' }
        corruptedUpdate = [ordered]@{ status = 'passed'; evidence = 'release/evidence/lifecycle/corrupted-update.log' }
      }
    }
    $EvidencePath = Join-Path $EvidenceDir 'distribution-signing.json'
    $Evidence | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    Write-Host "[release-lifecycle] wrote $EvidencePath"
  } else {
    Write-Host '[release-lifecycle] platform signing disabled; install and update-integrity evidence retained without distribution-signing.json'
  }
} finally {
  if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
