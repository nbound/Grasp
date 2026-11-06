const storageKey = 'grasp-theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set()

function readPreference() {
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

let preference = readPreference()

function applyTheme() {
  const theme = preference ?? (systemTheme.matches ? 'dark' : 'light')
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#101d19' : '#f5f6ef')
  for (const listener of listeners) listener()
}

// Apply the preference before React renders, including when storage is unavailable.
export function initializeTheme() {
  applyTheme()
  systemTheme.addEventListener('change', applyTheme)
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) {
      preference = readPreference()
      applyTheme()
    }
  })
}

export function getTheme() {
  return document.documentElement.dataset.theme
}

export function subscribeToTheme(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(theme) {
  preference = theme
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // Keep the selection for this visit when browser storage is blocked.
  }
  applyTheme()
}
