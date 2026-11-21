import test from 'node:test';
import assert from 'node:assert/strict';
import { transientVertexEligibilityFailure, vertexHostForLocation } from '../infra/gcloud/service/vertexRequestRouting.js';

test('uses Google API hosts for global, multi-region, and regional locations', () => {
  assert.equal(vertexHostForLocation('global'), 'aiplatform.googleapis.com');
  assert.equal(vertexHostForLocation('us'), 'aiplatform.us.rep.googleapis.com');
  assert.equal(vertexHostForLocation('eu'), 'aiplatform.eu.rep.googleapis.com');
  assert.equal(vertexHostForLocation('us-central1'), 'us-central1-aiplatform.googleapis.com');
});

test('limits eligibility retries to the observed provider error', () => {
  const message = 'Access requires an eligible paid billing account in a supported region, subject to our terms and policies.';
  assert.equal(transientVertexEligibilityFailure(403, message), true);
  assert.equal(transientVertexEligibilityFailure(403, 'The caller lacks permission.'), false);
  assert.equal(transientVertexEligibilityFailure(401, message), false);
  assert.equal(transientVertexEligibilityFailure(403, ''), false);
});
