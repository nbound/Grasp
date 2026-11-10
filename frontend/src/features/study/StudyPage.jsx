import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
import { api } from '../../lib/api.js'
import { History } from '../results/History.jsx'

export function StudyPage() {
  const { session, teacher } = useAuth()
  const [study, setStudy] = useState(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    api('/study')
      .then((study) => {
        if (alive) setStudy(study)
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [reload])
  async function act(operation) {
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function cosmetics(patch) {
    const next = { theme: study.theme, avatar: study.avatar, ...patch }
    await api('/study/cosmetics', next)
    setStudy((s) => ({ ...s, ...next }))
  }
  return (
    <main className={`wide theme-${study?.theme || 'forest'}`}>
      <p className="grasp-eyebrow">Your study space</p>
      <h1>Keep curiosity growing.</h1>
      {!session.user.is_anonymous && !teacher && (
        <p>
          Have a teacher invitation?{' '}
          <Link to="/teacher-enrollment">Enroll as a teacher</Link>.
        </p>
      )}
      {session.user.is_anonymous && (
        <section className="grasp-card">
          <h2>Keep your progress</h2>
          <p>
            Your games are saved to this guest identity. Attach an email before
            signing out to use history on another device.
          </p>
          <Link to="/account/link">Keep guest history →</Link>
        </section>
      )}
      {error && (
        <p className="grasp-error" role="alert">
          {error} <button onClick={() => setReload((n) => n + 1)}>Retry</button>
        </p>
      )}
      {!study && !error && <p role="status">Loading your study space…</p>}
      {study && (
        <>
          <section className="grasp-card">
            <div className="page-heading">
              <div>
                <h2>
                  {{ seed: '✦', leaf: '❧', tree: '♧' }[study.avatar]}{' '}
                  {study.streak} day study streak
                </h2>
                <p>
                  {study.answered} recent answers · {study.correct} correct
                </p>
              </div>
              <p>Cosmetics never affect points.</p>
            </div>
            <p className="grasp-muted">
              Study days use UTC. Ocean and leaf unlock at 3 consecutive days;
              sunset and tree at 7. Earned rewards stay unlocked.
            </p>
            <div className="form-grid">
              <label>
                Theme
                <select
                  value={study.theme}
                  disabled={busy}
                  onChange={(e) =>
                    act(() => cosmetics({ theme: e.target.value }))
                  }
                >
                  {study.inventory.themes.map((theme) => (
                    <option key={theme}>{theme}</option>
                  ))}
                </select>
              </label>
              <label>
                Avatar
                <select
                  value={study.avatar}
                  disabled={busy}
                  onChange={(e) =>
                    act(() => cosmetics({ avatar: e.target.value }))
                  }
                >
                  {study.inventory.avatars.map((avatar) => (
                    <option key={avatar}>{avatar}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <History />
          <section className="grasp-card stack">
            <h2>Review what needs another look</h2>
            <p>
              Review your answers and teacher explanations from completed games.
            </p>
            {study.mistakes.length === 0 && (
              <p>No saved mistakes to review yet.</p>
            )}
            {study.mistakes.map((m, i) => (
              <details key={`${m.questionId}:${i}`}>
                <summary>{m.prompt}</summary>
                <p>Your answer: {m.answer}</p>
                <p>Correct answer: {m.correctAnswer}</p>
                <p>{m.explanation}</p>
              </details>
            ))}
          </section>
        </>
      )}
    </main>
  )
}
