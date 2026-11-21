/** Return the documented API host for the configured Vertex location. */
export function vertexHostForLocation(location) {
  if (location === 'global') return 'aiplatform.googleapis.com';
  if (location === 'us' || location === 'eu') return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}

/** This specific eligibility response has sometimes cleared on a short retry. */
export function transientVertexEligibilityFailure(status, body) {
  return status === 403 && /access requires an eligible paid billing account in a supported region/i.test(String(body || ''));
}
