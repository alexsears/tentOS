import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import Home from './pages/Home'
import TentDetail from './pages/TentDetail'
import Events from './pages/Events'
import Settings from './pages/Settings'
import Automations from './pages/Automations'
import Reports from './pages/Reports'
import Chat from './pages/Chat'
import Climate from './pages/Climate'
import Assistant from './pages/Assistant'
import { useWebSocket } from './hooks/useWebSocket'
import { AlertBanner } from './components/AlertBanner'
import { apiFetch } from './utils/api'
import { fetchTentsShared } from './hooks/useTents'
import { AlertsMenu } from './components/AlertsMenu'
import { TempUnitProvider, useTemperatureUnit } from './hooks/useTemperatureUnit'

// Preloaded data context - fetches automations and events on app load
const PreloadContext = createContext({ automations: null, events: null, tents: null })
export const usePreloadedData = () => useContext(PreloadContext)

// Temperature unit toggle component
function TempToggle() {
  const { unit, toggleUnit } = useTemperatureUnit()
  return (
    <button
      onClick={toggleUnit}
      className="px-2 py-1 rounded bg-[#1a1a2e] hover:bg-[#2d3a5c] text-sm font-medium transition-colors"
      title="Toggle temperature unit"
    >
      °{unit}
    </button>
  )
}

function AppContent() {
  const location = useLocation()
  const [alerts, setAlerts] = useState([])
  const [version, setVersion] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [latestVersion, setLatestVersion] = useState('')
  const [preloadedData, setPreloadedData] = useState({ automations: null, events: null, tents: null })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { lastMessage } = useWebSocket('api/ws')

  const refreshAlertSummary = useCallback(() => {
    apiFetch('api/alerts/summary')
      .then(r => r.json())
      .then(data => setAlerts(data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    // Fetch initial alerts
    refreshAlertSummary()

    // Fetch version
    apiFetch('api/health')
      .then(r => r.json())
      .then(data => setVersion(data.version || ''))
      .catch(console.error)

    // Check for updates
    apiFetch('api/updates/check')
      .then(r => r.json())
      .then(data => {
        setUpdateAvailable(data.update_available || false)
        setLatestVersion(data.latest_version || '')
      })
      .catch(console.error)

    // Preload for instant page loads. Tents come first because the dashboard
    // needs them; the automation and history endpoints are the slow pair, so
    // they are warmed after the first paint rather than racing it.
    fetchTentsShared()
      .catch(() => [])
      .then(tents => setPreloadedData(prev => ({ ...prev, tents: tents || [] })))

    const warmSlowPages = setTimeout(() => {
      Promise.all([
        apiFetch('api/automations?show_all=false').then(r => r.json()).catch(() => ({ automations: [] })),
        apiFetch('api/events/ha-history?hours=24').then(r => r.json()).catch(() => ({ events: [] })),
      ]).then(([autoData, eventsData]) => {
        setPreloadedData(prev => ({ ...prev, automations: autoData, events: eventsData }))
      })
    }, 1500)

    return () => clearTimeout(warmSlowPages)
  }, [])

  useEffect(() => {
    if (lastMessage?.type === 'alert_summary') {
      setAlerts(lastMessage.data)
    }
  }, [lastMessage])

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '🌱' },
    { path: '/assistant', label: 'Assistant', icon: '◉' },
    { path: '/climate', label: 'Climate', icon: '🌡️' },
    { path: '/reports', label: 'Reports', icon: '📊' },
    { path: '/automations', label: 'Automations', icon: '🤖' },
    { path: '/events', label: 'Events', icon: '📋' },
    { path: '/chat', label: 'Chat', icon: '💬' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ]
  const mobilePrimaryPaths = new Set(['/', '/assistant', '/climate', '/automations'])
  const mobilePrimaryItems = navItems.filter(item => mobilePrimaryPaths.has(item.path))
  const mobileMoreItems = navItems.filter(item => !mobilePrimaryPaths.has(item.path))

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <PreloadContext.Provider value={preloadedData}>
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-[#16213e] border-b border-[#2d3a5c] shrink-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <span className="text-xl shrink-0">🌿</span>
              <h1 className="text-lg font-semibold shrink-0">TentOS</h1>
              {version && <span className="text-xs text-gray-500">v{version}</span>}
              {updateAvailable && (
                <a
                  href="/hassio/addon/f2f41762_tentos/info"
                  target="_top"
                  className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                  title={`v${latestVersion} available - click to update in HA`}
                >
                  Update
                </a>
              )}
              <TempToggle />
            </div>

            <nav className="hidden md:flex items-center gap-0.5">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-3 py-1.5 rounded-lg transition-colors text-sm ${
                    location.pathname === item.path
                      ? 'bg-green-600/20 text-green-400'
                      : 'hover:bg-[#1f2b4d] text-gray-300'
                  }`}
                >
                  <span className="mr-1">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Keep active alerts reachable in both the website and Android shell. */}
            <div className="flex items-center gap-2 shrink-0">
              <AlertsMenu summary={alerts} onChanged={refreshAlertSummary} />
            </div>
          </div>
        </div>
      </header>

      {/* Alert Banner */}
      <AlertBanner />

      {/* Main Content - scrolls internally */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-24 md:pb-4">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/climate" element={<Climate />} />
            <Route path="/tent/:tentId" element={<TentDetail />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/automations" element={<Automations />} />
            <Route path="/events" element={<Events />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </main>

      <nav className="md:hidden fixed inset-x-0 bottom-0 z-50 bg-[#121a31]/95 backdrop-blur border-t border-[#2d3a5c] safe-bottom">
        <div className="grid grid-cols-5 h-16">
          {mobilePrimaryItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors ${
                location.pathname === item.path ? 'text-green-400' : 'text-gray-400 active:text-white'
              }`}
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(open => !open)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${
              mobileMenuOpen || mobileMoreItems.some(item => location.pathname === item.path)
                ? 'text-green-400' : 'text-gray-400'
            }`}
            aria-expanded={mobileMenuOpen}
            aria-label="More navigation"
          >
            <span className="text-xl leading-none">•••</span>
            <span>More</span>
          </button>
        </div>
      </nav>

      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileMenuOpen(false)}>
          <div
            className="absolute inset-x-3 bottom-20 rounded-2xl border border-[#2d3a5c] bg-[#16213e] p-2 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            {mobileMoreItems.map(item => (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center gap-3 min-h-12 px-4 rounded-xl text-gray-200 active:bg-[#2d3a5c]"
              >
                <span className="text-xl">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
    </PreloadContext.Provider>
  )
}

function App() {
  return (
    <TempUnitProvider>
      <AppContent />
    </TempUnitProvider>
  )
}

export default App
