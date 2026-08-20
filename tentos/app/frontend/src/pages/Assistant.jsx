import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, requireOk } from '../utils/api'

const STARTER_PROMPT = 'Give me a concise, scan-friendly summary of the last 24 hours in the tents. Put each tent name on its own line, keep each detail short, and finish with an Attention needed section.'
const WELCOME_MESSAGE = 'I know your TentOS setup: configured tents, readings, history, equipment, alerts, and care events. Ask naturally, choose a shortcut, or tap the orb to talk.'
const SUGGESTIONS = [
  { label: '24-hour summary', prompt: STARTER_PROMPT },
  { label: 'Check alerts', prompt: 'Are there any active alerts or readings outside target?' },
  { label: 'Equipment changes', prompt: 'What changed with the lights and fans?' },
  { label: 'Add an entity', prompt: 'Help me add a Home Assistant entity to a tent.' },
]

function makeSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `tentos-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getSessionId() {
  const existing = localStorage.getItem('tentos_assistant_session')
  if (existing) return existing
  const created = makeSessionId()
  localStorage.setItem('tentos_assistant_session', created)
  return created
}

function pickRecordingType() {
  if (!window.MediaRecorder?.isTypeSupported) return ''
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ].find(type => MediaRecorder.isTypeSupported(type)) || ''
}

async function readError(response, fallback) {
  try {
    const data = await response.json()
    return data.detail || data.message || fallback
  } catch {
    return fallback
  }
}

function stripSpeechFormatting(text) {
  return text.replace(/\*\*/g, '').replace(/`/g, '')
}

function MicrophoneIcon({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="3" width="8" height="12" rx="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function FormattedLine({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${index}-${part}`}>{part.slice(2, -2)}</strong>
      : part
  ))
}

function MessageText({ text }) {
  const lines = text.split('\n')
  return (
    <div className="assistant-message-content">
      {lines.map((line, index) => {
        const trimmed = line.trim()
        if (!trimmed) return <span key={`space-${index}`} className="assistant-message-space" aria-hidden="true" />
        const next = (lines[index + 1] || '').trim()
        const isHeading = (trimmed.length <= 52 && trimmed.endsWith(':'))
          || (trimmed.length <= 42 && next.startsWith('Current:'))
        return (
          <p key={`${index}-${line}`} className={isHeading ? 'assistant-message-heading' : 'assistant-message-line'}>
            <FormattedLine text={line} />
          </p>
        )
      })}
    </div>
  )
}

function PendingAction({ action, sessionId, onResolved }) {
  const [state, setState] = useState('pending')
  const [error, setError] = useState('')

  const decide = async decision => {
    setState(decision === 'confirm' ? 'running' : 'cancelling')
    setError('')
    try {
      const response = await apiFetch(`api/assistant/actions/${action.token}/${decision}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (!response.ok) throw new Error(await readError(response, 'Action failed'))
      const data = await response.json()
      setState(decision === 'confirm' ? 'confirmed' : 'cancelled')
      onResolved?.(decision, data.message || action.summary)
    } catch (err) {
      setState('failed')
      setError(err.message || 'Action failed')
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,.7)]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">
            {state === 'confirmed'
              ? 'Completed'
              : state === 'cancelled'
                ? 'Cancelled'
                : state === 'failed'
                  ? 'Request again'
                  : 'Review before running'}
          </p>
          <p className="mt-1 text-sm text-gray-100">{action.summary}</p>
        </div>
      </div>
      {state === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => decide('confirm')} className="btn btn-sm btn-primary min-h-10">
            Confirm action
          </button>
          <button type="button" onClick={() => decide('cancel')} className="btn btn-sm bg-white/5 text-gray-300 hover:bg-white/10 min-h-10">
            Cancel
          </button>
        </div>
      )}
      {(state === 'running' || state === 'cancelling') && <p className="mt-2 text-xs text-amber-200">Working...</p>}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  )
}

export default function Assistant() {
  const [status, setStatus] = useState(null)
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      text: WELCOME_MESSAGE,
    },
  ])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState('idle')
  const [error, setError] = useState('')
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('tentos_assistant_sound') !== 'off')
  const [sessionId, setSessionId] = useState(getSessionId)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const stopTimerRef = useRef(null)
  const feedEndRef = useRef(null)
  const autoStartedRef = useRef(false)

  const busy = mode === 'thinking' || mode === 'transcribing'
  const orbLabel = useMemo(() => {
    if (mode === 'listening') return 'Listening — tap to stop'
    if (mode === 'transcribing') return 'Transcribing...'
    if (mode === 'thinking') return 'Reading the tents...'
    if (mode === 'speaking') return 'Speaking — tap to stop'
    return 'Tap the orb to talk'
  }, [mode])

  useEffect(() => {
    apiFetch('api/assistant/status')
      .then(requireOk)
      .then(response => response.json())
      .then(setStatus)
      .catch(err => setError(err.message || 'Assistant status is unavailable'))
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, mode])

  useEffect(() => () => {
    clearTimeout(stopTimerRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    window.speechSynthesis?.cancel()
  }, [])

  const speak = useCallback(text => {
    if (!soundOn || !text || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(stripSpeechFormatting(text))
    utterance.rate = 0.96
    utterance.pitch = 0.98
    utterance.onstart = () => setMode('speaking')
    utterance.onend = () => setMode('idle')
    utterance.onerror = () => setMode('idle')
    window.speechSynthesis.speak(utterance)
  }, [soundOn])

  const sendMessage = useCallback(async (rawText, options = {}) => {
    const text = rawText.trim()
    if (!text || busy || !status?.configured) return
    setError('')
    setInput('')
    setMode('thinking')
    setMessages(current => [...current, { id: makeSessionId(), role: 'user', text }])
    try {
      const response = await apiFetch('api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      })
      if (!response.ok) throw new Error(await readError(response, 'The assistant could not answer'))
      const data = await response.json()
      if (data.session_id && data.session_id !== sessionId) {
        setSessionId(data.session_id)
        localStorage.setItem('tentos_assistant_session', data.session_id)
      }
      setMessages(current => [...current, {
        id: makeSessionId(),
        role: 'assistant',
        text: data.reply,
        pendingActions: data.pending_actions || [],
      }])
      setMode('idle')
      if (options.speak !== false) speak(data.reply)
    } catch (err) {
      setError(err.message || 'The assistant could not answer')
      setMode('idle')
    }
  }, [busy, sessionId, speak, status?.configured])

  useEffect(() => {
    if (!status?.configured || autoStartedRef.current) return
    if (sessionStorage.getItem('tentos_assistant_24h_started') === '1') return
    autoStartedRef.current = true
    sessionStorage.setItem('tentos_assistant_24h_started', '1')
    sendMessage(STARTER_PROMPT, { speak: false })
  }, [sendMessage, status?.configured])

  const handleActionResolved = useCallback((decision, summary) => {
    if (decision !== 'confirm') return
    const text = `Done: ${summary}`
    setMessages(current => [...current, { id: makeSessionId(), role: 'assistant', text }])
    speak(text)
  }, [speak])

  const stopRecording = useCallback(() => {
    clearTimeout(stopTimerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const transcribeAndSend = useCallback(async (blob, mimeType) => {
    if (blob.size < 800) {
      setError('I did not hear enough audio. Tap the orb and try again.')
      setMode('idle')
      return
    }
    setMode('transcribing')
    try {
      const response = await apiFetch('api/assistant/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': mimeType || 'audio/webm' },
        body: blob,
      })
      if (!response.ok) throw new Error(await readError(response, 'I could not transcribe that'))
      const data = await response.json()
      setMode('idle')
      await sendMessage(data.text, { speak: true })
    } catch (err) {
      setError(err.message || 'I could not transcribe that')
      setMode('idle')
    }
  }, [sendMessage])

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError('Voice recording is not available here. Type your request below.')
      return
    }
    setError('')
    window.speechSynthesis?.cancel()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      streamRef.current = stream
      chunksRef.current = []
      const mimeType = pickRecordingType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      recorder.ondataavailable = event => {
        if (event.data?.size) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop())
        setError('The microphone stopped unexpectedly. Type your request below.')
        setMode('idle')
      }
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop())
        streamRef.current = null
        const type = recorder.mimeType || mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        transcribeAndSend(blob, type.split(';')[0])
      }
      recorder.start()
      setMode('listening')
      stopTimerRef.current = setTimeout(stopRecording, 20000)
    } catch (err) {
      setError(err?.name === 'NotAllowedError'
        ? 'Microphone permission is blocked. Allow it for TentOS or type below.'
        : 'I could not open the microphone. Type your request below.')
      setMode('idle')
    }
  }, [stopRecording, transcribeAndSend])

  const handleOrb = () => {
    if (mode === 'listening') return stopRecording()
    if (mode === 'speaking') {
      window.speechSynthesis?.cancel()
      setMode('idle')
      return
    }
    if (!busy && status?.configured) startRecording()
  }

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    localStorage.setItem('tentos_assistant_sound', next ? 'on' : 'off')
    if (!next) {
      window.speechSynthesis?.cancel()
      if (mode === 'speaking') setMode('idle')
    }
  }

  const resetConversation = () => {
    clearTimeout(stopTimerRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop())
    window.speechSynthesis?.cancel()
    const created = makeSessionId()
    localStorage.setItem('tentos_assistant_session', created)
    sessionStorage.setItem('tentos_assistant_24h_started', '1')
    autoStartedRef.current = true
    setSessionId(created)
    setMessages([{ id: 'welcome', role: 'assistant', text: WELCOME_MESSAGE }])
    setInput('')
    setError('')
    setMode('idle')
  }

  return (
    <div className="assistant-shell">
      <section className="assistant-stage" aria-label="TentOS AI assistant">
        <div className="assistant-stage-intro">
          <div className="assistant-kicker">
            <span className={`assistant-live-dot ${status?.configured ? 'ready' : ''}`} />
            {status?.configured ? 'Ready' : 'Setup needed'} · TentOS only
          </div>
          <h2 className="assistant-stage-title">Talk to your tents</h2>
          <p className="assistant-stage-copy">Readings, history, equipment, alerts, and care in one conversation.</p>
        </div>

        <button
          type="button"
          className={`assistant-orb ${mode}`}
          onClick={handleOrb}
          disabled={!status?.configured || (busy && mode !== 'listening')}
          aria-label={orbLabel}
        >
          <span className="assistant-orb-core" />
          <span className="assistant-orb-shine" />
          <MicrophoneIcon className="assistant-orb-mic" />
        </button>
        <div className="assistant-orb-copy">
          <p className="assistant-orb-label">{orbLabel}</p>
          <button type="button" onClick={toggleSound} className="assistant-sound-toggle" aria-pressed={soundOn}>
            <span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span>
            Voice replies {soundOn ? 'on' : 'off'}
          </button>
        </div>

      </section>

      <section className="assistant-conversation">
        <div className="assistant-conversation-header">
          <div>
            <h2>Conversation</h2>
            <p>Ask, speak, or choose a quick request.</p>
          </div>
          <button type="button" onClick={resetConversation} className="assistant-new-chat" disabled={mode !== 'idle'}>
            New chat
          </button>
        </div>

        {status && !status.configured && (
          <div className="assistant-setup-card">
            <p className="font-semibold text-amber-200">One-time AI setup needed</p>
            <p className="mt-1 text-sm text-gray-300">
              Add <code className="text-amber-100">openai_api_key</code> in the TentOS add-on configuration, save, and restart TentOS. The key stays on the server.
            </p>
          </div>
        )}

        <div className="assistant-suggestions scrollbar-none">
          {SUGGESTIONS.map(suggestion => (
            <button
              type="button"
              key={suggestion.label}
              onClick={() => sendMessage(suggestion.prompt)}
              disabled={busy || !status?.configured}
              className="assistant-suggestion"
              title={suggestion.prompt}
            >
              {suggestion.label}
            </button>
          ))}
        </div>

        <div className="assistant-feed" aria-live="polite">
          {messages.map(message => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <p className="assistant-message-role">{message.role === 'assistant' ? 'TentOS AI' : 'You'}</p>
              <MessageText text={message.text} />
              {message.pendingActions?.map(action => (
                <PendingAction
                  key={action.token}
                  action={action}
                  sessionId={sessionId}
                  onResolved={handleActionResolved}
                />
              ))}
            </article>
          ))}
          {busy && (
            <article className="assistant-message assistant assistant-typing">
              <span /><span /><span />
            </article>
          )}
          <div ref={feedEndRef} />
        </div>

        {error && <p className="assistant-error">{error}</p>}

        <form
          className="assistant-compose"
          onSubmit={event => {
            event.preventDefault()
            sendMessage(input)
          }}
        >
          <button
            type="button"
            onClick={handleOrb}
            className={`assistant-compose-mic ${mode === 'listening' ? 'listening' : ''}`}
            disabled={!status?.configured || busy}
            aria-label={mode === 'listening' ? 'Stop recording' : 'Start voice request'}
          >
            <MicrophoneIcon />
          </button>
          <input
            value={input}
            onChange={event => setInput(event.target.value)}
            className="input min-w-0 flex-1 min-h-12"
            placeholder="Ask about the tents or request an action..."
            aria-label="Message TentOS assistant"
            maxLength={1500}
            disabled={busy || !status?.configured}
          />
          <button type="submit" className="btn btn-primary min-h-12" disabled={!input.trim() || busy || !status?.configured}>
            Send
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] text-gray-500">
          Equipment and configuration changes always wait for your confirmation.
        </p>
      </section>
    </div>
  )
}
