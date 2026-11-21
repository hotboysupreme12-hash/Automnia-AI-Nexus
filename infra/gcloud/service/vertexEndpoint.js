/** Return the documented Vertex API host for a location. */
export function vertexApiHost(location) {
  if (location === 'global') return 'aiplatform.googleapis.com';
  if (location === 'us' || location === 'eu') return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}
