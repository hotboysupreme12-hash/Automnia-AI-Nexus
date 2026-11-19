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
$MachineInstallRegistryRoots = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
)
$ExistingMachineInstall = $null
foreach ($RegistryRoot in $MachineInstallRegistryRoots) {
  if (-not (Test-Path -LiteralPath $RegistryRoot)) { continue }
  foreach ($RegistryKey in Get-ChildItem -LiteralPath $RegistryRoot -ErrorAction SilentlyContinue) {
    $InstalledApplication = Get-ItemProperty -LiteralPath $RegistryKey.PSPath -ErrorAction SilentlyContinue
    $DisplayNameProperty = $InstalledApplication.PSObject.Properties['DisplayName']
    if ($DisplayNameProperty -and [string]$DisplayNameProperty.Value -like "$ProductName*") {
      $ExistingMachineInstall = $InstalledApplication
      break
    }
  }
  if ($ExistingMachineInstall) { break }
}
if ($ExistingMachineInstall) {
  $ExistingLocation = [string]$ExistingMachineInstall.InstallLocation
  if (-not $ExistingLocation) { $ExistingLocation = 'the registered machine install path' }
  throw "$ProductName is already installed machine-wide at $ExistingLocation. This lifecycle requires a clean Windows runner because a silent upgrade would invoke UAC and could change the existing app."
}
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
$TempBase = if ($env:RUNNER_TEMP -and (Test-Path -LiteralPath $env:RUNNER_TEMP -PathType Container)) {
  $env:RUNNER_TEMP
} else {
  [IO.Path]::GetTempPath()
}
$TempRoot = Join-Path $TempBase ("automnia-release-lifecycle-{0}-{1}" -f $PID, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
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
$UpgradeInstallerTimeoutSeconds = 1800
if ($env:AUTOMNIA_WINDOWS_UPGRADE_TIMEOUT_SECONDS) {
  $ParsedUpgradeInstallerTimeoutSeconds = 0
  if (-not [int]::TryParse($env:AUTOMNIA_WINDOWS_UPGRADE_TIMEOUT_SECONDS, [ref]$ParsedUpgradeInstallerTimeoutSeconds) -or $ParsedUpgradeInstallerTimeoutSeconds -lt 1) {
    throw 'AUTOMNIA_WINDOWS_UPGRADE_TIMEOUT_SECONDS must be a positive integer.'
  }
  $UpgradeInstallerTimeoutSeconds = $ParsedUpgradeInstallerTimeoutSeconds
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

if (-not ('AutomniaWindowTextDiagnostics' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AutomniaWindowTextDiagnostics {
  private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxCount);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetClassName(IntPtr handle, StringBuilder className, int maxCount);

  public static string[] GetWindowDetails(int targetProcessId) {
    var details = new List<string>();
    EnumWindows((window, _) => {
      GetWindowThreadProcessId(window, out uint ownerProcessId);
      if (ownerProcessId != (uint)targetProcessId) return true;
      AddWindowDetails(details, window, "window");
      EnumChildWindows(window, (child, __) => {
        AddWindowDetails(details, child, "control");
        return true;
      }, IntPtr.Zero);
      return true;
    }, IntPtr.Zero);
    return details.ToArray();
  }

  private static void AddWindowDetails(List<string> details, IntPtr handle, string kind) {
    var text = new StringBuilder(1024);
    var className = new StringBuilder(256);
    GetWindowText(handle, text, text.Capacity);
    GetClassName(handle, className, className.Capacity);
    var value = string.Join(" ", text.ToString().Split((char[])null, StringSplitOptions.RemoveEmptyEntries));
    if (value.Length == 0) return;
    if (value.Length > 300) value = value.Substring(0, 300);
    details.Add(kind + " class=\"" + className.ToString() + "\" text=\"" + value + "\"");
  }
}
'@ -ErrorAction Stop
}

function Get-ProcessTreeSnapshot {
  param([int]$RootProcessId)
  $Processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  $ProcessById = @{}
  foreach ($Candidate in $Processes) { $ProcessById[[int]$Candidate.ProcessId] = $Candidate }
  $Pending = [System.Collections.Generic.Queue[int]]::new()
  $Seen = @{}
  $Snapshot = [System.Collections.Generic.List[object]]::new()
  $Pending.Enqueue($RootProcessId)
  while ($Pending.Count -gt 0) {
    $CurrentId = $Pending.Dequeue()
    if ($Seen.ContainsKey([string]$CurrentId)) { continue }
    $Seen[[string]$CurrentId] = $true
    if ($ProcessById.ContainsKey($CurrentId)) {
      $Current = $ProcessById[$CurrentId]
      $Snapshot.Add($Current)
      foreach ($Child in $Processes | Where-Object { [int]$_.ParentProcessId -eq $CurrentId }) {
        $Pending.Enqueue([int]$Child.ProcessId)
      }
    }
  }
  return @($Snapshot)
}

function Write-ProcessTreeSnapshot {
  param([int]$RootProcessId, [string]$Label)
  $TraceName = ($Label -replace '[^A-Za-z0-9._-]', '-') + '-process-tree.log'
  $TracePath = Join-Path $LifecycleDir $TraceName
  $Lines = [System.Collections.Generic.List[string]]::new()
  try {
    $Snapshot = @(Get-ProcessTreeSnapshot -RootProcessId $RootProcessId)
    if (-not $Snapshot) { $Lines.Add("[release-lifecycle] process tree for PID $RootProcessId is no longer present.") }
    foreach ($Item in $Snapshot) {
      $CpuSeconds = 'unavailable'
      $WindowTitle = ''
      try {
        $ProcessInfo = Get-Process -Id ([int]$Item.ProcessId) -ErrorAction Stop
        if ($null -ne $ProcessInfo.CPU) { $CpuSeconds = [Math]::Round([double]$ProcessInfo.CPU, 1) }
        $WindowTitle = [string]$ProcessInfo.MainWindowTitle
      } catch {}
      $Lines.Add(('[release-lifecycle] pid={0} parent={1} name="{2}" cpuSeconds={3} windowTitle="{4}" executable="{5}" commandLine="{6}"' -f `
        $Item.ProcessId, $Item.ParentProcessId, $Item.Name, $CpuSeconds, $WindowTitle, $Item.ExecutablePath, $Item.CommandLine))
      try {
        foreach ($WindowDetail in [AutomniaWindowTextDiagnostics]::GetWindowDetails([int]$Item.ProcessId)) {
          $Lines.Add("[release-lifecycle] pid=$($Item.ProcessId) $WindowDetail")
        }
      } catch {
        $Lines.Add("[release-lifecycle] window text capture failed for PID $($Item.ProcessId): $($_.Exception.Message)")
      }
    }
  } catch {
    $Lines.Add("[release-lifecycle] process-tree snapshot failed: $($_.Exception.Message)")
  }
  $Lines | Add-Content -LiteralPath $TracePath -Encoding UTF8
  $Lines | ForEach-Object { Write-Host $_ }
}

function Invoke-CheckedProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$Label,
    [int]$TimeoutSeconds = 300,
    [switch]$TraceProcessTree
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
  $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $NextProcessTrace = [DateTime]::UtcNow.AddMinutes(1)
  while (-not $Process.HasExited) {
    $RemainingMilliseconds = [int][Math]::Min(60000, [Math]::Max(0, ($Deadline - [DateTime]::UtcNow).TotalMilliseconds))
    if ($RemainingMilliseconds -le 0 -or $Process.WaitForExit($RemainingMilliseconds)) { break }
    if ($TraceProcessTree -and [DateTime]::UtcNow -ge $NextProcessTrace) {
      Write-Host "[release-lifecycle] $Label is still running after $([int]($TimeoutSeconds - ($Deadline - [DateTime]::UtcNow).TotalSeconds)) seconds."
      Write-ProcessTreeSnapshot -RootProcessId $Process.Id -Label $Label
      $NextProcessTrace = [DateTime]::UtcNow.AddMinutes(1)
    }
  }
  if (-not $Process.HasExited) {
    if ($TraceProcessTree) { Write-ProcessTreeSnapshot -RootProcessId $Process.Id -Label $Label }
    $ProcessDescription = try { "$($Process.ProcessName) (PID $($Process.Id))" } catch { "PID $($Process.Id)" }
    $TerminationFailure = $null
    try { $Process.Kill($true) } catch { $TerminationFailure = $_.Exception.Message }
    try { $null = $Process.WaitForExit(30000) } catch { if (-not $TerminationFailure) { $TerminationFailure = $_.Exception.Message } }
    if (-not $Process.HasExited -and -not $TerminationFailure) {
      $TerminationFailure = 'the process tree remained alive after the termination attempt'
    }
    $TerminationDetail = if ($TerminationFailure) { " Termination detail: $TerminationFailure." } else { '' }
    throw "$Label timed out after $TimeoutSeconds seconds. Timed-out process: $ProcessDescription.$TerminationDetail"
  }
  if ($Process.ExitCode -ne 0) { throw "$Label exited with code $($Process.ExitCode)." }
  return $Process.ExitCode
}

function Install-Automnia {
  param([string]$Path, [string]$Label, [int]$TimeoutSeconds)
  New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
  $TraceUpgrade = $Label -eq 'upgrade install'
  # Keep all lifecycle installs at the same per-user scope, even on an elevated runner.
  # Otherwise the previous installer can register per-machine while the candidate
  # resolves a per-user install, and its in-place upgrade waits on the wrong uninstall path.
  Invoke-CheckedProcess -FilePath $Path -ArgumentList @('/currentuser', '/S', "/D=$InstallRoot") -Label $Label -TimeoutSeconds $TimeoutSeconds -TraceProcessTree:$TraceUpgrade | Out-Null
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

function Get-InstalledAutomniaProcesses {
  $InstallLocation = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([char[]]@('\', '/'))
  $InstallPrefix = $InstallLocation + '\'
  $Processes = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  $OwnedProcessIds = [Collections.Generic.HashSet[int]]::new()

  foreach ($Candidate in $Processes) {
    $ExecutablePath = [string]$Candidate.ExecutablePath
    $CommandLine = [string]$Candidate.CommandLine
    if (
      ($ExecutablePath -and $ExecutablePath.StartsWith($InstallPrefix, [StringComparison]::OrdinalIgnoreCase)) -or
      ($CommandLine -and $CommandLine.IndexOf($InstallLocation, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    ) {
      [void]$OwnedProcessIds.Add([int]$Candidate.ProcessId)
    }
  }

  # Native helpers can execute from system paths while their parent process still
  # belongs to this unique temporary install. Include those descendants for cleanup.
  do {
    $AddedChild = $false
    foreach ($Candidate in $Processes) {
      $CandidateProcessId = [int]$Candidate.ProcessId
      if (-not $OwnedProcessIds.Contains($CandidateProcessId) -and $OwnedProcessIds.Contains([int]$Candidate.ParentProcessId)) {
        [void]$OwnedProcessIds.Add($CandidateProcessId)
        $AddedChild = $true
      }
    }
  } while ($AddedChild)

  return @($Processes | Where-Object { $OwnedProcessIds.Contains([int]$_.ProcessId) })
}

function Stop-InstalledAutomniaProcesses {
  param([string]$Label)
  $OwnedProcesses = @(Get-InstalledAutomniaProcesses)
  if (-not $OwnedProcesses) {
    Write-Host "[release-lifecycle] $Label found no test-install-owned processes under $InstallRoot."
    return
  }
  foreach ($OwnedProcess in $OwnedProcesses) {
    Write-Host "[release-lifecycle] stopping $($OwnedProcess.Name) PID $($OwnedProcess.ProcessId) for $Label."
    if (Get-Process -Id ([int]$OwnedProcess.ProcessId) -ErrorAction SilentlyContinue) {
      Stop-Process -Id ([int]$OwnedProcess.ProcessId) -Force -ErrorAction SilentlyContinue
    }
  }
  $StopDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $RemainingProcesses = @(Get-InstalledAutomniaProcesses)
    if (-not $RemainingProcesses) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $StopDeadline)
  $RemainingNames = @($RemainingProcesses | ForEach-Object { "$($_.Name) (PID $($_.ProcessId))" }) -join ', '
  throw "$Label could not stop installer-owned Automnia processes: $RemainingNames"
}

function Remove-DirectoryWithRetry {
  param(
    [string]$Path,
    [string]$Label,
    [int]$TimeoutSeconds = 30
  )
  $Target = [IO.Path]::GetFullPath($Path)
  $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $LastError = $null
  do {
    if (-not (Test-Path -LiteralPath $Target)) { return }
    try {
      Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
    } catch {
      $LastError = $_.Exception.Message
    }
    if (-not (Test-Path -LiteralPath $Target)) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $Deadline)

  if (Test-Path -LiteralPath $Target) {
    $Remaining = @(Get-ChildItem -LiteralPath $Target -Force -ErrorAction SilentlyContinue | Select-Object -First 8 -ExpandProperty Name) -join ', '
    $Detail = if ($LastError) { " Last error: $LastError" } else { '' }
    throw "$Label could not remove its isolated directory: $Target. Remaining entries: $Remaining.$Detail"
  }
}

function Uninstall-Automnia {
  param([string]$Label)
  Stop-InstalledAutomniaProcesses -Label $Label
  $AppExe = Join-Path $InstallRoot $ExpectedAppExeName
  $Uninstaller = Get-ChildItem -LiteralPath $InstallRoot -Filter 'Uninstall*.exe' -File -Recurse |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $Uninstaller) { throw "$Label could not find the NSIS uninstaller under $InstallRoot." }
  Invoke-CheckedProcess -FilePath $Uninstaller -ArgumentList @('/S') -Label $Label -TimeoutSeconds 180 | Out-Null
  $UninstallDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while ((Test-Path -LiteralPath $AppExe) -and [DateTime]::UtcNow -lt $UninstallDeadline) {
    Start-Sleep -Milliseconds 250
  }
  if (Test-Path -LiteralPath $AppExe) { throw "$Label left $ExpectedAppExeName in place." }
  Remove-DirectoryWithRetry -Path $InstallRoot -Label $Label
  return $Uninstaller
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
    'CONTROL_CENTER_AUTOSTART_GATEWAY', 'AUTOMNIA_ELECTRON_E2E', 'AUTOMNIA_ELECTRON_E2E_ASSERT_PTY', 'AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN', 'AUTOMNIA_ELECTRON_E2E_AUTO_QUIT_MS',
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
    $env:AUTOMNIA_ELECTRON_E2E_ASSERT_PTY = '1'
    $env:AUTOMNIA_ELECTRON_E2E_KEEP_WINDOW_HIDDEN = '1'
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
    foreach ($Marker in @('server-ready', 'navigation-policy-ok', 'pty-native-ok', 'quit-cleanup-complete')) {
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
  $FreshExe = Install-Automnia -Path $InstallerPath -Label 'fresh install' -TimeoutSeconds $InstallerTimeoutSeconds
  $FreshLog = Invoke-InstalledSmoke -AppExe $FreshExe -Label 'fresh-install'
  Write-LifecycleLog -Name 'fresh-install.log' -Lines @("Installer: $InstallerPath", "Install root: $InstallRoot", "Application: $FreshExe", "E2E log: $FreshLog", 'Status: passed') | Out-Null

  if ($PreviousInstallerPath -and (Test-Path -LiteralPath $PreviousInstallerPath -PathType Leaf)) {
    Uninstall-Automnia -Label 'fresh-version uninstall before previous-version install' | Out-Null
    Install-Automnia -Path (Resolve-Path -LiteralPath $PreviousInstallerPath).Path -Label 'previous-version install' -TimeoutSeconds $InstallerTimeoutSeconds | Out-Null
    # NSIS checks for app processes before replacing an existing install.
    # Close only processes rooted in this isolated install directory first.
    Write-Host '[release-lifecycle] stopping any previous-version app process before the in-place upgrade.'
    Stop-InstalledAutomniaProcesses -Label 'previous-version pre-upgrade cleanup'
    $UpgradeMode = 'previous-version'
  } else {
    Uninstall-Automnia -Label 'same-version uninstall before clean reinstall' | Out-Null
    $UpgradeMode = 'clean-reinstall'
  }
  $UpgradeExe = Install-Automnia -Path $InstallerPath -Label 'upgrade install' -TimeoutSeconds $UpgradeInstallerTimeoutSeconds
  $UpgradeLog = Invoke-InstalledSmoke -AppExe $UpgradeExe -Label 'upgrade'
  Write-LifecycleLog -Name 'upgrade.log' -Lines @("Mode: $UpgradeMode", "Application: $UpgradeExe", "E2E log: $UpgradeLog", 'Status: passed') | Out-Null

  Test-CorruptedUpdateRejection
  $RollbackLog = Invoke-InstalledSmoke -AppExe $UpgradeExe -Label 'rollback-existing-version'
  Add-Content -LiteralPath (Join-Path $LifecycleDir 'corrupted-update.log') -Value "Existing installed version remained launchable: $RollbackLog"

  $Uninstaller = Uninstall-Automnia -Label 'silent uninstall'
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
  try {
    Stop-InstalledAutomniaProcesses -Label 'final lifecycle cleanup'
  } catch {
    Write-Warning "[release-lifecycle] installer-owned process cleanup incomplete: $($_.Exception.Message)"
  }
  try {
    Remove-DirectoryWithRetry -Path $TempRoot -Label 'final temporary cleanup'
  } catch {
    if (Test-Path -LiteralPath $TempRoot) {
      Write-Warning "[release-lifecycle] temporary cleanup incomplete: $($_.Exception.Message)"
    }
  }
}
