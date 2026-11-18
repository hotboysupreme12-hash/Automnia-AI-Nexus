import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const audience = 'https://billing.example.invalid';
const principal = 'scheduler-test@example.invalid';
const serverPath = fileURLToPath(new URL('../service/server.js', import.meta.url));
const serviceDir = fileURLToPath(new URL('../service/', import.meta.url));
const fixturePath = new URL('./google-oidc-fixture.mjs', import.meta.url).href;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

function makeToken(overrides = {}, signer = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: 'isolated-test-key' };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: audience,
    email: principal,
    email_verified: true,
    sub: 'isolated-test-subject',
    iat: now - 10,
    exp: now + 600,
    ...overrides,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), signer).toString('base64url')}`;
}

async function startServer({ expectedPrincipal = principal, expectedAudience = audience, scriptPath = serverPath } = {}) {
  const env = {
    SystemRoot: process.env.SystemRoot,
    PATH: process.env.PATH,
    LOCAL_IN_MEMORY_LICENSES: 'true',
    MIGRATION_WRITE_MODE: 'active',
    PORT: '0',
    AUTOMNIA_TEST_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  };
  if (expectedPrincipal !== null) env.AUTOMNIA_BILLING_RETRY_SERVICE_ACCOUNT_EMAIL = expectedPrincipal;
  if (expectedAudience !== null) env.AUTOMNIA_BILLING_RETRY_AUDIENCE = expectedAudience;
  const child = spawn(process.execPath, ['--import', fixturePath, scriptPath], {
    cwd: serviceDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stderr.resume();
  const port = await new Promise((resolve, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('test server did not start')); }, 15000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`test server exited before startup: ${code}`)); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/TEST_BOUND_PORT=(\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
  return {
    async request(token) {
      const headers = { 'content-type': 'application/json' };
      if (token !== null) headers.authorization = `Bearer ${token}`;
      const response = await fetch(`http://127.0.0.1:${port}/admin/shopify/billing-retries`, {
        method: 'POST', headers, body: '{}',
      });
      return { status: response.status, body: await response.json() };
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exit = once(child, 'exit');
        child.kill();
        await exit;
      }
    },
  };
}

test('scheduler endpoint accepts only the configured verified Google identity', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  await t.test('accepts a valid signed token for the target principal and audience', async () => {
    const result = await server.request(makeToken());
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.billingAttempts.attempted, 0);
    assert.equal(result.body.billingRetries.attempted, 0);
  });

  const now = Math.floor(Date.now() / 1000);
  const rejected = [
    ['missing bearer token', null],
    ['malformed token', 'invalid-test-token'],
    ['different verified service account', makeToken({ email: 'other@project-1799c8b6-3a92-4bbb-85c.iam.gserviceaccount.com' })],
    ['unverified email', makeToken({ email_verified: false })],
    ['non-boolean email verification', makeToken({ email_verified: 'true' })],
    ['missing email verification', makeToken({ email_verified: undefined })],
    ['missing email', makeToken({ email: undefined })],
    ['different email casing', makeToken({ email: principal.toUpperCase() })],
    ['audience with a trailing slash', makeToken({ aud: `${audience}/` })],
    ['array audience', makeToken({ aud: [audience] })],
    ['missing audience', makeToken({ aud: undefined })],
    ['untrusted issuer', makeToken({ iss: 'https://untrusted.invalid' })],
    ['expired token', makeToken({ iat: now - 7200, exp: now - 3600 })],
    ['invalid signature', makeToken({}, wrongKey)],
  ];
  for (const [name, token] of rejected) {
    await t.test(`rejects ${name}`, async () => {
      const result = await server.request(token);
      assert.equal(result.status, 401);
      assert.equal(result.body.ok, false);
    });
  }
});

test('scheduler endpoint fails closed when expected identity is missing', async (t) => {
  const server = await startServer({ expectedPrincipal: null });
  t.after(() => server.stop());
  assert.equal((await server.request(makeToken())).status, 401);
});

test('scheduler endpoint fails closed when expected audience is blank', async (t) => {
  const server = await startServer({ expectedAudience: '   ' });
  t.after(() => server.stop());
  assert.equal((await server.request(makeToken())).status, 401);
});

test('scheduler endpoint fails closed when expected identity is blank', async (t) => {
  const server = await startServer({ expectedPrincipal: '   ' });
  t.after(() => server.stop());
  assert.equal((await server.request(makeToken())).status, 401);
});
