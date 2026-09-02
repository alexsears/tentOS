import { useEffect, useRef, useState } from 'react'
import { EllipsisVertical } from 'lucide-react'

/**
 * Kebab overflow menu for a card corner.
 *
 * Holds the actions that are needed sometimes but would clutter the card if
 * they sat on it all day (change stage, arrange controls, open details).
 * Closes on outside tap, Escape, or after an item is chosen.
 */
export function CardMenu({ items, label = 'More actions', className = '' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const visibleItems = (items || []).filter(Boolean)
  if (visibleItems.length === 0) return null

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(value => !value) }}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-[#2d3a5c] hover:text-white ${
          open ? 'bg-[#2d3a5c] text-white' : 'text-gray-400'
        }`}
      >
        <EllipsisVertical size={18} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-[#2d3a5c] bg-[#16213e] py-1 shadow-xl"
        >
          {visibleItems.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  setOpen(false)
                  item.onSelect?.()
                }}
                className="flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm text-gray-200 transition-colors hover:bg-[#2d3a5c] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {Icon && <Icon size={16} className="shrink-0 text-gray-400" aria-hidden="true" />}
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
