/** Map Vertex failures without presenting service credentials as client credentials. */
export function classifyVertexError(status, upstreamMessage = '') {
  if (status === 429) return { status: 429, retryable: true, type: 'rate_limit_error', message: 'Automnia Cloud hosted models are temporarily busy. Retry shortly.' };
  if (status === 403 && /access requires an eligible paid billing account in a supported region/i.test(String(upstreamMessage || ''))) {
    return {
      status: 403,
      retryable: false,
      type: 'api_error',
      code: 'hosted_model_access_denied',
      message: 'Google Cloud denied this generation request from Automnia’s hosted runtime. The model can be available to your Google Cloud account while the hosted project, service identity, region, or model eligibility differs. Check those request details; Automnia did not switch models or replay the turn.',
    };
  }
  if (status === 401 || status === 403) return { status: 424, retryable: false, type: 'api_error', code: 'hosted_model_access_denied', message: 'Automnia’s hosted runtime cannot access the requested Vertex model. Check the configured Google Cloud project, Cloud Run service identity, model access, region, and provider eligibility.' };
  if (status === 404) return { status: 424, retryable: false, type: 'api_error', message: 'The configured upstream model is unavailable. Check the model and service region.' };
  if (status === 400 || status === 413 || status === 422) return { status: 400, retryable: false, type: 'invalid_request_error', message: 'The upstream model rejected the request. Check the conversation and tool configuration.' };
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return { status: 424, retryable: false, type: 'api_error', message: 'Automnia Cloud could not use the upstream model. Check the service configuration.' };
  return { status: 502, retryable: [408, 409, 500, 502, 503, 504].includes(status), type: 'api_error', message: 'Automnia Cloud provider request failed.' };
}
