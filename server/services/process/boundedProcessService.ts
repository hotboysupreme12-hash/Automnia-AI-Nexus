import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

export const DEFAULT_PROCESS_OUTPUT_LIMIT_CHARS = 1_200_000

export type BoundedProcessFailureKind = 'timeout' | 'process_error'

export type BoundedProcessResult = {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
  failureKind?: BoundedProcessFailureKind
}

type SpawnProcess = (command: string, args: string[], options: SpawnOptions) => ChildProcess
type TerminateProcessTree = (pid: number | undefined, reason?: string, force?: boolean) => Promise<unknown> | unknown

export function appendBoundedProcessOutput(
  current: string,
  chunk: unknown,
  maxChars = DEFAULT_PROCESS_OUTPUT_LIMIT_CHARS,
) {
  const text = String(chunk || '')
  if (!text) return current
  const limit = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : DEFAULT_PROCESS_OUTPUT_LIMIT_CHARS
  const marker = `\n\n[Output truncated by Control Center at ${limit} chars.]`
  if (current.endsWith(marker)) return current

  const combined = current + text
  if (combined.length <= limit) return combined
  if (marker.length >= limit) return combined.slice(0, limit)
  return `${combined.slice(0, limit - marker.length)}${marker}`
}

export function runBoundedTextProcess(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number
    windowsHide?: boolean
    maxOutputChars?: number
    platform?: NodeJS.Platform
    spawnProcess?: SpawnProcess
    terminateProcessTree?: TerminateProcessTree
  } = {},
): Promise<BoundedProcessResult> {
  const platform = options.platform || process.platform
  const spawnProcess = options.spawnProcess || spawn
  const maxOutputChars = options.maxOutputChars || DEFAULT_PROCESS_OUTPUT_LIMIT_CHARS

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | null = null
    const finish = (result: BoundedProcessResult) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve(result)
    }

    let child: ChildProcess
    try {
      child = spawnProcess(command, args, {
        shell: false,
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(platform === 'win32' ? { windowsHide: options.windowsHide ?? true } : {}),
      })
    } catch (error) {
      stderr = appendBoundedProcessOutput(stderr, String(error), maxOutputChars)
      finish({ stdout, stderr, code: 1, timedOut: false, failureKind: 'process_error' })
      return
    }

    child.stdout?.on('data', (chunk) => {
      stdout = appendBoundedProcessOutput(stdout, chunk, maxOutputChars)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendBoundedProcessOutput(stderr, chunk, maxOutputChars)
    })
    child.once('error', (error) => {
      stderr = appendBoundedProcessOutput(stderr, String(error), maxOutputChars)
      finish({ stdout, stderr, code: 1, timedOut: false, failureKind: 'process_error' })
    })
    child.once('close', (code) => {
      finish({
        stdout,
        stderr,
        code,
        timedOut: false,
        ...(code === null ? { failureKind: 'process_error' as const } : {}),
      })
    })

    if (Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0) {
      timeout = setTimeout(() => {
        if (settled) return
        const timedOutResult: BoundedProcessResult = {
          stdout,
          stderr,
          code: null,
          timedOut: true,
          failureKind: 'timeout',
        }
        try {
          const termination = options.terminateProcessTree?.(child.pid, `${command} helper timeout`, true)
          if (termination && typeof (termination as Promise<unknown>).catch === 'function') {
            void (termination as Promise<unknown>).catch(() => undefined)
          }
        } catch {
          // Preserve the timeout result even if cleanup fails synchronously.
        }
        finish(timedOutResult)
      }, options.timeoutMs)
    }
  })
}
