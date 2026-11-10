import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
import { withSocket, emit } from '../../lib/gameSocket.js'

export function Dashboard() {
  const { client } = useAuth(),
    navigate = useNavigate()
  const [quizzes, setQuizzes] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(''),
    [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    client
      .from('quizzes')
      .select('*,questions(count),game_sessions(count)')
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (alive) {
          setQuizzes(data)
          setError(error ? 'Unable to load quizzes. Try again.' : '')
        }
      })
    return () => {
      alive = false
    }
  }, [client, reload])
  async function action(quiz, type) {
    setBusy(quiz.id)
    setError('')
    try {
      if (type === 'host') {
        const key = `grasp:host-request:${quiz.id}`
        const requestId = sessionStorage.getItem(key) || crypto.randomUUID()
        sessionStorage.setItem(key, requestId)
        const { lobby, sessionId } = await withSocket((socket) =>
          emit(socket, 'host_create', { quizId: quiz.id, requestId }),
        )
        sessionStorage.removeItem(key)
        navigate(`/teacher/host/${sessionId || lobby.sessionId}`)
      } else if (type === 'duplicate') {
        const { data: questions, error } = await client
          .from('questions')
          .select('*')
          .eq('quiz_id', quiz.id)
          .order('position')
        if (error) throw error
        const saved = await client.rpc('save_quiz', {
          p_id: null,
          p_revision: null,
          p_quiz: { ...quiz, title: `${quiz.title.slice(0, 193)} (copy)` },
          p_questions: questions,
        })
        if (saved.error) throw saved.error
        navigate(`/teacher/quizzes/${saved.data}`)
      } else {
        if (
          !window.confirm(
            type === 'archive'
              ? 'Archive this quiz? Existing sessions and results will stay available.'
              : 'Delete this unhosted quiz and its questions?',
          )
        )
          return
        const result =
          type === 'archive'
            ? await client
                .from('quizzes')
                .update({ archived: true })
                .eq('id', quiz.id)
            : await client.from('quizzes').delete().eq('id', quiz.id)
        if (result.error) throw result.error
        setReload((x) => x + 1)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }
  return (
    <main className="wide">
      <div className="page-heading">
        <div>
          <p className="grasp-eyebrow">Teacher workspace</p>
          <h1>Your quizzes</h1>
          <p className="grasp-muted">Make room for a little discovery.</p>
        </div>
        <Link className="grasp-button" to="/teacher/quizzes/new">
          Create quiz +
        </Link>
      </div>
      {error && (
        <p role="alert" className="grasp-error">
          {error} <button onClick={() => setReload((x) => x + 1)}>Retry</button>
        </p>
      )}
      {!quizzes && !error && <p role="status">Loading quizzes…</p>}
      {quizzes?.length === 0 && (
        <section className="grasp-card">
          <h2>Your first quiz starts here</h2>
          <p>Add a few questions, invite your class, and learn together.</p>
        </section>
      )}
      <div className="quiz-grid">
        {quizzes?.map((quiz) => (
          <article className="grasp-card" key={quiz.id}>
            <p className="grasp-eyebrow">
              {quiz.questions[0].count} questions ·{' '}
              {quiz.game_mode.replaceAll('_', ' ')}
            </p>
            <h2>{quiz.title}</h2>
            <p>{quiz.description || 'Ready for your next class.'}</p>
            <div className="actions">
              <Link to={`/teacher/quizzes/${quiz.id}`}>
                {quiz.game_sessions[0].count ? 'View' : 'Edit'}
              </Link>
              <button
                disabled={!!busy || !quiz.questions[0].count}
                onClick={() => action(quiz, 'host')}
              >
                Host
              </button>
              <button
                disabled={!!busy || !quiz.questions[0].count}
                onClick={() => action(quiz, 'duplicate')}
              >
                Duplicate
              </button>
              <button
                disabled={!!busy}
                onClick={() =>
                  action(
                    quiz,
                    quiz.game_sessions[0].count ? 'archive' : 'delete',
                  )
                }
              >
                {quiz.game_sessions[0].count ? 'Archive' : 'Delete'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  )
}
