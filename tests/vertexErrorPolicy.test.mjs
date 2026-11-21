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
  assert.match(classifyVertexError(403).message, /Google Cloud project, Cloud Run service identity, model access, region/);
  assert.equal(classifyVertexError(403).code, 'hosted_model_access_denied');
});

test('Google hosted-runtime access denial remains fast and does not blame the user billing account', () => {
  const result = classifyVertexError(403, 'Access requires an eligible paid billing account in a supported region, subject to our terms and policies.');
  assert.equal(result.status, 403);
  assert.equal(result.retryable, false);
  assert.equal(result.code, 'hosted_model_access_denied');
  assert.match(result.message, /model can be available to your Google Cloud account/);
  assert.doesNotMatch(result.message, /check the project billing account/);
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
