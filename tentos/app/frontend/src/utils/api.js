/**
 * Get the base URL for API calls.
 * Works with HA ingress by detecting the current path.
 */
function getBaseUrl() {
  // Get the path where index.html is served from
  const path = window.location.pathname
  // Remove trailing index.html or slash
  const base = path.replace(/\/index\.html$/, '').replace(/\/$/, '')
  return base
}

const BASE_URL = getBaseUrl()

/**
 * Fetch wrapper that prepends the correct base URL.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = `${BASE_URL}/${endpoint.replace(/^\//, '')}`
  const response = await fetch(url, options)
  return response
}

/**
 * Get the WebSocket URL for the API.
 */
export function getWsUrl(endpoint) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = `${BASE_URL}/${endpoint.replace(/^\//, '')}`
  return `${protocol}//${window.location.host}${path}`
}

export { BASE_URL }
