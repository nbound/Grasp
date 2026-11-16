import { useEffect, useState, useCallback } from 'react'
import { AuthContext } from './AuthContext.js'
import { getSupabase } from '../lib/supabase.js'

export function AuthProvider({ children }) {
  const [client] = useState(() => {
    try {
      return getSupabase()
    } catch {
      return null
    }
  })
  const [state, setState] = useState({
    session: null,
    teacher: false,
    loading: !!client,
    error: '',
  })
  const refresh = useCallback(async () => {
    if (!client) return
    const { data, error } = await client.auth.getSession()
    if (error) throw error
    const profile =
      data.session && !data.session.user.is_anonymous
        ? await client
            .from('teachers')
            .select('id')
            .eq('id', data.session.user.id)
            .maybeSingle()
        : { data: null }
    if (profile.error) throw profile.error
    setState({
      session: data.session,
      teacher: !!profile.data,
      loading: false,
      error: '',
    })
  }, [client])
  useEffect(() => {
    if (!client) return
    let alive = true,
      generation = 0
    const load = async (session) => {
      const current = ++generation
      try {
        const profile =
          session && !session.user.is_anonymous
            ? await client
                .from('teachers')
                .select('id')
                .eq('id', session.user.id)
                .maybeSingle()
            : { data: null }
        if (profile.error) throw profile.error
        if (alive && current === generation)
          setState({
            session,
            teacher: !!profile.data,
            loading: false,
            error: '',
          })
      } catch {
        if (alive && current === generation)
          setState({
            session,
            teacher: false,
            loading: false,
            error: 'Unable to load your account. Refresh to retry.',
          })
      }
    }
    client.auth.getSession().then(({ data, error }) => {
      if (!alive || generation) return
      if (error)
        setState({
          session: null,
          teacher: false,
          loading: false,
          error: 'Unable to restore sign-in. Please sign in again.',
        })
      else void load(data.session)
    })
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      // Avoid calling Supabase while its auth callback holds the session lock.
      queueMicrotask(() => {
        if (alive) void load(session)
      })
    })
    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [client])
  return (
    <AuthContext.Provider value={{ ...state, client, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}
