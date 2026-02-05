import { useState, useEffect, useCallback, useRef } from 'react'
import { useWebSocket } from './useWebSocket'
import { apiFetch } from '../utils/api'

// Generate or retrieve session ID
function getSessionId() {
  let sessionId = localStorage.getItem('chat_session_id')
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10) +
                Math.random().toString(36).substring(2, 6)
    localStorage.setItem('chat_session_id', sessionId)
  }
  return sessionId
}

export function useChat() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [sending, setSending] = useState(false)
  const { lastMessage, sendMessage, readyState } = useWebSocket('api/ws')
  const sessionId = useRef(getSessionId())

  // Load initial messages
  const fetchMessages = useCallback(async (before = null) => {
    try {
      const url = before
        ? `api/chat/messages?before=${before}&limit=50`
        : 'api/chat/messages?limit=50'
      const response = await apiFetch(url)
      if (!response.ok) throw new Error('Failed to fetch messages')
      const data = await response.json()

      if (before) {
        setMessages(prev => [...data.messages, ...prev])
      } else {
        setMessages(data.messages || [])
      }
      setHasMore(data.has_more)
    } catch (e) {
      console.error('Failed to fetch chat messages:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load user profile
  const fetchUser = useCallback(async () => {
    try {
      const response = await apiFetch(`api/chat/user?session_id=${sessionId.current}`)
      if (!response.ok) throw new Error('Failed to fetch user')
      const data = await response.json()
      setUser(data)
    } catch (e) {
      console.error('Failed to fetch user:', e)
    }
  }, [])

  useEffect(() => {
    fetchMessages()
    fetchUser()
  }, [fetchMessages, fetchUser])

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (!lastMessage) return

    if (lastMessage.type === 'chat_new_message') {
      setMessages(prev => [...prev, lastMessage.message])
    } else if (lastMessage.type === 'chat_error') {
      console.error('Chat error:', lastMessage.error)
    }
  }, [lastMessage])

  // Send message via WebSocket for real-time
  const send = useCallback(async (content) => {
    if (!content.trim() || sending) return

    setSending(true)
    try {
      // Send via WebSocket for real-time broadcast
      sendMessage({
        type: 'chat_message',
        content: content.trim(),
        session_id: sessionId.current
      })
    } catch (e) {
      console.error('Failed to send message:', e)
    } finally {
      setSending(false)
    }
  }, [sendMessage, sending])

  // Send message via REST (fallback)
  const sendRest = useCallback(async (content) => {
    if (!content.trim() || sending) return

    setSending(true)
    try {
      const response = await apiFetch('api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          session_id: sessionId.current
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to send')
      }

      const message = await response.json()
      // Add to local state (it will also come via WebSocket)
      setMessages(prev => {
        // Avoid duplicate if WS already added it
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    } catch (e) {
      console.error('Failed to send message:', e)
      throw e
    } finally {
      setSending(false)
    }
  }, [sending])

  // Set nickname
  const setNickname = useCallback(async (nickname) => {
    try {
      const response = await apiFetch(`api/chat/user/nickname?session_id=${sessionId.current}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.detail || 'Failed to update nickname')
      }

      await fetchUser()
    } catch (e) {
      console.error('Failed to set nickname:', e)
      throw e
    }
  }, [fetchUser])

  // Load more (older messages)
  const loadMore = useCallback(() => {
    if (messages.length > 0 && hasMore && !loading) {
      fetchMessages(messages[0].id)
    }
  }, [messages, hasMore, loading, fetchMessages])

  // Refetch messages
  const refetch = useCallback(() => {
    setLoading(true)
    fetchMessages()
  }, [fetchMessages])

  return {
    messages,
    loading,
    user,
    send,
    sendRest,
    setNickname,
    loadMore,
    hasMore,
    refetch,
    sending,
    sessionId: sessionId.current,
    connected: readyState === WebSocket.OPEN
  }
}
