import { useState, useEffect, useCallback, useRef } from 'react'

export function useWebSocket(url) {
  const [lastMessage, setLastMessage] = useState(null)
  const [readyState, setReadyState] = useState(WebSocket.CONNECTING)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)

  const connect = useCallback(() => {
    try {
      // Build WebSocket URL relative to current page (works with ingress)
      const wsUrl = new URL(url.replace(/^\//, ''), window.location.href)
      wsUrl.protocol = wsUrl.protocol.replace('http', 'ws')

      wsRef.current = new WebSocket(wsUrl.href)

      wsRef.current.onopen = () => {
        setReadyState(WebSocket.OPEN)
        console.log('WebSocket connected')
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          setLastMessage(data)
        } catch (e) {
          console.error('Failed to parse WebSocket message', e)
        }
      }

      wsRef.current.onclose = () => {
        setReadyState(WebSocket.CLOSED)
        console.log('WebSocket disconnected, reconnecting...')
        reconnectTimeoutRef.current = setTimeout(connect, 5000)
      }

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
    } catch (e) {
      console.error('Failed to connect WebSocket:', e)
      reconnectTimeoutRef.current = setTimeout(connect, 5000)
    }
  }, [url])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  const sendMessage = useCallback((message) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  return { lastMessage, readyState, sendMessage }
}
