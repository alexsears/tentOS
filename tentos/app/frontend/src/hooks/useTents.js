import { useState, useEffect, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'

export function useTents() {
  const [tents, setTents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { lastMessage } = useWebSocket('/api/ws')

  const fetchTents = useCallback(async () => {
    try {
      const response = await fetch('/api/tents')
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
    fetchTents()
  }, [fetchTents])

  // Update tent when WebSocket message received
  useEffect(() => {
    if (lastMessage?.type === 'tent_update') {
      setTents(prev => prev.map(tent =>
        tent.id === lastMessage.tent_id ? lastMessage.data : tent
      ))
    }
  }, [lastMessage])

  const performAction = useCallback(async (tentId, action, params = {}) => {
    try {
      const response = await fetch(`/api/tents/${tentId}/actions`, {
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

  return { tents, loading, error, refetch: fetchTents, performAction }
}

export function useTent(tentId) {
  const [tent, setTent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { lastMessage } = useWebSocket('/api/ws')

  const fetchTent = useCallback(async () => {
    if (!tentId) return
    try {
      const response = await fetch(`/api/tents/${tentId}`)
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
