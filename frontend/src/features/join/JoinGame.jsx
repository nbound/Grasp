import { KnowledgeShapes } from '../../components/ui/KnowledgeShapes.jsx'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
import { withSocket, emit } from '../../lib/gameSocket.js'
import { validateJoin } from '../student/model/joinValidation.js'
import { Turnstile } from '../../components/ui/Turnstile.jsx'

export function JoinGame() {
  const { client } = useAuth(),
    navigate = useNavigate()
  const [pin, setPin] = useState(''),
    [nickname, setNickname] = useState(''),
    [token, setToken] = useState('')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function join(event) {
    event.preventDefault()
    setError('')
    const checked = validateJoin({ pin, nickname })
    if (!checked.valid) {
      setError(Object.values(checked.errors).join(' '))
      return
    }
    setBusy(true)
    try {
      if (!client)
        throw new Error(
          'Add the browser Supabase URL and publishable key to enable live games.',
        )
      const { data, error: authError } = await client.auth.getSession()
      if (authError) throw authError
      if (!data.session) {
        const signed = await client.auth.signInAnonymously({
          options: { captchaToken: token || undefined },
        })
        if (signed.error) throw signed.error
      }
      const reply = await withSocket((socket) =>
        emit(socket, 'player_join', checked.values),
      )
      localStorage.setItem('grasp:last-game', reply.lobby.sessionId)
      navigate(`/play/${reply.lobby.sessionId}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const last = localStorage.getItem('grasp:last-game')
  return (
    <main className="wide join-layout">
      <section className="join-intro">
        <p className="grasp-eyebrow">One team. Every answer counts.</p>
        <h1>
          Team up.
          <br />
          Know more. Win together.
        </h1>
        <p className="grasp-muted">
          Bring what you know from class. Answer questions, earn points, and
          help your team take the lead.
        </p>
        <KnowledgeShapes />
      </section>
      <div className="join-panel">
        <form className="grasp-card stack" onSubmit={join} aria-busy={busy}>
          <h2>Join a game</h2>
          <label>
            Game PIN
            <input
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <label>
            Your nickname
            <input
              required
              minLength={2}
              maxLength={24}
              autoComplete="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
          </label>
          <Turnstile onToken={setToken} />
          {error && (
            <p role="alert" className="grasp-error">
              {error}
            </p>
          )}
          <button className="grasp-button" disabled={busy}>
            {busy ? 'Joining…' : 'Join your team →'}
          </button>
        </form>
        <nav className="actions">
          <Link to="/login?role=teacher">I’m a teacher</Link>
          <Link to="/study">My study space</Link>
          {last && <Link to={`/play/${last}`}>Resume last game</Link>}
        </nav>
        <p className="grasp-note">
          Think it through. Correct answers win points; speed never does.
        </p>
      </div>
    </main>
  )
}
