import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
import { api, readable } from '../../lib/api.js'
import { Turnstile } from '../../components/ui/Turnstile.jsx'

export function AuthPage({ mode = 'login' }) {
  const { client, session, refresh } = useAuth()
  const location = useLocation(),
    navigate = useNavigate()
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState('')
  const [invite, setInvite] = useState(''),
    [token, setToken] = useState('')
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('')
  const teacher = new URLSearchParams(location.search).get('role') === 'teacher'
  const title = {
    login: 'Welcome back',
    signup: 'Create your account',
    recovery: 'Reset your password',
    reset: 'Choose a password',
    enroll: 'Teacher enrollment',
    link: 'Keep your study history',
  }[mode]
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (!client) throw new Error('Configure Supabase to enable accounts.')
      let result
      const redirect = `${window.location.origin}/auth/callback`
      if (mode === 'login') {
        result = await client.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: token || undefined },
        })
      } else if (mode === 'signup') {
        if (session?.user.is_anonymous)
          throw new Error(
            'Use “Keep guest history” to attach an email to this guest, or sign out to start a separate account.',
          )
        result = await client.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name },
            emailRedirectTo: redirect,
            captchaToken: token || undefined,
          },
        })
      } else if (mode === 'recovery')
        result = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
          captchaToken: token || undefined,
        })
      else if (mode === 'reset')
        result = await client.auth.updateUser({ password })
      else if (mode === 'link')
        result = await client.auth.updateUser(
          { email },
          { emailRedirectTo: `${window.location.origin}/auth/reset` },
        )
      else {
        await api('/teacher/enroll', { code: invite })
        await refresh()
        navigate('/teacher')
        return
      }
      if (result.error) throw result.error
      if (mode === 'login') {
        await refresh()
        const from = location.state?.from
        navigate(
          from?.startsWith('/teacher') || from?.startsWith('/play/')
            ? from
            : teacher
              ? '/teacher'
              : '/study',
        )
      } else if (mode === 'reset') {
        await refresh()
        navigate('/study')
      } else
        setMessage(
          mode === 'link'
            ? 'Check your email. Confirm the address, then choose a password to keep this same player and history.'
            : 'Check your email to continue. If confirmation is disabled locally, you can sign in now.',
        )
    } catch (e) {
      setError(readable(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="narrow">
      <p className="grasp-eyebrow">Your space to learn</p>
      <h1>{title}</h1>
      {mode === 'enroll' && (
        <p>
          Use the invitation supplied by your Grasp administrator. Your email
          must be confirmed.
        </p>
      )}
      <form className="grasp-card stack" onSubmit={submit} aria-busy={busy}>
        {mode === 'signup' && (
          <label>
            Display name
            <input
              required
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        {!['reset', 'enroll'].includes(mode) && (
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {['login', 'signup', 'reset'].includes(mode) && (
          <label>
            Password
            <input
              type="password"
              required
              minLength={mode === 'login' ? 1 : 12}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {mode === 'enroll' && (
          <label>
            Teacher invitation
            <input
              type="password"
              required
              autoComplete="off"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
          </label>
        )}
        {['login', 'signup', 'recovery'].includes(mode) && (
          <Turnstile onToken={setToken} />
        )}
        {error && (
          <p role="alert" className="grasp-error">
            {error}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <button className="grasp-button" disabled={busy || !client}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Continue'}
        </button>
      </form>
      <nav className="actions">
        <Link to={`/login${teacher ? '?role=teacher' : ''}`}>Sign in</Link>
        <Link to={`/signup${teacher ? '?role=teacher' : ''}`}>
          Create account
        </Link>
        <Link to="/auth/recovery">Forgot password?</Link>
        {session?.user.is_anonymous && (
          <Link to="/account/link">Keep guest history</Link>
        )}
      </nav>
    </main>
  )
}
