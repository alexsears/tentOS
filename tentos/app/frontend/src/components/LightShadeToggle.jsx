import { Sun } from 'lucide-react'
import { useShadeLights, lightSummary } from '../utils/lightShading'

/**
 * The "Lights" option beside a history chart: shade the plot while the tent light
 * was on. One shared preference, so flipping it here flips every chart.
 *
 * `periods` is optional; when given, the hours the lights were on are shown next to
 * the switch so a fully shaded chart (a 24h light) still reads as deliberate.
 */
export function LightShadeToggle({ periods, className = '' }) {
  const [on, setOn] = useShadeLights()
  const summary = on ? lightSummary(periods) : null

  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      {summary && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-block h-2.5 w-3.5 shrink-0 rounded border border-yellow-400/50 bg-yellow-400/30" />
          <span className="truncate">{summary}</span>
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Shade the chart while the lights are on"
        title="Shade the chart while the lights are on"
        onClick={() => setOn(!on)}
        className={`flex h-11 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors sm:h-9 ${
          on
            ? 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200'
            : 'border-[#2d3a5c] bg-[#1a1a2e] text-gray-400 hover:border-gray-500'
        }`}
      >
        <Sun size={16} aria-hidden="true" />
        <span>Lights</span>
        <span
          aria-hidden="true"
          className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${on ? 'bg-yellow-400/80' : 'bg-gray-600'}`}
        >
          <span className={`block h-3 w-3 rounded-full bg-white transition-transform ${on ? 'translate-x-3' : ''}`} />
        </span>
      </button>
    </div>
  )
}
