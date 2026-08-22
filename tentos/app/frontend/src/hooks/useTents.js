import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'
import { apiFetch } from '../utils/api'

// The app shell preloads tents on boot. Handing that result to the first hook
// that asks avoids fetching the same list twice on every dashboard load.
let preloadedTents = null
let preloadedAt = 0
const PRELOAD_MAX_AGE_MS = 5000

export function seedTents(tents) {
  preloadedTents = tents
  preloadedAt = Date.now()
}

export function useTents() {
  const fresh = preloadedTents && (Date.now() - preloadedAt) < PRELOAD_MAX_AGE_MS
  const [tents, setTents] = useState(fresh ? preloadedTents : [])
  const [loading, setLoading] = useState(!fresh)
  const [error, setError] = useState(null)
  const [pending, setPending] = useState({}) // Track pending actions
  const { lastMessage, readyState } = useWebSocket('api/ws')

  const fetchTents = useCallback(async () => {
    try {
      const response = await apiFetch('api/tents')
      if (!response.ok) throw new Error('Failed to fetch tents')
      const data = await response.json()
      setTents(data.tents || [])
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // A fresh preload already provided the list; the socket keeps it current
    if (preloadedTents && (Date.now() - preloadedAt) < PRELOAD_MAX_AGE_MS) {
      setTents(preloadedTents)
      setLoading(false)
      return
    }
    fetchTents()
  }, [fetchTents])

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
    refetch: fetchTents,
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
