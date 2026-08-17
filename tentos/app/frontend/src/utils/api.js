/**
 * Get the base URL for API calls.
 * Works with HA ingress by detecting the ingress path pattern.
 */
function getBaseUrl() {
  const path = window.location.pathname

  // For HA ingress, extract just the base ingress path (not client-side routes)
  // Pattern: /api/hassio_ingress/{token}
  const ingressMatch = path.match(/^(\/api\/hassio_ingress\/[^/]+)/)
  if (ingressMatch) {
    console.log('[API] Ingress base detected:', ingressMatch[1])
    return ingressMatch[1]
  }

  // For local development or direct access, use empty string (relative to root)
  console.log('[API] No ingress detected, using relative URLs')
  return ''
}

const BASE_URL = getBaseUrl()

/**
 * Fetch wrapper that prepends the correct base URL.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = `${BASE_URL}/${endpoint.replace(/^\//, '')}`
  console.log('[API] Fetching:', url)
  const response = await fetch(url, options)
  if (!response.ok) {
    console.warn('[API] Response not OK:', response.status, response.statusText, 'for', url)
  }
  return response
}

/**
 * Convert an unsuccessful API response into an exception so callers do not
 * accidentally report success after a rejected request.
 */
export async function requireOk(response, fallbackMessage = 'Request failed') {
  if (response.ok) return response

  let message = fallbackMessage
  try {
    const data = await response.json()
    message = data.detail || data.message || message
  } catch {
    // Keep the user-facing fallback when the server does not return JSON.
  }

  throw new Error(message)
}

/**
 * Get the WebSocket URL for the API.
 */
export function getWsUrl(endpoint) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = `${BASE_URL}/${endpoint.replace(/^\//, '')}`
  return `${protocol}//${window.location.host}${path}`
}

/**
 * Get the base URL for API calls (for constructing image/stream URLs).
 */
export function getApiBase() {
  return BASE_URL
}

export { BASE_URL }
