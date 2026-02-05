import { useState, useEffect, useRef } from 'react'
import { getApiBase } from '../utils/api'

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

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden bg-gray-900 ${
        fullscreen ? 'w-full h-full' : ''
      }`}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-2 bg-gradient-to-b from-black/70 to-transparent">
        <span className="text-sm font-medium text-white capitalize">{displayName}</span>
        <div className="flex items-center gap-1">
          {/* Mode toggle */}
          <button
            onClick={() => {
              setLoading(true)
              setMode(m => m === 'snapshot' ? 'stream' : 'snapshot')
            }}
            className={`px-2 py-1 text-xs rounded ${
              mode === 'stream' ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
            title={mode === 'snapshot' ? 'Switch to live stream' : 'Switch to snapshots'}
            aria-label={mode === 'snapshot' ? 'Switch to live stream' : 'Switch to snapshot mode'}
          >
            {mode === 'stream' ? '● LIVE' : '📷 Snap'}
          </button>
          {/* Refresh button (snapshot mode only) */}
          {mode === 'snapshot' && (
            <button
              onClick={handleRefresh}
              className="p-1 text-white/70 hover:text-white"
              title="Refresh snapshot"
              aria-label="Refresh camera snapshot"
            >
              🔄
            </button>
          )}
          {/* Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            className="p-1 text-white/70 hover:text-white"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {fullscreen ? '⛶' : '⛶'}
          </button>
        </div>
      </div>

      {/* Camera feed */}
      <div className={`relative ${fullscreen ? 'h-full' : 'aspect-video'}`}>
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
            <span className="text-4xl mb-2">📷</span>
            <span className="text-sm">Camera unavailable</span>
            <button
              onClick={handleRefresh}
              className="mt-2 text-xs text-blue-400 hover:text-blue-300"
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
            <span className="text-white text-sm animate-pulse">Loading...</span>
          </div>
        )}
      </div>

      {/* Footer with status */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between p-2 bg-gradient-to-t from-black/70 to-transparent text-xs text-gray-400">
        <span className="truncate max-w-[60%]">{entityId}</span>
        {mode === 'snapshot' && !error && lastUpdated && (
          <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
        )}
        {mode === 'stream' && !error && (
          <span className="text-red-400">● Streaming</span>
        )}
      </div>
    </div>
  )
}

export function CameraGrid({ tentId, cameras }) {
  if (!cameras || cameras.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <span className="text-4xl mb-2 block">📷</span>
        <p>No cameras configured for this tent.</p>
        <p className="text-sm mt-1">Add cameras in Settings → Sensors → Camera</p>
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
