import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Home from './pages/Home'
import TentDetail from './pages/TentDetail'
import Events from './pages/Events'
import Settings from './pages/Settings'
import Automations from './pages/Automations'
import Reports from './pages/Reports'
import { useWebSocket } from './hooks/useWebSocket'
import { AlertBanner } from './components/AlertBanner'
import { apiFetch } from './utils/api'

function App() {
  const location = useLocation()
  const [alerts, setAlerts] = useState([])
  const [version, setVersion] = useState('')
  const { lastMessage } = useWebSocket('api/ws')

  useEffect(() => {
    // Fetch initial alerts
    apiFetch('api/alerts/summary')
      .then(r => r.json())
      .then(data => setAlerts(data))
      .catch(console.error)

    // Fetch version
    apiFetch('api/health')
      .then(r => r.json())
      .then(data => setVersion(data.version || ''))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (lastMessage?.type === 'alert') {
      setAlerts(prev => ({ ...prev, ...lastMessage.data }))
    }
  }, [lastMessage])

  const navItems = [
    { path: '/', label: 'Dashboard', icon: '🌱' },
    { path: '/reports', label: 'Reports', icon: '📊' },
    { path: '/automations', label: 'Automations', icon: '🤖' },
    { path: '/events', label: 'Events', icon: '📋' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-[#16213e] border-b border-[#2d3a5c] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🌿</span>
              <h1 className="text-xl font-semibold">TentOS</h1>
              {version && <span className="text-xs text-gray-500">v{version}</span>}
            </div>

            <nav className="flex items-center gap-1">
              {navItems.map(item => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    location.pathname === item.path
                      ? 'bg-green-600/20 text-green-400'
                      : 'hover:bg-[#1f2b4d] text-gray-300'
                  }`}
                >
                  <span className="mr-2">{item.icon}</span>
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Alert indicator */}
            {alerts.total > 0 && (
              <div className="flex items-center gap-2">
                {alerts.critical > 0 && (
                  <span className="badge badge-danger">
                    {alerts.critical} Critical
                  </span>
                )}
                {alerts.warning > 0 && (
                  <span className="badge badge-warning">
                    {alerts.warning} Warning
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Alert Banner */}
      <AlertBanner />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tent/:tentId" element={<TentDetail />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/automations" element={<Automations />} />
          <Route path="/events" element={<Events />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
