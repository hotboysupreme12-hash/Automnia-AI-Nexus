import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { AUTOMNIA_PUBLIC_CLOUD_URL, automniaCloudBaseUrl, automniaCloudRuntimeBaseUrl } from '../../config/automniaCloud'
import type { LicenseService } from '../license/licenseService'

const scryptAsync = promisify(scrypt)
const PASSWORD_HASH_VERSION = 'scrypt-v1'
const PASSWORD_KEY_LENGTH = 64
const PASSWORD_MIN_LENGTH = 12
const PASSWORD_MAX_LENGTH = 128
const ACCOUNT_REQUEST_TIMEOUT_MS = 12_000

export type LocalAccountIdentity = {
  accountId: string | null
  email: string
  passwordHash: string | null
  passwordSet: boolean
  googleSubject: string | null
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}

export type AccountAuthErrorCode =
  | 'account_activation_failed'
  | 'account_exists'
  | 'account_service_unavailable'
  | 'account_setup_required'
  | 'invalid_credentials'
  | 'password_invalid'

export class AccountAuthError extends Error {
  public readonly code: AccountAuthErrorCode

  constructor(code: AccountAuthErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export type AccountAuthServiceOptions = {
  read: <T>(stateKey: string) => T | null
  write: (stateKey: string, value: unknown) => boolean
  licenseService: LicenseService
  /** Reconcile the active license and hosted Gateway route after account auth. */
  reconcileAccountAccess?: () => Promise<void>
  apiUrl?: string
  fetch?: typeof fetch
  now?: () => Date
}

export type AccountAuthResult = {
  account: {
    accountId: string | null
    email: string
    hasPassword: boolean
    googleLinked: boolean
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function validEmail(value: string) {
  return value.length >= 3 && value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function validateAccountPassword(value: string) {
  if (value.length < PASSWORD_MIN_LENGTH || value.length > PASSWORD_MAX_LENGTH) {
    throw new AccountAuthError(
      'password_invalid',
      `Choose a password between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    )
  }
  return value
}

function accountPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  if (record.ok === true && record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>
  }
  return record
}

function accountResult(payload: Record<string, unknown>) {
  const account = payload.account && typeof payload.account === 'object' && !Array.isArray(payload.account)
    ? payload.account as Record<string, unknown>
    : payload
  return {
    accountId: typeof account.accountId === 'string' ? account.accountId : null,
    email: typeof account.email === 'string' ? normalizeEmail(account.email) : null,
    hasPassword: account.hasPassword === true,
    googleSubject: typeof account.googleSubject === 'string' ? account.googleSubject : null,
    licenseKey: typeof payload.licenseKey === 'string' ? payload.licenseKey : null,
    license: payload.license && typeof payload.license === 'object' && !Array.isArray(payload.license)
      ? payload.license as Record<string, unknown>
      : payload,
  }
}

function normalizeIdentity(value: unknown): LocalAccountIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const email = typeof record.email === 'string' ? normalizeEmail(record.email) : ''
  if (!validEmail(email)) return null
  return {
    accountId: typeof record.accountId === 'string' ? record.accountId : null,
    email,
    passwordHash: typeof record.passwordHash === 'string' ? record.passwordHash : null,
    passwordSet: typeof record.passwordSet === 'boolean' ? record.passwordSet : typeof record.passwordHash === 'string',
    googleSubject: typeof record.googleSubject === 'string' ? record.googleSubject : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
    lastLoginAt: typeof record.lastLoginAt === 'string' ? record.lastLoginAt : null,
  }
}

async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer
  return `${PASSWORD_HASH_VERSION}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

async function verifyPassword(password: string, encoded: string) {
  const [version, saltText, hashText] = encoded.split('$')
  if (version !== PASSWORD_HASH_VERSION || !saltText || !hashText) return false
  try {
    const salt = Buffer.from(saltText, 'base64url')
    const expected = Buffer.from(hashText, 'base64url')
    if (expected.length !== PASSWORD_KEY_LENGTH) return false
    const actual = await scryptAsync(password, salt, PASSWORD_KEY_LENGTH) as Buffer
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

export function createAccountAuthService(options: AccountAuthServiceOptions) {
  const stateKey = 'account:identity'
  const configuredApiUrl = options.apiUrl || process.env.AUTOMNIA_LICENSE_API_URL
  const apiBaseUrl = configuredApiUrl
    ? automniaCloudBaseUrl(configuredApiUrl)
    : automniaCloudRuntimeBaseUrl(AUTOMNIA_PUBLIC_CLOUD_URL)
  const request = options.fetch || globalThis.fetch
  const now = () => (options.now ? options.now() : new Date()).toISOString()
  const current = () => normalizeIdentity(options.read<LocalAccountIdentity>(stateKey))
  // Kept only for the lifetime of this process. This is a recovery proof for
  // first-password setup when an older Cloud Run revision returns the linked
  // Google account without its subject identifier; it is never written to the
  // local ledger or exposed to the renderer.
  let lastGoogleAccessToken: string | null = null

  const publicAccount = (identity: LocalAccountIdentity): AccountAuthResult => ({
    account: {
      accountId: identity.accountId,
      email: identity.email,
      hasPassword: identity.passwordSet,
      googleLinked: Boolean(identity.googleSubject || lastGoogleAccessToken),
    },
  })

  const saveIdentity = (identity: LocalAccountIdentity) => {
    if (!options.write(stateKey, identity)) {
      throw new AccountAuthError('account_service_unavailable', 'The local account could not be saved securely.')
    }
    return publicAccount(identity)
  }

  // Account auth can replace the canonical license key and entitlement on a
  // device. Reconcile after the local identity is durable, but keep sign-in
  // successful if the network is briefly unavailable; the next agent turn
  // has its own billing-route recovery barrier.
  const reconcileAccountAccess = async () => {
    try {
      await options.reconcileAccountAccess?.()
    } catch {
      // The authenticated account and canonical license are already saved.
    }
  }

  const remoteRequest = async (path: string, body: Record<string, unknown>) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ACCOUNT_REQUEST_TIMEOUT_MS)
    try {
      const response = await request(`${apiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => null)
      const record = accountPayload(payload)
      if (!response.ok || record.ok === false) {
        const message = typeof record.error === 'string'
          ? record.error
          : typeof record.message === 'string' ? record.message : 'Automnia account service rejected the request.'
        if (response.status === 404 && path.includes('/setup')) {
          throw new AccountAuthError('account_activation_failed', message)
        }
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          throw new AccountAuthError('invalid_credentials', message)
        }
        if (response.status === 409) {
          throw new AccountAuthError(path.includes('/login') ? 'account_setup_required' : 'account_exists', message)
        }
        throw new AccountAuthError(
          isRetryableStatus(response.status) ? 'account_service_unavailable' : 'account_activation_failed',
          message,
        )
      }
      return record
    } catch (error) {
      if (error instanceof AccountAuthError) throw error
      throw new AccountAuthError(
        'account_service_unavailable',
        error instanceof Error && error.name === 'AbortError'
          ? 'Automnia account service did not respond in time. Check your connection and try again.'
          : 'Unable to reach the Automnia account service. Check your connection and try again.',
      )
    } finally {
      clearTimeout(timer)
    }
  }

  const adoptRemoteAccount = async (payload: Record<string, unknown>, passwordHash: string | null, previous?: LocalAccountIdentity | null) => {
    const remote = accountResult(payload)
    if (!remote.email) throw new AccountAuthError('account_activation_failed', 'The account service returned an invalid account.')
    if (!remote.licenseKey) {
      throw new AccountAuthError(
        'account_activation_failed',
        'The Automnia account was found, but its license key was not returned. Contact Automnia support before signing in again.',
      )
    }
    const identity: LocalAccountIdentity = {
      accountId: remote.accountId || previous?.accountId || null,
      email: remote.email,
      passwordHash,
      passwordSet: remote.hasPassword || Boolean(passwordHash),
      googleSubject: remote.googleSubject || previous?.googleSubject || null,
      createdAt: previous?.createdAt || now(),
      updatedAt: now(),
      lastLoginAt: now(),
    }
    options.licenseService.adoptRemoteAccount(remote.license, remote.licenseKey)
    const result = saveIdentity(identity)
    await reconcileAccountAccess()
    return result
  }

  const setup = async ({ email: inputEmail, licenseKey, password }: { email: string; licenseKey: string; password: string }) => {
    const email = normalizeEmail(inputEmail)
    if (!validEmail(email)) throw new AccountAuthError('account_activation_failed', 'Enter a valid account email address.')
    validateAccountPassword(password)
    if (!licenseKey.trim()) throw new AccountAuthError('account_activation_failed', 'Enter the Automnia license key from your order to link this account.')
    const existing = current()
    if (existing?.passwordSet) throw new AccountAuthError('account_exists', 'This device already has an Automnia account. Sign in or log out first.')
    const payload = await remoteRequest('/api/account/setup', { email, licenseKey: licenseKey.trim(), password })
    return adoptRemoteAccount(payload, await hashPassword(password), existing)
  }

  const login = async ({ email: inputEmail, password }: { email: string; password: string }) => {
    const email = normalizeEmail(inputEmail)
    if (!validEmail(email)) throw new AccountAuthError('invalid_credentials', 'Enter the email used for your Automnia order.')
    validateAccountPassword(password)
    const existing = current()
    if (existing?.email === email && existing.passwordHash) {
      if (!(await verifyPassword(password, existing.passwordHash))) {
        // A password may have been changed on another device. Reconcile a
        // stale local verifier with the account service before rejecting it.
        // If the service is offline, keep the normal generic credentials error
        // so an offline BYOK account does not turn a typo into a network error.
        try {
          const payload = await remoteRequest('/api/account/login', { email, password })
          return adoptRemoteAccount(payload, await hashPassword(password), existing)
        } catch (error) {
          if (error instanceof AccountAuthError && error.code === 'account_service_unavailable') {
            throw new AccountAuthError('invalid_credentials', 'The email or password is incorrect.')
          }
          throw error
        }
      }
      const cachedLicense = options.licenseService.getStatus()
      if (cachedLicense.active && !cachedLicense.permanentAccess) {
        try {
          const payload = await remoteRequest('/api/account/login', { email, password })
          return adoptRemoteAccount(payload, existing.passwordHash, existing)
        } catch (error) {
          if (error instanceof AccountAuthError && error.code === 'invalid_credentials') throw error
          throw new AccountAuthError('account_service_unavailable', 'This legacy subscription must verify online before sign-in can continue.')
        }
      }
      const identity = { ...existing, passwordSet: true, updatedAt: now(), lastLoginAt: now() }
      const result = saveIdentity(identity)
      await reconcileAccountAccess()
      return result
    }
    const payload = await remoteRequest('/api/account/login', { email, password })
    return adoptRemoteAccount(payload, await hashPassword(password), existing?.email === email ? existing : null)
  }

  const loginWithGoogle = async (accessToken: string) => {
    if (!accessToken.trim()) throw new AccountAuthError('invalid_credentials', 'Google sign-in did not return an account token.')
    const normalizedAccessToken = accessToken.trim()
    const payload = await remoteRequest('/api/account/google', { accessToken: normalizedAccessToken })
    // Google has just authenticated this session. Do not reuse a stale local
    // password verifier from another device; the remote account's password
    // flag is authoritative after OAuth sign-in.
    lastGoogleAccessToken = normalizedAccessToken
    return adoptRemoteAccount(payload, null, current())
  }

  const changePassword = async ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) => {
    const identity = current()
    if (!identity) throw new AccountAuthError('invalid_credentials', 'Sign in before changing your password.')
    if (!identity.passwordSet) {
      throw new AccountAuthError('account_setup_required', 'This account does not have a password yet. Use Create an account password instead.')
    }
    if (identity.passwordHash && !(await verifyPassword(currentPassword, identity.passwordHash))) {
      throw new AccountAuthError('invalid_credentials', 'The current password is incorrect.')
    }
    validateAccountPassword(newPassword)
    await remoteRequest('/api/account/password/change', {
      email: identity.email,
      currentPassword,
      newPassword,
    })
    const result = saveIdentity({ ...identity, passwordHash: await hashPassword(newPassword), passwordSet: true, updatedAt: now() })
    lastGoogleAccessToken = null
    return result
  }

  const setPassword = async ({ newPassword }: { newPassword: string }) => {
    const identity = current()
    if (!identity) throw new AccountAuthError('invalid_credentials', 'Sign in before creating an account password.')
    if (identity.passwordSet) {
      throw new AccountAuthError('account_exists', 'This account already has a password. Enter it to change the password.')
    }
    if (!identity.googleSubject && !lastGoogleAccessToken) {
      throw new AccountAuthError('invalid_credentials', 'Sign in with Google before creating an Automnia password for this account.')
    }
    validateAccountPassword(newPassword)
    const payload = await remoteRequest('/api/account/password/set', {
      email: identity.email,
      ...(identity.googleSubject ? { googleSubject: identity.googleSubject } : {}),
      ...(!identity.googleSubject && lastGoogleAccessToken ? { googleAccessToken: lastGoogleAccessToken } : {}),
      newPassword,
    })
    const result = adoptRemoteAccount(payload, await hashPassword(newPassword), identity)
    lastGoogleAccessToken = null
    return result
  }

  return {
    getStatus: () => {
      const identity = current()
      return identity ? publicAccount(identity) : { account: null }
    },
    hasLocalAccount: () => Boolean(current()),
    setup,
    login,
    loginWithGoogle,
    changePassword,
    setPassword,
  }
}

export type AccountAuthService = ReturnType<typeof createAccountAuthService>
