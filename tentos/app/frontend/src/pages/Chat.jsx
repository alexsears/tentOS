import { useState, useRef, useEffect } from 'react'
import { useChat } from '../hooks/useChat'

function formatTime(isoString) {
  const date = new Date(isoString)
  const now = new Date()
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24))

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (diffDays === 0) {
    return time
  } else if (diffDays === 1) {
    return `Yesterday ${time}`
  } else if (diffDays < 7) {
    return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`
  } else {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
  }
}

function ChatMessage({ message, isOwn }) {
  return (
    <div className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
          message.is_developer
            ? 'bg-gradient-to-br from-green-500 to-emerald-600'
            : 'bg-[#2d3a5c]'
        }`}
      >
        {message.display_name[0].toUpperCase()}
      </div>

      {/* Message bubble */}
      <div className={`flex-1 max-w-[80%] ${isOwn ? 'text-right' : ''}`}>
        <div className={`flex items-center gap-2 mb-1 ${isOwn ? 'justify-end' : ''}`}>
          <span className="font-medium text-sm">{message.display_name}</span>
          {message.is_developer && (
            <span className="px-1.5 py-0.5 text-xs bg-green-600 rounded text-white font-medium">
              DEV
            </span>
          )}
          <span className="text-xs text-gray-500">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div
          className={`inline-block px-3 py-2 rounded-lg text-left ${
            isOwn
              ? 'bg-green-900/40 text-white'
              : message.is_developer
                ? 'bg-green-900/20 border border-green-600/30 text-gray-200'
                : 'bg-[#1a1a2e] text-gray-300'
          }`}
        >
          <p className="break-words whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  )
}

export default function Chat() {
  const {
    messages,
    loading,
    user,
    send,
    setNickname,
    loadMore,
    hasMore,
    sending,
    sessionId,
    connected
  } = useChat()

  const [input, setInput] = useState('')
  const [editingNickname, setEditingNickname] = useState(false)
  const [nicknameInput, setNicknameInput] = useState('')
  const [nicknameError, setNicknameError] = useState('')
  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = (e) => {
    e.preventDefault()
    if (input.trim() && !sending) {
      send(input.trim())
      setInput('')
    }
  }

  const handleNicknameSave = async () => {
    const nick = nicknameInput.trim()
    if (!nick) {
      setNicknameError('Nickname cannot be empty')
      return
    }
    if (nick.length < 2) {
      setNicknameError('Nickname must be at least 2 characters')
      return
    }
    if (!/^[\w\s-]+$/.test(nick)) {
      setNicknameError('Letters, numbers, spaces, hyphens only')
      return
    }

    try {
      await setNickname(nick)
      setEditingNickname(false)
      setNicknameError('')
    } catch (e) {
      setNicknameError(e.message)
    }
  }

  const handleScroll = (e) => {
    // Load more when scrolled to top
    if (e.target.scrollTop === 0 && hasMore && !loading) {
      loadMore()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            Developer Chat
          </h2>
          <p className="text-sm text-gray-400">
            Feature requests, questions, and feedback
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-sm text-gray-400">
            {connected ? 'Connected' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto card p-4 space-y-4"
      >
        {hasMore && (
          <button
            onClick={loadMore}
            disabled={loading}
            className="w-full text-center text-sm text-gray-400 hover:text-white py-2 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load older messages'}
          </button>
        )}

        {loading && messages.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-4">💬</div>
            <p className="text-gray-400">No messages yet.</p>
            <p className="text-gray-500 text-sm">Be the first to say hello!</p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              message={msg}
              isOwn={msg.display_name === user?.display_name}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* User Info & Input */}
      <div className="mt-4 space-y-3">
        {/* Nickname display/edit */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-400">Posting as:</span>
          {editingNickname ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={nicknameInput}
                onChange={(e) => {
                  setNicknameInput(e.target.value)
                  setNicknameError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleNicknameSave()}
                placeholder="Enter nickname"
                maxLength={20}
                className="input px-2 py-1 text-sm w-36"
                autoFocus
              />
              <button
                onClick={handleNicknameSave}
                className="text-green-400 hover:text-green-300 text-sm"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditingNickname(false)
                  setNicknameError('')
                }}
                className="text-gray-400 hover:text-white text-sm"
              >
                Cancel
              </button>
              {nicknameError && (
                <span className="text-red-400 text-xs">{nicknameError}</span>
              )}
            </div>
          ) : (
            <>
              <span className="font-medium text-white">
                {user?.display_name || 'Loading...'}
              </span>
              <button
                onClick={() => {
                  setNicknameInput(user?.nickname || '')
                  setEditingNickname(true)
                }}
                className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded hover:bg-[#2d3a5c]"
              >
                Change name
              </button>
            </>
          )}
        </div>

        {/* Message input */}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={connected ? 'Type a message...' : 'Reconnecting...'}
            maxLength={500}
            className="input flex-1"
            disabled={!connected || sending}
          />
          <button
            type="submit"
            disabled={!connected || !input.trim() || sending}
            className="btn btn-primary px-6 disabled:opacity-50"
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>
        <p className="text-xs text-gray-500">
          Messages are public. Be respectful. Max 500 characters.
        </p>
      </div>
    </div>
  )
}
