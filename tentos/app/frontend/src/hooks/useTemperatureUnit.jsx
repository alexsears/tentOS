import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// Temperature unit context
const TempUnitContext = createContext(null)

// Convert Celsius to Fahrenheit
export function celsiusToFahrenheit(celsius) {
  if (celsius == null) return null
  return (celsius * 9/5) + 32
}

// Convert Fahrenheit to Celsius
export function fahrenheitToCelsius(fahrenheit) {
  if (fahrenheit == null) return null
  return (fahrenheit - 32) * 5/9
}

// Format temperature with unit
export function formatTemp(celsius, unit = 'C', decimals = 1) {
  if (celsius == null) return '--'
  const value = unit === 'F' ? celsiusToFahrenheit(Number(celsius)) : Number(celsius)
  return value.toFixed(decimals)
}

// Get unit symbol
export function getTempUnit(unit) {
  return unit === 'F' ? '°F' : '°C'
}

// Hook to use temperature unit
export function useTemperatureUnit() {
  const context = useContext(TempUnitContext)
  if (context) return context

  // Fallback for when used outside provider (default to Fahrenheit)
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem('tempUnit') || 'F'
    } catch {
      return 'F'
    }
  })

  const toggleUnit = useCallback(() => {
    const newUnit = unit === 'C' ? 'F' : 'C'
    setUnit(newUnit)
    try {
      localStorage.setItem('tempUnit', newUnit)
    } catch {}
  }, [unit])

  return { unit, toggleUnit, formatTemp: (c, d) => formatTemp(c, unit, d), getTempUnit: () => getTempUnit(unit) }
}

// Provider component
export function TempUnitProvider({ children }) {
  const [unit, setUnit] = useState(() => {
    try {
      return localStorage.getItem('tempUnit') || 'F'
    } catch {
      return 'F'
    }
  })

  const toggleUnit = useCallback(() => {
    const newUnit = unit === 'C' ? 'F' : 'C'
    setUnit(newUnit)
    try {
      localStorage.setItem('tempUnit', newUnit)
    } catch {}
  }, [unit])

  const value = {
    unit,
    toggleUnit,
    formatTemp: (celsius, decimals) => formatTemp(celsius, unit, decimals),
    getTempUnit: () => getTempUnit(unit)
  }

  return (
    <TempUnitContext.Provider value={value}>
      {children}
    </TempUnitContext.Provider>
  )
}

export default useTemperatureUnit
