import { useState, useEffect, useRef } from 'react'
import { Camera, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import { getApiBase } from '../utils/api'

const ICON_BUTTON = 'flex h-11 w-11 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white'

export function CameraFeed({ tentId, entityId, label, defaultMode = 'snapshot', refreshInterval = 5000 }) {
  const [mode, setMode] = useState(defaultMode) // 'snapshot' | 'stream'
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)
  const containerRef = useRef(null)
  const streamImgRef = useRef(null)
  const apiBase = getApiBase()

  // Auto-refresh snapshot when in snapshot mode
  useEffect(() => {
    if (mode !== 'snapshot' || error) return
    const interval = setInterval(() => {
      setRefreshKey(k => k + 1)
    }, refreshInterval)
    return () => clearInterval(interval)
  }, [mode, error, refreshInterval])

  // Cleanup MJPEG stream on unmount or mode change (closes HTTP connection)
  useEffect(() => {
    return () => {
      if (streamImgRef.current) {
        streamImgRef.current.src = ''
      }
    }
  }, [])

  // Stop stream when switching to snapshot mode
  useEffect(() => {
    if (mode === 'snapshot' && streamImgRef.current) {
      streamImgRef.current.src = ''
    }
  }, [mode])

  // Handle fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setFullscreen(false)
      }
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const snapshotUrl = `${apiBase}/api/camera/${tentId}/${entityId}/snapshot?t=${refreshKey}`
  const streamUrl = `${apiBase}/api/camera/${tentId}/${entityId}/stream`

  const toggleFullscreen = async () => {
    if (!containerRef.current) return

    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen()
      setFullscreen(true)
    } else {
      await document.exitFullscreen()
      setFullscreen(false)
    }
  }

  const handleRefresh = () => {
    setError(false)
    setLoading(true)
    setRefreshKey(k => k + 1)
  }

  // Extract friendly name from entity_id
  const displayName = label || entityId.split('.').pop().replace(/_/g, ' ')
  const streaming = mode === 'stream'

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden bg-gray-900 ${
        fullscreen ? 'w-full h-full' : ''
      }`}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between gap-2 px-2 py-1 bg-gradient-to-b from-black/70 to-transparent">
        <span className="min-w-0 truncate text-sm font-medium text-white capitalize">{displayName}</span>
        <div className="flex shrink-0 items-center">
          {/* Mode toggle: snapshots or live stream */}
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              setMode(m => m === 'snapshot' ? 'stream' : 'snapshot')
            }}
            aria-pressed={streaming}
            className={`${ICON_BUTTON} ${streaming ? 'text-red-400 hover:text-red-300' : ''}`}
            title={streaming ? 'Switch to snapshots' : 'Switch to live stream'}
            aria-label={streaming ? 'Switch to snapshot mode' : 'Switch to live stream'}
          >
            <Camera size={20} aria-hidden="true" />
          </button>
          {/* Refresh button (snapshot mode only) */}
          {mode === 'snapshot' && (
            <button
              type="button"
              onClick={handleRefresh}
              className={ICON_BUTTON}
              title="Refresh snapshot"
              aria-label="Refresh camera snapshot"
            >
              <RefreshCw size={20} aria-hidden="true" />
            </button>
          )}
          {/* Fullscreen button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={ICON_BUTTON}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fullscreen
              ? <Minimize2 size={20} aria-hidden="true" />
              : <Maximize2 size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Camera feed: full width, no taller than 40vh on phones */}
      <div className={`relative ${fullscreen ? 'h-full' : 'aspect-video max-h-[40vh] md:max-h-none'}`}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <Camera size={32} className="mb-2" aria-hidden="true" />
            <span className="text-sm">Camera unavailable</span>
            <button
              type="button"
              onClick={handleRefresh}
              className="mt-1 min-h-[44px] px-3 text-sm text-green-400 hover:text-green-300"
              aria-label="Retry loading camera"
            >
              Try again
            </button>
          </div>
        ) : mode === 'stream' ? (
          <img
            ref={streamImgRef}
            src={streamUrl}
            alt={`Live stream from ${displayName}`}
            className="w-full h-full object-contain bg-black"
            onError={() => setError(true)}
            onLoad={() => setLoading(false)}
          />
        ) : (
          <img
            key={refreshKey}
            src={snapshotUrl}
            alt={`Snapshot from ${displayName}`}
            className="w-full h-full object-contain bg-black"
            onError={() => setError(true)}
            onLoad={() => {
              setLoading(false)
              setLastUpdated(new Date())
            }}
          />
        )}
        {/* Loading indicator */}
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <span className="text-white text-sm">Loading...</span>
          </div>
        )}
      </div>

      {/* Footer with status */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-2 p-2 bg-gradient-to-t from-black/70 to-transparent text-xs text-gray-400">
        <span className="truncate max-w-[60%]">{entityId}</span>
        {mode === 'snapshot' && !error && lastUpdated && (
          <span className="shrink-0">Updated {lastUpdated.toLocaleTimeString()}</span>
        )}
        {streaming && !error && (
          <span className="inline-flex shrink-0 items-center gap-1.5 text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
    </div>
  )
}

export function CameraGrid({ tentId, cameras }) {
  if (!cameras || cameras.length === 0) {
    return (
      <div className="flex flex-col items-center py-8 text-center text-gray-500">
        <Camera size={32} className="mb-2" aria-hidden="true" />
        <p>No cameras configured for this tent.</p>
        <p className="text-sm mt-1">Add one in the Tent Builder under Sensors.</p>
      </div>
    )
  }

  return (
    <div className={`grid gap-4 ${
      cameras.length === 1 ? '' :
      cameras.length === 2 ? 'md:grid-cols-2' :
      'md:grid-cols-2 lg:grid-cols-3'
    }`}>
      {cameras.map((cameraId, index) => (
        <CameraFeed
          key={cameraId}
          tentId={tentId}
          entityId={cameraId}
          label={cameras.length > 1 ? `Camera ${index + 1}` : undefined}
        />
      ))}
    </div>
  )
}
