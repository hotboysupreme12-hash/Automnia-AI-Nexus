const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  MANIFEST_MAX_BYTES,
  SIGNATURE_MAX_BYTES,
  artifactUrl,
  compareVersions,
  expectedUpdateFilename,
  isMandatoryUpdate,
  isRolloutEligible,
  normalizeBaseUrl,
  selectArtifact,
  verifySignedManifest,
} = require('./update-policy.cjs')

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000
const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000]
const REQUEST_TIMEOUT_MS = 20 * 1000
const PREFERENCES_SCHEMA = 1

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function defaultPreferences() {
  return {
    schema: PREFERENCES_SCHEMA,
    autoDownload: true,
    installationId: crypto.randomUUID(),
    deferredUntil: null,
  }
}

function loadPreferences(filePath) {
  const stored = readJson(filePath)
  const defaults = defaultPreferences()
  if (!stored || stored.schema !== PREFERENCES_SCHEMA) {
    atomicWriteJson(filePath, defaults)
    return defaults
  }
  const installationId = typeof stored.installationId === 'string' && /^[0-9a-f-]{20,64}$/i.test(stored.installationId)
    ? stored.installationId
    : defaults.installationId
  const deferredUntil = Number.isFinite(Date.parse(stored.deferredUntil || '')) ? stored.deferredUntil : null
  const value = {
    schema: PREFERENCES_SCHEMA,
    autoDownload: stored.autoDownload !== false,
    installationId,
    deferredUntil,
  }
  atomicWriteJson(filePath, value)
  return value
}

function publicError(error, context = '') {
  const raw = error instanceof Error ? error.message : String(error || '')
  const message = raw.replace(/https?:\/\/\S+/gi, '[update server]').replace(/[\r\n]+/g, ' ').slice(0, 400)
  if (/ENOSPC|not enough space|disk space/i.test(message)) return 'There is not enough free disk space to safely download this update.'
  if (/certificate|signature|checksum|sha-?256|trust key|tamper/i.test(message)) return 'The update could not be verified. Automnia kept the current version and did not install anything.'
  if (/ENOTFOUND|ECONN|network|fetch|timed? out|offline|abort/i.test(message)) return 'Automnia could not reach the update service. Your current version will keep working and the check will retry later.'
  if (/metadata|manifest|release/i.test(message)) return 'The update release is incomplete or inconsistent. Automnia kept the current version.'
  return context ? `${context}: ${message || 'Unknown update error'}` : (message || 'Unknown update error')
}

function safeLog(logger, level, message, details) {
  try {
    logger?.[level]?.(message, details)
  } catch {
    // Update diagnostics must never affect the application lifecycle.
  }
}

async function fetchBoundedText(fetchImpl, initialUrl, maxBytes, baseOrigin) {
  let currentUrl = initialUrl
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    if (typeof timeout.unref === 'function') timeout.unref()
    try {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
        headers: { accept: 'application/json, text/plain;q=0.9', 'cache-control': 'no-cache' },
        signal: controller.signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location || redirects === 3) throw new Error('Update service returned too many redirects')
        const redirected = new URL(location, currentUrl)
        if (redirected.protocol !== 'https:' || redirected.origin !== baseOrigin || redirected.username || redirected.password) {
          throw new Error('Update service attempted an untrusted redirect')
        }
        currentUrl = redirected.toString()
        continue
      }
      if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}`)
      const declaredLength = Number(response.headers.get('content-length') || 0)
      if (declaredLength > maxBytes) throw new Error('Update response exceeded its size limit')
      if (response.body?.getReader) {
        const reader = response.body.getReader()
        const chunks = []
        let received = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = Buffer.from(value)
            received += chunk.length
            if (received > maxBytes) {
              controller.abort()
              try { await reader.cancel('Update response exceeded its size limit') } catch {}
              throw new Error('Update response exceeded its size limit')
            }
            chunks.push(chunk)
          }
        } finally {
          try { reader.releaseLock() } catch {}
        }
        return Buffer.concat(chunks, received).toString('utf8')
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > maxBytes) throw new Error('Update response exceeded its size limit')
      return bytes.toString('utf8')
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error('Update service redirect limit exceeded')
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

function createInitialState({ currentVersion, supported, autoDownload, disabledReason }) {
  return {
    status: supported ? 'idle' : 'disabled',
    supported,
    currentVersion,
    availableVersion: null,
    mandatory: false,
    autoDownload,
    deferredUntil: null,
    progressPercent: null,
    bytesPerSecond: null,
    transferred: null,
    total: null,
    releaseNotesUrl: null,
    manualDownloadUrl: null,
    lastCheckedAt: null,
    error: disabledReason || null,
    errorVisible: false,
  }
}

function createAppUpdater(options) {
  const app = options.app
  const updater = options.autoUpdater
  const currentVersion = app.getVersion()
  const preferencesPath = path.join(options.userDataPath, 'update-preferences.json')
  const pendingPath = path.join(options.userDataPath, 'pending-update.json')
  let preferences = loadPreferences(preferencesPath)
  let baseUrl = null
  let disabledReason = ''
  try {
    baseUrl = normalizeBaseUrl(options.baseUrl, { allowInsecureLocalhost: options.allowInsecureLocalhost })
  } catch (error) {
    disabledReason = publicError(error, 'Automatic updates are not configured')
  }
  if (!options.isPackaged && !options.allowDevelopment) disabledReason = 'Automatic updates are available in installed production builds.'
  if (!options.publicKeyPath || !fs.existsSync(options.publicKeyPath)) disabledReason = 'This build does not contain the update verification key.'
  if (!updater) disabledReason = 'The desktop update service is unavailable in this build.'
  const supported = !disabledReason
  let state = createInitialState({ currentVersion, supported, autoDownload: preferences.autoDownload, disabledReason })
  let expectedManifest = null
  let expectedArtifact = null
  let checkPromise = null
  let downloadPromise = null
  let installPromise = null
  let initialTimer = null
  let intervalTimer = null
  let retryTimer = null
  let consecutiveFailures = 0
  let progressPublishedAt = 0
  let manualCheck = false
  let started = false

  const publish = (patch = {}) => {
    state = {
      ...state,
      ...patch,
      autoDownload: preferences.autoDownload,
      deferredUntil: preferences.deferredUntil,
    }
    options.onState?.({ ...state })
    return { ...state }
  }

  const scheduleRetry = () => {
    if (retryTimer || !supported || !started || ['ready', 'installing'].includes(state.status)) return
    const configuredDelays = Array.isArray(options.retryDelaysMs) && options.retryDelaysMs.length
      ? options.retryDelaysMs
      : RETRY_DELAYS_MS
    const rawDelay = Number(configuredDelays[Math.min(consecutiveFailures - 1, configuredDelays.length - 1)])
    const delay = Number.isFinite(rawDelay) ? Math.max(1_000, rawDelay) : RETRY_DELAYS_MS[0]
    retryTimer = setTimeout(() => {
      retryTimer = null
      void check()
    }, delay)
    if (typeof retryTimer.unref === 'function') retryTimer.unref()
  }

  const markSuccessfulCheck = () => {
    consecutiveFailures = 0
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }

  const fail = (error, context, visible = manualCheck) => {
    const message = publicError(error, context)
    safeLog(options.logger, 'error', '[updater] operation failed', { context, message })
    consecutiveFailures += 1
    const result = publish({ status: 'error', error: message, errorVisible: Boolean(visible), progressPercent: null })
    scheduleRetry()
    return result
  }

  const isDeferred = () => Boolean(
    !state.mandatory && preferences.deferredUntil && Date.parse(preferences.deferredUntil) > Date.now(),
  )

  const validateDiskSpace = async () => {
    if (!expectedArtifact || typeof fs.promises.statfs !== 'function') return
    try {
      const stat = await fs.promises.statfs(options.tempPath)
      const available = Number(stat.bavail) * Number(stat.bsize)
      const required = Math.max(expectedArtifact.size * 2, expectedArtifact.size + 256 * 1024 * 1024)
      if (Number.isFinite(available) && available < required) {
        throw new Error(`Not enough disk space: ${available} available, ${required} required`)
      }
    } catch (error) {
      if (/not enough disk space/i.test(error?.message || '')) throw error
      safeLog(options.logger, 'warn', '[updater] free-space preflight unavailable', { message: error?.message || String(error) })
    }
  }

  const download = async () => {
    if (!supported) return { ...state }
    if (downloadPromise) return downloadPromise
    if (!expectedManifest || !expectedArtifact || !['available', 'error'].includes(state.status)) return { ...state }
    downloadPromise = Promise.resolve().then(async () => {
      await validateDiskSpace()
      publish({ status: 'downloading', error: null, errorVisible: false, progressPercent: 0 })
      await updater.downloadUpdate()
      return { ...state }
    }).catch((error) => fail(error, 'The update download failed', true)).finally(() => {
      downloadPromise = null
    })
    return downloadPromise
  }

  const handleUpdateAvailable = (info) => {
    try {
      if (!expectedManifest || !expectedArtifact) throw new Error('Update metadata arrived without a verified manifest')
      if (compareVersions(info?.version, expectedManifest.version) !== 0) throw new Error('Update metadata version does not match the signed manifest')
      const metadataFilename = expectedUpdateFilename(info)
      if (metadataFilename && metadataFilename !== path.basename(expectedArtifact.file)) {
        throw new Error('Update metadata artifact does not match the signed manifest')
      }
      publish({
        status: 'available',
        availableVersion: expectedManifest.version,
        error: null,
        errorVisible: false,
      })
      markSuccessfulCheck()
      if (preferences.autoDownload && !isDeferred()) void download()
    } catch (error) {
      fail(error, 'The published update metadata is inconsistent', true)
    }
  }

  const handleDownloaded = async (event) => {
    try {
      if (!expectedManifest || !expectedArtifact) throw new Error('Downloaded update has no verified manifest')
      const downloadedFile = event?.downloadedFile
      if (!downloadedFile || !fs.existsSync(downloadedFile)) throw new Error('Downloaded update file is missing')
      const stat = await fs.promises.stat(downloadedFile)
      if (stat.size !== expectedArtifact.size) throw new Error('Downloaded update size does not match the signed manifest')
      const digest = await sha256File(downloadedFile)
      if (digest !== expectedArtifact.sha256) throw new Error('Downloaded update checksum does not match the signed manifest')
      publish({
        status: 'ready',
        availableVersion: expectedManifest.version,
        progressPercent: 100,
        transferred: stat.size,
        total: stat.size,
        error: null,
        errorVisible: false,
      })
      options.onReady?.({ ...state })
    } catch (error) {
      try {
        if (event?.downloadedFile) await fs.promises.rm(event.downloadedFile, { force: true })
      } catch {}
      fail(error, 'The downloaded update could not be verified', true)
    }
  }

  const loadVerifiedManifest = async () => {
    const publicKeyPem = fs.readFileSync(options.publicKeyPath, 'utf8')
    const base = new URL(`${baseUrl}/`)
    const cacheKey = `${encodeURIComponent(currentVersion)}-${Math.floor(Date.now() / (15 * 60 * 1000))}`
    const manifestUrl = new URL(`update-manifest.json?client=${cacheKey}`, base).toString()
    const signatureUrl = new URL(`update-manifest.json.sig?client=${cacheKey}`, base).toString()
    const [manifestText, signatureText] = await Promise.all([
      fetchBoundedText(options.fetch, manifestUrl, MANIFEST_MAX_BYTES, base.origin),
      fetchBoundedText(options.fetch, signatureUrl, SIGNATURE_MAX_BYTES, base.origin),
    ])
    const manifest = verifySignedManifest(manifestText, signatureText, publicKeyPem)
    if (manifest.channel !== options.channel) throw new Error('Update manifest channel does not match this build')
    if (compareVersions(manifest.minimumVersion, manifest.version) > 0) throw new Error('Update minimum version is newer than its release version')
    return manifest
  }

  const check = async ({ userInitiated = false } = {}) => {
    if (!supported) return publish({ errorVisible: userInitiated })
    if (checkPromise) return checkPromise
    if (['downloading', 'ready', 'installing'].includes(state.status)) return { ...state }
    manualCheck = userInitiated
    checkPromise = Promise.resolve().then(async () => {
      publish({ status: 'checking', error: null, errorVisible: false, lastCheckedAt: new Date().toISOString() })
      const manifest = await loadVerifiedManifest()
      const mandatory = isMandatoryUpdate(manifest, currentVersion)
      const newer = compareVersions(manifest.version, currentVersion) > 0
      if (!newer || !isRolloutEligible(manifest, preferences.installationId, mandatory)) {
        expectedManifest = null
        expectedArtifact = null
        markSuccessfulCheck()
        return publish({ status: 'up-to-date', availableVersion: null, mandatory: false, releaseNotesUrl: null, manualDownloadUrl: null })
      }
      const artifact = selectArtifact(manifest, options.platform, options.arch)
      if (!artifact) throw new Error('No signed update artifact matches this operating system and architecture')
      expectedManifest = manifest
      expectedArtifact = artifact
      preferences.deferredUntil = mandatory ? null : preferences.deferredUntil
      atomicWriteJson(preferencesPath, preferences)
      publish({
        status: 'checking',
        availableVersion: manifest.version,
        mandatory,
        releaseNotesUrl: manifest.releaseNotesUrl || null,
        manualDownloadUrl: artifactUrl(baseUrl, artifact),
      })
      if (options.platform === 'linux' && !options.isAppImage) {
        markSuccessfulCheck()
        return publish({
          status: 'manual-required',
          error: 'This Linux package is managed by the system installer. Download the signed package, close Automnia, and install it with your package manager.',
          errorVisible: userInitiated || mandatory,
        })
      }
      await updater.checkForUpdates()
      return { ...state }
    }).catch((error) => fail(error, 'The update check failed', userInitiated)).finally(() => {
      manualCheck = false
      checkPromise = null
    })
    return checkPromise
  }

  const install = async () => {
    if (installPromise) return installPromise
    if (state.status !== 'ready' || !expectedManifest) return { ...state }
    installPromise = Promise.resolve().then(async () => {
      publish({ status: 'installing', error: null, errorVisible: false })
      atomicWriteJson(pendingPath, {
        schema: 1,
        fromVersion: currentVersion,
        toVersion: expectedManifest.version,
        requestedAt: new Date().toISOString(),
      })
      await options.beforeInstall?.()
      safeLog(options.logger, 'info', '[updater] launching verified installer', { version: expectedManifest.version })
      updater.quitAndInstall(false, true)
      const watchdog = setTimeout(() => {
        installPromise = null
        if (state.status === 'installing') fail(new Error('Installer did not close the application'), 'The update installer could not start', true)
      }, 15_000)
      if (typeof watchdog.unref === 'function') watchdog.unref()
      return { ...state }
    }).catch((error) => {
      installPromise = null
      return fail(error, 'The update installer could not start', true)
    })
    return installPromise
  }

  const defer = (hours = 24) => {
    if (state.mandatory) return publish({ error: 'This required update cannot be postponed.', errorVisible: true })
    const boundedHours = Math.min(24 * 7, Math.max(1, Number(hours) || 24))
    preferences.deferredUntil = new Date(Date.now() + boundedHours * 60 * 60 * 1000).toISOString()
    atomicWriteJson(preferencesPath, preferences)
    return publish({ error: null, errorVisible: false })
  }

  const setPreferences = (next = {}) => {
    if (typeof next.autoDownload === 'boolean') preferences.autoDownload = next.autoDownload
    atomicWriteJson(preferencesPath, preferences)
    const result = publish()
    if (preferences.autoDownload && state.status === 'available' && !isDeferred()) void download()
    return result
  }

  const markHealthy = () => {
    const pending = readJson(pendingPath)
    try {
      if (pending?.toVersion && compareVersions(currentVersion, pending.toVersion) >= 0) {
        try { fs.rmSync(pendingPath, { force: true }) } catch {}
        safeLog(options.logger, 'info', '[updater] updated version passed startup health checks', { version: currentVersion })
      }
    } catch {
      try { fs.rmSync(pendingPath, { force: true }) } catch {}
    }
  }

  const detectFailedInstall = () => {
    const pending = readJson(pendingPath)
    if (!pending?.fromVersion || !pending?.toVersion) return
    try {
      if (compareVersions(currentVersion, pending.fromVersion) === 0) {
        publish({
          status: 'error',
          availableVersion: pending.toVersion,
          error: 'The previous update did not complete. Automnia kept your existing version and will retry only when you choose.',
          errorVisible: true,
        })
      }
    } catch {
      try { fs.rmSync(pendingPath, { force: true }) } catch {}
    }
  }

  const start = () => {
    if (started) return
    started = true
    if (!supported) {
      publish()
      return
    }
    try {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.allowDowngrade = false
      updater.allowPrerelease = options.channel !== 'stable'
      updater.requestHeaders = { 'cache-control': 'no-cache' }
      updater.channel = options.channel === 'stable' ? 'latest' : options.channel
      updater.setFeedURL({ provider: 'generic', url: baseUrl })
    } catch (error) {
      fail(error, 'Automatic updates could not initialize', false)
      return
    }
    updater.on('update-available', handleUpdateAvailable)
    updater.on('update-not-available', () => {
      if (expectedManifest && compareVersions(expectedManifest.version, currentVersion) > 0) {
        fail(new Error('Signed manifest is newer but provider metadata reports no update'), 'The published release metadata is incomplete', true)
      } else {
        markSuccessfulCheck()
        publish({ status: 'up-to-date', availableVersion: null, mandatory: false })
      }
    })
    updater.on('download-progress', (progress) => {
      const now = Date.now()
      if (now - progressPublishedAt < 250 && Number(progress.percent) < 100) return
      progressPublishedAt = now
      publish({
        status: 'downloading',
        progressPercent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
        bytesPerSecond: Number(progress.bytesPerSecond) || null,
        transferred: Number(progress.transferred) || null,
        total: Number(progress.total) || null,
      })
    })
    updater.on('update-downloaded', (event) => { void handleDownloaded(event) })
    updater.on('error', (error) => fail(error, 'The desktop updater reported an error', manualCheck || state.status === 'downloading'))
    detectFailedInstall()
    const requestedInitialDelay = Number(options.initialDelayMs)
    const initialDelay = Number.isFinite(requestedInitialDelay) ? Math.max(0, requestedInitialDelay) : DEFAULT_INITIAL_DELAY_MS
    initialTimer = setTimeout(() => { void check() }, initialDelay)
    if (typeof initialTimer.unref === 'function') initialTimer.unref()
    const requestedInterval = Number(options.checkIntervalMs)
    const interval = Number.isFinite(requestedInterval) ? Math.max(15 * 60 * 1000, requestedInterval) : DEFAULT_CHECK_INTERVAL_MS
    intervalTimer = setInterval(() => { void check() }, interval)
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref()
  }

  const stop = () => {
    if (initialTimer) clearTimeout(initialTimer)
    if (intervalTimer) clearInterval(intervalTimer)
    if (retryTimer) clearTimeout(retryTimer)
    initialTimer = null
    intervalTimer = null
    retryTimer = null
  }

  return {
    check,
    defer,
    download,
    getState: () => ({ ...state }),
    install,
    markHealthy,
    openManualDownload: () => state.manualDownloadUrl ? options.openExternal?.(state.manualDownloadUrl) : false,
    openReleaseNotes: () => state.releaseNotesUrl ? options.openExternal?.(state.releaseNotesUrl) : false,
    setPreferences,
    start,
    stop,
  }
}

module.exports = {
  createAppUpdater,
  fetchBoundedText,
  loadPreferences,
  publicError,
}
