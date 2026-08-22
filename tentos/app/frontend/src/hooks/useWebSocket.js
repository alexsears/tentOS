import { useState, useEffect, useCallback } from 'react'
import { getWsUrl } from '../utils/api'

/**
 * One socket per page, shared by every hook that wants it.
 *
 * Each call used to open its own connection, so the dashboard held two and the
 * chat page three, the server broadcast every state change to all of them, and
 * the count climbed as pages were revisited. The connection now lives at module
 * scope, reference counted, with a short grace period so moving between routes
 * does not tear it down and immediately rebuild it.
 */

const CLOSE_GRACE_MS = 2000
const RECONNECT_MS = 5000

const sockets = new Map() // url -> shared connection record

function getRecord(url) {
  let record = sockets.get(url)
  if (!record) {
    record = {
      ws: null,
      subscribers: new Set(),
      readyState: WebSocket.CONNECTING,
      reconnectTimer: null,
      closeTimer: null,
    }
    sockets.set(url, record)
  }
  return record
}

function setReadyState(record, state) {
  record.readyState = state
  record.subscribers.forEach(sub => sub.onReadyState(state))
}

function connect(url) {
  const record = getRecord(url)
  if (record.ws && (record.ws.readyState === WebSocket.OPEN || record.ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  try {
    const wsUrl = getWsUrl(url)
    console.log('WebSocket connecting to:', wsUrl)
    const ws = new WebSocket(wsUrl)
    record.ws = ws

    ws.onopen = () => {
      setReadyState(record, WebSocket.OPEN)
      console.log('WebSocket connected')
    }

    ws.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(event.data)
      } catch (e) {
        console.error('Failed to parse WebSocket message', e)
        return
      }
      record.subscribers.forEach(sub => sub.onMessage(data))
    }

    ws.onclose = () => {
      setReadyState(record, WebSocket.CLOSED)
      record.ws = null
      if (record.subscribers.size > 0) {
        console.log('WebSocket disconnected, reconnecting...')
        record.reconnectTimer = setTimeout(() => connect(url), RECONNECT_MS)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }
  } catch (e) {
    console.error('Failed to connect WebSocket:', e)
    record.reconnectTimer = setTimeout(() => connect(url), RECONNECT_MS)
  }
}

function release(url) {
  const record = sockets.get(url)
  if (!record || record.subscribers.size > 0) return

  // Route changes unmount the old page before the new one mounts, so wait
  // before tearing the connection down.
  record.closeTimer = setTimeout(() => {
    if (record.subscribers.size > 0) return
    if (record.reconnectTimer) clearTimeout(record.reconnectTimer)
    record.reconnectTimer = null
    if (record.ws) {
      record.ws.onclose = null // an intentional close should not reconnect
      record.ws.close()
      record.ws = null
    }
    sockets.delete(url)
  }, CLOSE_GRACE_MS)
}

export function useWebSocket(url) {
  const [lastMessage, setLastMessage] = useState(null)
  const [readyState, setReadyState] = useState(
    sockets.get(url)?.readyState ?? WebSocket.CONNECTING
  )

  useEffect(() => {
    const record = getRecord(url)
    const subscriber = { onMessage: setLastMessage, onReadyState: setReadyState }
    record.subscribers.add(subscriber)

    if (record.closeTimer) {
      clearTimeout(record.closeTimer)
      record.closeTimer = null
    }

    if (record.ws && record.ws.readyState === WebSocket.OPEN) {
      setReadyState(WebSocket.OPEN)
    } else {
      connect(url)
    }

    return () => {
      record.subscribers.delete(subscriber)
      release(url)
    }
  }, [url])

  const sendMessage = useCallback((message) => {
    const record = sockets.get(url)
    if (record?.ws && record.ws.readyState === WebSocket.OPEN) {
      record.ws.send(JSON.stringify(message))
    }
  }, [url])

  return { lastMessage, readyState, sendMessage }
}
