import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'
import { apiFetch } from '../utils/api'

// The app shell and the dashboard both want the tent list on boot, and they ask
// at the same moment, so seeding one from the other's response still left two
// requests in flight. Callers now share the request itself: whoever asks first
// starts it, everyone else awaits the same promise, and the result is reusable
// for a moment afterwards.
let preloadedTents = null
let preloadedAt = 0
let inFlight = null
const PRELOAD_MAX_AGE_MS = 5000

export function seedTents(tents) {
  preloadedTents = tents
  preloadedAt = Date.now()
}

export async function fetchTentsShared() {
  if (preloadedTents && (Date.now() - preloadedAt) < PRELOAD_MAX_AGE_MS) {
    return preloadedTents
  }
  if (inFlight) return inFlight

  inFlight = apiFetch('api/tents')
    .then(async response => {
      if (!response.ok) throw new Error('Failed to fetch tents')
      const data = await response.json()
      seedTents(data.tents || [])
      return preloadedTents
    })
    .finally(() => { inFlight = null })

  return inFlight
}

export function useTents() {
  const fresh = preloadedTents && (Date.now() - preloadedAt) < PRELOAD_MAX_AGE_MS
  const [tents, setTents] = useState(fresh ? preloadedTents : [])
  const [loading, setLoading] = useState(!fresh)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState({}) // Track pending actions
  const [haConnected, setHaConnected] = useState(null)
  const { lastMessage, readyState } = useWebSocket('api/ws')

  const fetchTents = useCallback(async (force = false) => {
    try {
      if (force) {
        preloadedTents = null
        preloadedAt = 0
      }
      const list = await fetchTentsShared()
      setTents(list || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTents()
  }, [fetchTents])

  useEffect(() => {
    let cancelled = false
    const checkHealth = () => {
      if (document.visibilityState !== 'visible') return
      apiFetch('api/health')
        .then(response => response.json())
        .then(data => { if (!cancelled) setHaConnected(Boolean(data.ha_connected)) })
        .catch(() => { if (!cancelled) setHaConnected(false) })
    }
    checkHealth()
    const interval = setInterval(checkHealth, 30000)
    document.addEventListener('visibilitychange', checkHealth)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', checkHealth)
    }
  }, [])

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'initial_state') {
      // Full state from WebSocket connection
      setTents(lastMessage.tents || [])
      setLoading(false)
    } else if (lastMessage.type === 'tent_update') {
      // Single tent update
      setTents(prev => prev.map(tent =>
        tent.id === lastMessage.tent_id ? lastMessage.data : tent
      ))
      // Clear pending state for this tent's actuators
      setPending(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(key => {
          if (key.startsWith(lastMessage.tent_id)) delete next[key]
        })
        return next
      })
    }
  }, [lastMessage])

  const performAction = useCallback(async (tentId, action, params = {}) => {
    try {
      const response = await apiFetch(`api/tents/${tentId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params })
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Action failed')
      }
      return await response.json()
    } catch (e) {
      throw e
    }
  }, [])

  const toggleActuator = useCallback(async (tentId, slot) => {
    const key = `${tentId}.${slot}`
    setPending(prev => ({ ...prev, [key]: true }))

    try {
      const response = await apiFetch(`api/tents/${tentId}/actuators/${slot}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Toggle failed')
      }
      return await response.json()
    } catch (e) {
      setPending(prev => ({ ...prev, [key]: false }))
      throw e
    }
  }, [])

  const isPending = useCallback((tentId, slot) => {
    return !!pending[`${tentId}.${slot}`]
  }, [pending])

  const updateControlSettings = useCallback(async (tentId, controlSettings) => {
    try {
      const response = await apiFetch(`api/tents/${tentId}/control-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(controlSettings)
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to update control settings')
      }
      // Update local state
      setTents(prev => prev.map(tent =>
        tent.id === tentId
          ? { ...tent, control_settings: controlSettings }
          : tent
      ))
      return await response.json()
    } catch (e) {
      throw e
    }
  }, [])

  return {
    tents,
    loading,
    error,
    connected: readyState === WebSocket.OPEN,
    haConnected,
    refetch: () => fetchTents(true),
    performAction,
    toggleActuator,
    isPending,
    updateControlSettings
  }
}

export function useTent(tentId) {
  const [tent, setTent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { lastMessage } = useWebSocket('api/ws')

  const fetchTent = useCallback(async () => {
    if (!tentId) return
    try {
      const response = await apiFetch(`api/tents/${tentId}`)
      if (!response.ok) throw new Error('Failed to fetch tent')
      const data = await response.json()
      setTent(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [tentId])

  useEffect(() => {
    fetchTent()
  }, [fetchTent])

  useEffect(() => {
    if (lastMessage?.type === 'tent_update' && lastMessage.tent_id === tentId) {
      setTent(lastMessage.data)
    }
  }, [lastMessage, tentId])

  return { tent, loading, error, refetch: fetchTent }
}
