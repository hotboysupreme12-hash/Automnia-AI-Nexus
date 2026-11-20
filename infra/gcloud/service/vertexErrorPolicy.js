/** Map Vertex failures without presenting service credentials as client credentials. */
export function classifyVertexError(status) {
  if (status === 429) return { status: 429, retryable: true, type: 'rate_limit_error', message: 'Automnia Cloud hosted models are temporarily busy. Retry shortly.' };
  if (status === 401 || status === 403) return { status: 424, retryable: false, type: 'api_error', message: 'Automnia Cloud cannot access the upstream model. Check the service billing account, region, and model permissions.' };
  if (status === 404) return { status: 424, retryable: false, type: 'api_error', message: 'The configured upstream model is unavailable. Check the model and service region.' };
  if (status === 400 || status === 413 || status === 422) return { status: 400, retryable: false, type: 'invalid_request_error', message: 'The upstream model rejected the request. Check the conversation and tool configuration.' };
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return { status: 424, retryable: false, type: 'api_error', message: 'Automnia Cloud could not use the upstream model. Check the service configuration.' };
  return { status: 502, retryable: [408, 409, 500, 502, 503, 504].includes(status), type: 'api_error', message: 'Automnia Cloud provider request failed.' };
}
