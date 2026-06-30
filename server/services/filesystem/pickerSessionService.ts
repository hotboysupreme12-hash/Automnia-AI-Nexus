import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { promises as defaultFs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AVATAR_IMAGE_TYPE_ERROR, isSupportedAvatarImagePath } from './avatarFileService'
import { isPathUnder } from './safePathService'

export type PickerSessionStatus = 'pending' | 'selected' | 'cancelled' | 'error'

export type PickerDialogResult = {
  ok: boolean
  path?: string
  cancelled?: boolean
  detail?: string
}

export type FolderPickerSession = {
  id: string
  status: PickerSessionStatus
  path?: string | null
  detail?: string
  startedAt: number
  updatedAt: number
  expiresAt: number
}

export type ImagePickerSession = FolderPickerSession & {
  agentId?: string
  sourcePath?: string | null
  avatar?: string | null
  previewUrl?: string | null
}

export type PersistedAgentAvatar = {
  agentId: string
  sourcePath?: string
  avatar: string
  avatarPath: string
  previewUrl: string
}

type PickerFileSystem = Pick<typeof defaultFs, 'mkdir' | 'readFile' | 'stat' | 'unlink' | 'writeFile'>
type SpawnProcess = (command: string, args: string[], options?: SpawnOptions) => ChildProcess

export type PickerSessionServiceOptions = {
  stateRoot: string
  workspaceRoot: string
  timeoutMs?: number
  sessionTtlMs?: number
  platform?: NodeJS.Platform
  fs?: PickerFileSystem
  now?: () => number
  randomId?: () => string
  spawnProcess?: SpawnProcess
  optionalRequire?: (id: string) => unknown
  persistAgentAvatarFromPath?: (agentId: string, sourcePath: string) => Promise<PersistedAgentAvatar>
  pickFolderWithOsDialog?: (startPath?: string, abortSignal?: AbortSignal) => Promise<PickerDialogResult>
  pickImageWithOsDialog?: (startPath?: string, abortSignal?: AbortSignal) => Promise<PickerDialogResult>
}

type PickerCommandOptions = {
  timeoutMs?: number
  windowsHide?: boolean
  abortSignal?: AbortSignal
  label?: string
}

type ParsedPickerOutput = {
  status?: string
  path?: string | null
  detail?: string
}

const defaultOptionalRequire = createRequire(import.meta.url)

export const DEFAULT_PICKER_TIMEOUT_MS = 60_000
export const DEFAULT_PICKER_SESSION_TTL_MS = 5 * 60 * 1000

export function quoteWindowsBatchArg(value: string) {
  return `"${value.replace(/%/g, '%%').replace(/"/g, '""')}"`
}

export function windowsPickerLauncherContents(title: string, scriptPath: string, outputPath: string, startPath: string) {
  return [
    '@echo off',
    [
      'start',
      quoteWindowsBatchArg(title),
      'powershell.exe',
      '-NoLogo',
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Normal',
      '-File',
      quoteWindowsBatchArg(scriptPath),
      '-OutPath',
      quoteWindowsBatchArg(outputPath),
      '-StartPath',
      quoteWindowsBatchArg(startPath),
    ].join(' '),
    '',
  ].join('\r\n')
}

export async function writeWindowsPickerLauncher(
  launcherPath: string,
  title: string,
  scriptPath: string,
  outputPath: string,
  startPath: string,
  fsApi: Pick<typeof defaultFs, 'writeFile'> = defaultFs,
) {
  await fsApi.writeFile(launcherPath, windowsPickerLauncherContents(title, scriptPath, outputPath, startPath), 'utf-8')
}

export function parseWindowsPickerOutput(raw: string): ParsedPickerOutput {
  const text = raw.replace(/^\uFEFF/, '')
  try {
    return JSON.parse(text) as ParsedPickerOutput
  } catch {
    const parsed: ParsedPickerOutput = {}
    for (const line of text.split(/\r?\n/)) {
      const separator = line.indexOf('=')
      if (separator <= 0) continue
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim()
      if (key === 'status') parsed.status = value
      else if (key === 'path') parsed.path = value
      else if (key === 'detail') parsed.detail = value
    }
    return parsed
  }
}

export function createPickerSessionService(options: PickerSessionServiceOptions) {
  const stateRoot = options.stateRoot
  const workspaceRoot = path.resolve(options.workspaceRoot)
  const fsApi = options.fs ?? defaultFs
  const timeoutMs = options.timeoutMs ?? DEFAULT_PICKER_TIMEOUT_MS
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_PICKER_SESSION_TTL_MS
  const platform = options.platform ?? process.platform
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? randomUUID
  const spawnProcess = options.spawnProcess ?? spawn
  const optionalRequire = options.optionalRequire ?? defaultOptionalRequire
  const folderPickerSessions = new Map<string, FolderPickerSession>()
  const imagePickerSessions = new Map<string, ImagePickerSession>()
  const activeTimeouts = new Set<ReturnType<typeof setTimeout>>()
  const activeIntervals = new Set<ReturnType<typeof setInterval>>()

  function setServiceTimeout(callback: () => void, ms: number) {
    const timer = setTimeout(() => {
      activeTimeouts.delete(timer)
      callback()
    }, ms)
    activeTimeouts.add(timer)
    return timer
  }

  function clearServiceTimeout(timer: ReturnType<typeof setTimeout> | null) {
    if (!timer) return
    clearTimeout(timer)
    activeTimeouts.delete(timer)
  }

  function setServiceInterval(callback: () => void, ms: number) {
    const timer = setInterval(callback, ms)
    activeIntervals.add(timer)
    return timer
  }

  function clearServiceInterval(timer: ReturnType<typeof setInterval> | null) {
    if (!timer) return
    clearInterval(timer)
    activeIntervals.delete(timer)
  }

  function dispose() {
    for (const timer of activeTimeouts) clearTimeout(timer)
    for (const timer of activeIntervals) clearInterval(timer)
    activeTimeouts.clear()
    activeIntervals.clear()
  }

  function pruneFolderPickerSessions() {
    const current = now()
    for (const [id, session] of folderPickerSessions) {
      if (session.expiresAt <= current) folderPickerSessions.delete(id)
    }
    for (const [id, session] of imagePickerSessions) {
      if (session.expiresAt <= current) imagePickerSessions.delete(id)
    }
  }

  function serializeFolderPickerSession(session: FolderPickerSession) {
    return {
      sessionId: session.id,
      status: session.status,
      path: session.path ?? null,
      cancelled: session.status === 'cancelled',
      detail: session.detail,
    }
  }

  function serializeImagePickerSession(session: ImagePickerSession) {
    return {
      ...serializeFolderPickerSession(session),
      agentId: session.agentId,
      sourcePath: session.sourcePath ?? null,
      avatar: session.avatar ?? null,
      previewUrl: session.previewUrl ?? null,
    }
  }

  function normalizePickerStartPath(startPath?: string, fallbackPath = workspaceRoot) {
    const fallback = path.resolve(fallbackPath || workspaceRoot)
    const raw = startPath?.trim() || ''
    if (!raw || raw.includes('\0')) return fallback
    if (/^(?:https?|data|blob):/i.test(raw)) return fallback
    if (/^[\\/](?:api|agents)[\\/]/i.test(raw)) return fallback
    if (/^file:/i.test(raw)) {
      try {
        return path.resolve(fileURLToPath(raw))
      } catch {
        return fallback
      }
    }
    if (path.isAbsolute(raw)) return path.resolve(raw)
    const candidate = path.resolve(fallback, raw)
    return isPathUnder(fallback, candidate) ? candidate : fallback
  }

  async function resolvePickerStartPath(startPath?: string) {
    let current = normalizePickerStartPath(startPath)
    for (let depth = 0; depth < 32; depth += 1) {
      try {
        const stat = await fsApi.stat(current)
        if (stat.isDirectory()) return current
        if (stat.isFile()) current = path.dirname(current)
      } catch {
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
      }
    }
    return workspaceRoot
  }

  function runPickerCommand(command: string, args: string[], commandOptions: PickerCommandOptions = {}): Promise<PickerDialogResult> {
    return new Promise((resolve) => {
      const commandTimeoutMs = commandOptions.timeoutMs ?? timeoutMs
      const label = commandOptions.label || 'Folder picker'
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | null = null
      const finish = (result: PickerDialogResult) => {
        if (settled) return
        settled = true
        clearServiceTimeout(timeout)
        commandOptions.abortSignal?.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const child = spawnProcess(command, args, { shell: false, windowsHide: commandOptions.windowsHide ?? true })
      let stdout = ''
      let stderr = ''
      const onAbort = () => {
        try {
          child.kill()
        } catch {
          // The process may already have exited.
        }
        finish({ ok: false, detail: `${label} request was cancelled before it completed.` })
      }
      if (commandOptions.abortSignal?.aborted) {
        onAbort()
        return
      }
      commandOptions.abortSignal?.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.once('error', (error) => {
        finish({ ok: false, detail: String(error) })
      })
      child.once('close', (code) => {
        const selected = stdout.trim().split(/\r?\n/).find(Boolean)?.trim()
        if (code === 0 && selected) finish({ ok: true, path: selected })
        else finish({ ok: false, detail: stderr.trim() || stdout.trim() || `exit:${code ?? 1}` })
      })
      if (commandTimeoutMs > 0) {
        timeout = setServiceTimeout(() => {
          try {
            child.kill()
          } catch {
            // The process may already have exited.
          }
          finish({
            ok: false,
            detail: `${label} timed out after ${Math.round(commandTimeoutMs / 1000)} seconds. Try Browse again.`,
          })
        }, commandTimeoutMs)
      }
    })
  }

  async function pickFolderWithElectron(startPath?: string): Promise<PickerDialogResult> {
    try {
      const defaultPath = await resolvePickerStartPath(startPath)
      const electron = optionalRequire('electron') as {
        dialog?: {
          showOpenDialog?: (options: {
            title?: string
            defaultPath?: string
            properties?: Array<'openDirectory' | 'createDirectory'>
          }) => Promise<{ canceled: boolean; filePaths: string[] }>
        }
      }
      const result = await electron.dialog?.showOpenDialog?.({
        title: 'Select Agent Workspace',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      })
      if (!result) return { ok: false, detail: 'Electron dialog is unavailable.' }
      if (result.canceled) return { ok: false, cancelled: true }
      const selected = result.filePaths[0]
      return selected ? { ok: true, path: selected } : { ok: false, cancelled: true }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  async function pickFolderWithOsDialog(startPath?: string, abortSignal?: AbortSignal): Promise<PickerDialogResult> {
    const pickerStart = await resolvePickerStartPath(startPath)
    const electronResult = await pickFolderWithElectron(pickerStart)
    if (electronResult.ok || electronResult.cancelled) return electronResult

    if (platform === 'win32') {
      const script = [
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '[System.Windows.Forms.Application]::EnableVisualStyles()',
        `$initialDirectory = ${JSON.stringify(pickerStart)}`,
        'if (-not [string]::IsNullOrWhiteSpace($initialDirectory) -and (Test-Path -LiteralPath $initialDirectory -PathType Leaf)) { $initialDirectory = Split-Path -LiteralPath $initialDirectory -Parent }',
        'if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) { $initialDirectory = [System.Environment]::GetFolderPath("DesktopDirectory") }',
        '$owner = New-Object System.Windows.Forms.Form',
        '$owner.Text = "Select Agent Workspace"',
        '$owner.StartPosition = "CenterScreen"',
        '$owner.Size = New-Object System.Drawing.Size(1, 1)',
        '$owner.TopMost = $true',
        '$owner.ShowInTaskbar = $false',
        '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
        '$owner.Show()',
        '$owner.BringToFront()',
        '$owner.Activate()',
        '[System.Windows.Forms.Application]::DoEvents()',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$dialog.Description = "Select Agent Workspace"',
        '$dialog.SelectedPath = $initialDirectory',
        '$dialog.ShowNewFolderButton = $true',
        '$result = $dialog.ShowDialog($owner)',
        '$owner.Dispose()',
        'if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) { Write-Output $dialog.SelectedPath; exit 0 }',
        'exit 1',
      ].filter(Boolean).join('; ')
      return runPickerCommand('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
        abortSignal,
        windowsHide: true,
      })
    }

    if (platform === 'darwin') {
      const script = `POSIX path of (choose folder with prompt "Select Agent Workspace" default location POSIX file ${JSON.stringify(pickerStart)})`
      return runPickerCommand('osascript', ['-e', script], { abortSignal })
    }

    const zenity = await runPickerCommand('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select Agent Workspace',
      `--filename=${pickerStart.endsWith(path.sep) ? pickerStart : `${pickerStart}${path.sep}`}`,
    ], { abortSignal })
    if (zenity.ok || !/ENOENT|not found/i.test(zenity.detail || '')) return zenity

    return runPickerCommand('kdialog', [
      '--getexistingdirectory',
      pickerStart,
      '--title',
      'Select Agent Workspace',
    ], { abortSignal })
  }

  async function pickImageWithElectron(startPath?: string): Promise<PickerDialogResult> {
    try {
      const defaultPath = await resolvePickerStartPath(startPath)
      const electron = optionalRequire('electron') as {
        dialog?: {
          showOpenDialog?: (options: {
            title?: string
            defaultPath?: string
            properties?: Array<'openFile'>
            filters?: Array<{ name: string; extensions: string[] }>
          }) => Promise<{ canceled: boolean; filePaths: string[] }>
        }
      }
      const result = await electron.dialog?.showOpenDialog?.({
        title: 'Choose agent profile picture',
        defaultPath,
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'svg'] },
        ],
      })
      if (!result) return { ok: false, detail: 'Electron dialog is unavailable.' }
      if (result.canceled) return { ok: false, cancelled: true }
      const selected = result.filePaths[0]
      return selected ? { ok: true, path: selected } : { ok: false, cancelled: true }
    } catch (error) {
      return { ok: false, detail: String(error) }
    }
  }

  async function pickImageWithOsDialog(startPath?: string, abortSignal?: AbortSignal): Promise<PickerDialogResult> {
    const pickerStart = await resolvePickerStartPath(startPath)
    const electronResult = await pickImageWithElectron(pickerStart)
    if (electronResult.ok || electronResult.cancelled) return electronResult

    if (platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '[System.Windows.Forms.Application]::EnableVisualStyles()',
        `$initialDirectory = ${JSON.stringify(pickerStart)}`,
        'if (-not [string]::IsNullOrWhiteSpace($initialDirectory) -and (Test-Path -LiteralPath $initialDirectory -PathType Leaf)) { $initialDirectory = Split-Path -LiteralPath $initialDirectory -Parent }',
        'if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) { $initialDirectory = [System.Environment]::GetFolderPath("Pictures") }',
        'if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) { $initialDirectory = [System.Environment]::GetFolderPath("DesktopDirectory") }',
        '$owner = New-Object System.Windows.Forms.Form',
        '$owner.Text = "DystopAI Profile Picture"',
        '$owner.StartPosition = "CenterScreen"',
        '$owner.Size = New-Object System.Drawing.Size(1, 1)',
        '$owner.TopMost = $true',
        '$owner.ShowInTaskbar = $false',
        '$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
        '$owner.Show()',
        '$owner.BringToFront()',
        '$owner.Activate()',
        '[System.Windows.Forms.Application]::DoEvents()',
        '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
        '$dialog.Title = "Choose agent profile picture"',
        '$dialog.InitialDirectory = $initialDirectory',
        '$dialog.CheckFileExists = $true',
        '$dialog.Multiselect = $false',
        '$dialog.Filter = "Image files (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.ico;*.svg)|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.ico;*.svg|All files (*.*)|*.*"',
        '$result = $dialog.ShowDialog($owner)',
        '$owner.Dispose()',
        'if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.FileName) { Write-Output $dialog.FileName; exit 0 }',
        'exit 1',
      ].join('; ')
      return runPickerCommand('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
        abortSignal,
        windowsHide: true,
        label: 'Image picker',
      })
    }

    if (platform === 'darwin') {
      const script = `POSIX path of (choose file with prompt "Choose agent profile picture" default location POSIX file ${JSON.stringify(pickerStart)} of type {"public.image"})`
      return runPickerCommand('osascript', ['-e', script], { abortSignal, label: 'Image picker' })
    }

    const zenity = await runPickerCommand('zenity', [
      '--file-selection',
      '--title=Choose agent profile picture',
      '--file-filter=Images | *.png *.jpg *.jpeg *.webp *.gif *.bmp *.ico *.svg',
      '--file-filter=All files | *',
      `--filename=${pickerStart.endsWith(path.sep) ? pickerStart : `${pickerStart}${path.sep}`}`,
    ], { abortSignal, label: 'Image picker' })
    if (zenity.ok || !/ENOENT|not found/i.test(zenity.detail || '')) return zenity

    return runPickerCommand('kdialog', [
      '--getopenfilename',
      pickerStart,
      'Images (*.png *.jpg *.jpeg *.webp *.gif *.bmp *.ico *.svg)',
      '--title',
      'Choose agent profile picture',
    ], { abortSignal, label: 'Image picker' })
  }

  const folderDialog = options.pickFolderWithOsDialog ?? pickFolderWithOsDialog
  const imageDialog = options.pickImageWithOsDialog ?? pickImageWithOsDialog

  function startFolderPickerSession(startPath: string) {
    pruneFolderPickerSessions()
    const startedAt = now()
    const session: FolderPickerSession = {
      id: randomId(),
      status: 'pending',
      path: null,
      detail: 'Folder picker is open.',
      startedAt,
      updatedAt: startedAt,
      expiresAt: startedAt + sessionTtlMs,
    }
    folderPickerSessions.set(session.id, session)
    if (platform === 'win32') {
      void launchWindowsFolderPickerSession(session, startPath)
      return session
    }
    void folderDialog(startPath)
      .then((picked) => {
        if (picked.ok && picked.path) {
          session.status = 'selected'
          session.path = path.resolve(picked.path)
          session.detail = 'Folder selected.'
        } else if (picked.cancelled) {
          session.status = 'cancelled'
          session.path = null
          session.detail = 'No folder selected.'
        } else {
          session.status = 'error'
          session.path = null
          session.detail = picked.detail || 'No supported native folder picker is available in this environment.'
        }
      })
      .catch((error) => {
        session.status = 'error'
        session.path = null
        session.detail = String(error)
      })
      .finally(() => {
        session.updatedAt = now()
        session.expiresAt = now() + sessionTtlMs
      })
    return session
  }

  function startImagePickerSession(agentId: string | undefined, startPath: string) {
    pruneFolderPickerSessions()
    const startedAt = now()
    const session: ImagePickerSession = {
      id: randomId(),
      status: 'pending',
      path: null,
      sourcePath: null,
      avatar: null,
      previewUrl: null,
      agentId,
      detail: 'Image picker is open.',
      startedAt,
      updatedAt: startedAt,
      expiresAt: startedAt + sessionTtlMs,
    }
    imagePickerSessions.set(session.id, session)
    if (platform === 'win32') {
      void launchWindowsImagePickerSession(session, startPath)
      return session
    }
    void imageDialog(startPath)
      .then((picked) => finishImagePickerSession(session, picked))
      .catch((error) => {
        session.status = 'error'
        session.path = null
        session.detail = error instanceof Error && error.message ? error.message : String(error)
      })
      .finally(() => {
        session.updatedAt = now()
        session.expiresAt = now() + sessionTtlMs
      })
    return session
  }

  async function launchWindowsFolderPickerSession(session: FolderPickerSession, startPath: string) {
    const pickerDir = path.join(stateRoot, 'tmp', 'folder-picker')
    const scriptPath = path.join(pickerDir, `${session.id}.ps1`)
    const launcherPath = path.join(pickerDir, `${session.id}.cmd`)
    const outputPath = path.join(pickerDir, `${session.id}.json`)
    let finished = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    const finish = async (status: PickerSessionStatus, detail?: string, selectedPath?: string | null) => {
      if (finished) return
      finished = true
      clearServiceInterval(pollTimer)
      clearServiceTimeout(timeoutTimer)
      session.status = status
      session.path = selectedPath ? path.resolve(selectedPath) : null
      session.detail = detail
      session.updatedAt = now()
      session.expiresAt = now() + sessionTtlMs
      setServiceTimeout(() => {
        void fsApi.unlink(scriptPath).catch(() => {})
        void fsApi.unlink(launcherPath).catch(() => {})
        void fsApi.unlink(outputPath).catch(() => {})
      }, sessionTtlMs)
    }

    const readOutput = async () => {
      try {
        const raw = await fsApi.readFile(outputPath, 'utf-8')
        const parsed = parseWindowsPickerOutput(raw)
        if (parsed.status === 'selected' && parsed.path?.trim()) {
          await finish('selected', 'Folder selected.', parsed.path.trim())
        } else if (parsed.status === 'cancelled') {
          await finish('cancelled', parsed.detail || 'No folder selected.')
        } else {
          await finish('error', parsed.detail || 'Folder picker failed.')
        }
      } catch {
        // The helper has not written its result yet.
      }
    }

    try {
      await fsApi.mkdir(pickerDir, { recursive: true })
      const pickerStart = await resolvePickerStartPath(startPath)
      const script = [
        'param(',
        '  [Parameter(Mandatory=$true)][string]$OutPath,',
        '  [Parameter(Mandatory=$true)][string]$StartPath',
        ')',
        '$ErrorActionPreference = "Stop"',
        'function Write-PickerResult($value) {',
        '  $json = $value | ConvertTo-Json -Compress',
        '  $json | Set-Content -LiteralPath $OutPath -Encoding UTF8',
        '}',
        'try {',
        '  Add-Type -AssemblyName System.Windows.Forms',
        '  Add-Type -AssemblyName System.Drawing',
        '  [System.Windows.Forms.Application]::EnableVisualStyles()',
        '  $initialDirectory = $StartPath',
        '  if (-not [string]::IsNullOrWhiteSpace($initialDirectory) -and (Test-Path -LiteralPath $initialDirectory -PathType Leaf)) {',
        '    $initialDirectory = Split-Path -LiteralPath $initialDirectory -Parent',
        '  }',
        '  if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) {',
        '    $initialDirectory = [System.Environment]::GetFolderPath("DesktopDirectory")',
        '  }',
        '  $owner = New-Object System.Windows.Forms.Form',
        '  $owner.Text = "Select Agent Workspace"',
        '  $owner.StartPosition = "CenterScreen"',
        '  $owner.Size = New-Object System.Drawing.Size(320, 80)',
        '  $owner.TopMost = $true',
        '  $owner.ShowInTaskbar = $true',
        '  $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
        '  $owner.Show()',
        '  $owner.BringToFront()',
        '  $owner.Activate()',
        '  [System.Windows.Forms.Application]::DoEvents()',
        '  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        '  $dialog.Description = "Select Agent Workspace"',
        '  $dialog.SelectedPath = $initialDirectory',
        '  $dialog.ShowNewFolderButton = $true',
        '  $result = $dialog.ShowDialog($owner)',
        '  $owner.Dispose()',
        '  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.SelectedPath)) {',
        '    Write-PickerResult @{ status = "selected"; path = $dialog.SelectedPath }',
        '    exit 0',
        '  }',
        '  Write-PickerResult @{ status = "cancelled"; detail = "No folder selected." }',
        '  exit 0',
        '} catch {',
        '  Write-PickerResult @{ status = "error"; detail = $_.Exception.Message }',
        '  exit 1',
        '}',
        '',
      ].join('\n')
      await fsApi.writeFile(scriptPath, script, 'utf-8')
      await writeWindowsPickerLauncher(launcherPath, 'Select Agent Workspace', scriptPath, outputPath, pickerStart, fsApi)
      const launcher = spawnProcess('cmd.exe', ['/d', '/s', '/c', launcherPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      launcher.unref()
      launcher.once('error', (error) => {
        void finish('error', String(error))
      })
      pollTimer = setServiceInterval(() => {
        void readOutput()
      }, 500)
      timeoutTimer = setServiceTimeout(() => {
        void finish('error', `Folder picker timed out after ${Math.round(timeoutMs / 1000)} seconds. Paste a directory path manually and press Set, or try Browse again.`)
      }, timeoutMs)
    } catch (error) {
      await finish('error', String(error))
    }
  }

  async function finishImagePickerSession(session: ImagePickerSession, picked: PickerDialogResult) {
    if (picked.ok && picked.path) {
      const selectedPath = path.resolve(picked.path)
      if (!isSupportedAvatarImagePath(selectedPath)) {
        throw new Error(AVATAR_IMAGE_TYPE_ERROR)
      }
      session.sourcePath = selectedPath
      if (session.agentId) {
        if (!options.persistAgentAvatarFromPath) {
          throw new Error('Avatar persistence is unavailable.')
        }
        const persisted = await options.persistAgentAvatarFromPath(session.agentId, selectedPath)
        session.path = persisted.avatarPath
        session.avatar = persisted.avatar
        session.previewUrl = persisted.previewUrl
        session.detail = 'Profile picture selected.'
      } else {
        session.path = selectedPath
        session.detail = 'Image selected.'
      }
      session.status = 'selected'
    } else if (picked.cancelled) {
      session.status = 'cancelled'
      session.path = null
      session.detail = 'No image selected.'
    } else {
      session.status = 'error'
      session.path = null
      session.detail = picked.detail || 'No supported native image picker is available in this environment.'
    }
    session.updatedAt = now()
    session.expiresAt = now() + sessionTtlMs
  }

  async function launchWindowsImagePickerSession(session: ImagePickerSession, startPath: string) {
    const pickerDir = path.join(stateRoot, 'tmp', 'image-picker')
    const scriptPath = path.join(pickerDir, `${session.id}.ps1`)
    const launcherPath = path.join(pickerDir, `${session.id}.cmd`)
    const outputPath = path.join(pickerDir, `${session.id}.json`)
    let finished = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null

    const finish = async (status: PickerSessionStatus, detail?: string, selectedPath?: string | null) => {
      if (finished) return
      finished = true
      clearServiceInterval(pollTimer)
      clearServiceTimeout(timeoutTimer)
      try {
        if (status === 'selected' && selectedPath) {
          await finishImagePickerSession(session, { ok: true, path: selectedPath })
        } else {
          await finishImagePickerSession(session, { ok: false, cancelled: status === 'cancelled', detail })
        }
      } catch (error) {
        session.status = 'error'
        session.path = null
        session.detail = error instanceof Error && error.message ? error.message : String(error)
        session.updatedAt = now()
        session.expiresAt = now() + sessionTtlMs
      }
      setServiceTimeout(() => {
        void fsApi.unlink(scriptPath).catch(() => {})
        void fsApi.unlink(launcherPath).catch(() => {})
        void fsApi.unlink(outputPath).catch(() => {})
      }, sessionTtlMs)
    }

    const readOutput = async () => {
      try {
        const raw = await fsApi.readFile(outputPath, 'utf-8')
        const parsed = parseWindowsPickerOutput(raw)
        if (parsed.status === 'selected' && parsed.path?.trim()) {
          await finish('selected', 'Image selected.', parsed.path.trim())
        } else if (parsed.status === 'cancelled') {
          await finish('cancelled', parsed.detail || 'No image selected.')
        } else {
          await finish('error', parsed.detail || 'Image picker failed.')
        }
      } catch {
        // The helper has not written its result yet.
      }
    }

    try {
      await fsApi.mkdir(pickerDir, { recursive: true })
      const pickerStart = await resolvePickerStartPath(startPath)
      const script = [
        'param(',
        '  [Parameter(Mandatory=$true)][string]$OutPath,',
        '  [Parameter(Mandatory=$true)][string]$StartPath',
        ')',
        '$ErrorActionPreference = "Stop"',
        'function Write-PickerResult($value) {',
        '  $json = $value | ConvertTo-Json -Compress',
        '  $json | Set-Content -LiteralPath $OutPath -Encoding UTF8',
        '}',
        'try {',
        '  Add-Type -AssemblyName System.Windows.Forms',
        '  Add-Type -AssemblyName System.Drawing',
        '  [System.Windows.Forms.Application]::EnableVisualStyles()',
        '  $initialDirectory = $StartPath',
        '  if (-not [string]::IsNullOrWhiteSpace($initialDirectory) -and (Test-Path -LiteralPath $initialDirectory -PathType Leaf)) {',
        '    $initialDirectory = Split-Path -LiteralPath $initialDirectory -Parent',
        '  }',
        '  if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) {',
        '    $initialDirectory = [System.Environment]::GetFolderPath("Pictures")',
        '  }',
        '  if ([string]::IsNullOrWhiteSpace($initialDirectory) -or -not (Test-Path -LiteralPath $initialDirectory -PathType Container)) {',
        '    $initialDirectory = [System.Environment]::GetFolderPath("DesktopDirectory")',
        '  }',
        '  $owner = New-Object System.Windows.Forms.Form',
        '  $owner.Text = "DystopAI Profile Picture"',
        '  $owner.StartPosition = "CenterScreen"',
        '  $owner.Size = New-Object System.Drawing.Size(320, 80)',
        '  $owner.TopMost = $true',
        '  $owner.ShowInTaskbar = $true',
        '  $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedToolWindow',
        '  $owner.Show()',
        '  $owner.BringToFront()',
        '  $owner.Activate()',
        '  [System.Windows.Forms.Application]::DoEvents()',
        '  $dialog = New-Object System.Windows.Forms.OpenFileDialog',
        '  $dialog.Title = "Choose agent profile picture"',
        '  $dialog.InitialDirectory = $initialDirectory',
        '  $dialog.CheckFileExists = $true',
        '  $dialog.Multiselect = $false',
        '  $dialog.Filter = "Image files (*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.ico;*.svg)|*.png;*.jpg;*.jpeg;*.webp;*.gif;*.bmp;*.ico;*.svg|All files (*.*)|*.*"',
        '  $result = $dialog.ShowDialog($owner)',
        '  $owner.Dispose()',
        '  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($dialog.FileName)) {',
        '    Write-PickerResult @{ status = "selected"; path = $dialog.FileName }',
        '    exit 0',
        '  }',
        '  Write-PickerResult @{ status = "cancelled"; detail = "No image selected." }',
        '  exit 0',
        '} catch {',
        '  Write-PickerResult @{ status = "error"; detail = $_.Exception.Message }',
        '  exit 1',
        '}',
        '',
      ].join('\n')
      await fsApi.writeFile(scriptPath, script, 'utf-8')
      await writeWindowsPickerLauncher(launcherPath, 'DystopAI Profile Picture', scriptPath, outputPath, pickerStart, fsApi)
      const launcher = spawnProcess('cmd.exe', ['/d', '/s', '/c', launcherPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
      launcher.unref()
      launcher.once('error', (error) => {
        void finish('error', String(error))
      })
      pollTimer = setServiceInterval(() => {
        void readOutput()
      }, 500)
      timeoutTimer = setServiceTimeout(() => {
        void finish('error', `Image picker timed out after ${Math.round(timeoutMs / 1000)} seconds. Try Browse again.`)
      }, timeoutMs)
    } catch (error) {
      await finish('error', String(error))
    }
  }

  return {
    dispose,
    getFolderPickerSession: (sessionId: string) => folderPickerSessions.get(sessionId),
    getImagePickerSession: (sessionId: string) => imagePickerSessions.get(sessionId),
    normalizePickerStartPath,
    pickFolderWithOsDialog: folderDialog,
    pickImageWithOsDialog: imageDialog,
    pruneFolderPickerSessions,
    resolvePickerStartPath,
    serializeFolderPickerSession,
    serializeImagePickerSession,
    startFolderPickerSession,
    startImagePickerSession,
  }
}

export type PickerSessionService = ReturnType<typeof createPickerSessionService>
