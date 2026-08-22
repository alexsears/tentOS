/**
 * The "see this reading's history" affordance.
 *
 * This was a chart emoji, which renders as a small grey box at this size and
 * reads like a second checkbox next to the real one in the entity list. An
 * inline SVG draws the same idea at any size and inherits the text colour.
 */
export function HistoryIcon({ className = '', size = 12 }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block align-[-0.1em] ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 13V3" />
      <path d="M2 13h12" />
      <path d="M4.5 10.5l3-3.5 2.5 2 3.5-4.5" />
    </svg>
  )
}
