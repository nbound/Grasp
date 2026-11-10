import { useEffect, useRef } from 'react'
let loading
export function Turnstile({ onToken }) {
  const container = useRef(null)
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  useEffect(() => {
    if (!sitekey) return
    let active = true,
      id
    if (!loading)
      loading = new Promise((resolve, reject) => {
        if (window.turnstile) return resolve()
        const script = document.createElement('script')
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.onload = resolve
        script.onerror = reject
        document.head.append(script)
      })
    loading
      .then(() => {
        if (active)
          id = window.turnstile.render(container.current, {
            sitekey,
            callback: onToken,
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
          })
      })
      .catch(() => onToken(''))
    return () => {
      active = false
      if (id !== undefined) window.turnstile?.remove(id)
    }
  }, [sitekey, onToken])
  return sitekey ? <div ref={container} className="captcha" /> : null
}
