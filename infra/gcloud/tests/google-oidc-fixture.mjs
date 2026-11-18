import http from 'node:http';
import { createRequire } from 'node:module';

// Keep the actual google-auth-library JWT verifier, replacing only its network
// certificate fetch with the public half of an ephemeral test key.
const require = createRequire(new URL('../service/package.json', import.meta.url));
const { OAuth2Client } = require('google-auth-library');
OAuth2Client.prototype.getFederatedSignonCertsAsync = async () => ({
  certs: { 'isolated-test-key': process.env.AUTOMNIA_TEST_PUBLIC_KEY },
  format: 'PEM',
});

// The archived server normally listens on all interfaces. Restrict this test
// process to an OS-selected loopback port without changing production code.
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  const callback = typeof args.at(-1) === 'function' ? args.at(-1) : undefined;
  return originalListen.call(this, { host: '127.0.0.1', port: 0 }, function () {
    process.stdout.write(`TEST_BOUND_PORT=${this.address().port}\n`);
    if (callback) callback.call(this);
  });
};
