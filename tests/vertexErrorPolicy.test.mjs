import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyVertexError } from '../infra/gcloud/service/vertexErrorPolicy.js';

test('upstream access and model configuration failures do not look transient', () => {
  for (const upstream of [401, 403, 404]) {
    const result = classifyVertexError(upstream);
    assert.equal(result.status, 424);
    assert.equal(result.retryable, false);
    assert.equal(result.type, 'api_error');
  }
  assert.match(classifyVertexError(403).message, /billing account, region, and model permissions/);
});

test('request rejection and transient failures remain distinct', () => {
  for (const upstream of [400, 413, 422]) {
    assert.equal(classifyVertexError(upstream).status, 400);
    assert.equal(classifyVertexError(upstream).retryable, false);
  }
  assert.equal(classifyVertexError(429).status, 429);
  for (const upstream of [408, 409, 429, 500, 502, 503, 504]) {
    assert.equal(classifyVertexError(upstream).retryable, true);
  }
  assert.equal(classifyVertexError(503).status, 502);
});
