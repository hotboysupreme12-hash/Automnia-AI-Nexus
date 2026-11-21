import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { vertexApiHost } from '../service/vertexEndpoint.js';

test('Vertex endpoint hostnames follow Google global, multi-region, and regional routing', () => {
  assert.equal(vertexApiHost('global'), 'aiplatform.googleapis.com');
  assert.equal(vertexApiHost('us'), 'aiplatform.us.rep.googleapis.com');
  assert.equal(vertexApiHost('eu'), 'aiplatform.eu.rep.googleapis.com');
  assert.equal(vertexApiHost('europe-west2'), 'europe-west2-aiplatform.googleapis.com');
  assert.equal(vertexApiHost('asia-southeast1'), 'asia-southeast1-aiplatform.googleapis.com');
});

test('Cloud Run image copies the relay modules required at startup', async () => {
  const dockerfile = await readFile(new URL('../service/Dockerfile', import.meta.url), 'utf8');
  for (const moduleName of ['vertexEndpoint.js', 'vertexStream.js', 'openAiStream.js']) {
    assert.match(dockerfile, new RegExp(`^COPY .*\\b${moduleName.replace('.', '\\.')}\\b`, 'm'));
  }
});
