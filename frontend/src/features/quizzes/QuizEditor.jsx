import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
import { emptyQuestion, validateQuiz } from './model.js'

export function QuizEditor() {
  const { id } = useParams()
  return <Editor key={id} id={id} />
}
function Editor({ id }) {
  const { client } = useAuth(),
    navigate = useNavigate()
  const [quiz, setQuiz] = useState({
    title: '',
    description: '',
    timer_enabled: false,
    feedback_mode: 'after_question',
    game_mode: 'team',
  })
  const [questions, setQuestions] = useState([emptyQuestion()]),
    [loading, setLoading] = useState(id !== 'new')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [hosted, setHosted] = useState(false)
  const allowNavigation = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !allowNavigation.current &&
      currentLocation.pathname !== nextLocation.pathname,
  )
  function markDirty() {
    allowNavigation.current = false
    setDirty(true)
  }
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('Leave without saving your quiz changes?'))
      blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (id === 'new') return
    let alive = true
    Promise.all([
      client
        .from('quizzes')
        .select('*,game_sessions(count)')
        .eq('id', id)
        .single(),
      client.from('questions').select('*').eq('quiz_id', id).order('position'),
    ]).then(([q, items]) => {
      if (!alive) return
      if (q.error || items.error)
        setError('Unable to open this quiz. Check access and reload.')
      else {
        setQuiz(q.data)
        setHosted(q.data.game_sessions[0].count > 0)
        setQuestions(items.data)
      }
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [client, id])
  useEffect(() => {
    const warn = (event) => {
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
  function updateQuiz(patch) {
    setQuiz((q) => ({ ...q, ...patch }))
    markDirty()
  }
  function updateQuestion(index, patch) {
    setQuestions((items) =>
      items.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    )
    markDirty()
  }
  function move(index, direction) {
    setQuestions((items) => {
      const next = [...items]
      ;[next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ]
      return next
    })
    markDirty()
  }
  async function save(event) {
    event.preventDefault()
    const invalid = validateQuiz(quiz, questions)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data, error } = await client.rpc('save_quiz', {
        p_id: id === 'new' ? null : id,
        p_revision: quiz.revision ?? null,
        p_quiz: quiz,
        p_questions: questions,
      })
      if (error)
        throw new Error(
          error.message === 'STALE_VERSION'
            ? 'This quiz was changed in another tab. Reload before editing again.'
            : error.message,
        )
      allowNavigation.current = true
      setDirty(false)
      setQuiz((q) => ({ ...q, revision: (q.revision ?? 0) + 1 }))
      navigate(`/teacher/quizzes/${data}`, { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <main>
        <p role="status">Loading quiz…</p>
      </main>
    )
  return (
    <main className="wide">
      <p className="grasp-eyebrow">Quiz builder</p>
      <h1>{id === 'new' ? 'What will you explore?' : quiz.title}</h1>
      <p>
        {hosted
          ? 'This quiz has been hosted. Duplicate it from your dashboard to change questions.'
          : 'Four choices. One answer. Space to explain why.'}
      </p>
      <form onSubmit={save} className="stack" aria-busy={busy}>
        <fieldset
          disabled={hosted || busy || (!!error && !quiz.title && id !== 'new')}
          className="stack"
        >
          <section className="grasp-card stack">
            <label>
              Quiz title
              <input
                required
                maxLength={200}
                value={quiz.title}
                onChange={(e) => updateQuiz({ title: e.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={5000}
                value={quiz.description || ''}
                onChange={(e) => updateQuiz({ description: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Feedback timing
                <select
                  value={quiz.feedback_mode}
                  onChange={(e) =>
                    updateQuiz({ feedback_mode: e.target.value })
                  }
                >
                  <option value="instant">Instant, after submitting</option>
                  <option value="after_question">After each question</option>
                  <option value="end">End of game</option>
                </select>
              </label>
              <label>
                Game mode
                <select
                  value={quiz.game_mode}
                  onChange={(e) => updateQuiz({ game_mode: e.target.value })}
                >
                  <option value="team">Teams</option>
                  <option value="duel">1v1 · exactly two players</option>
                  <option value="free_for_all">Free for all</option>
                </select>
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={quiz.timer_enabled}
                onChange={(e) =>
                  updateQuiz({ timer_enabled: e.target.checked })
                }
              />{' '}
              Enable question timers (never changes points)
            </label>
          </section>
          {questions.map((q, index) => (
            <section key={q.id || index} className="grasp-card stack">
              <div className="page-heading">
                <h2>Question {index + 1}</h2>
                <div className="actions">
                  <button
                    type="button"
                    aria-label={`Move question ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move question ${index + 1} down`}
                    disabled={index === questions.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuestions((items) =>
                        items.filter((_, i) => i !== index),
                      )
                      markDirty()
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
              <label>
                Prompt
                <textarea
                  required
                  maxLength={5000}
                  value={q.prompt}
                  onChange={(e) =>
                    updateQuestion(index, { prompt: e.target.value })
                  }
                />
              </label>
              <fieldset className="stack">
                <legend>Choices · select the correct answer</legend>
                {q.choices.map((choice, c) => (
                  <div className="choice-editor" key={c}>
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      aria-label={`Choice ${c + 1} is correct for question ${index + 1}`}
                      checked={q.correct_index === c}
                      onChange={() =>
                        updateQuestion(index, { correct_index: c })
                      }
                    />
                    <label>
                      Choice {c + 1}
                      <input
                        required
                        maxLength={1000}
                        value={choice}
                        onChange={(e) =>
                          updateQuestion(index, {
                            choices: q.choices.map((v, i) =>
                              i === c ? e.target.value : v,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
              </fieldset>
              <label>
                Explanation
                <textarea
                  maxLength={5000}
                  value={q.explanation}
                  onChange={(e) =>
                    updateQuestion(index, { explanation: e.target.value })
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  Points for a correct answer
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    required
                    value={q.points}
                    onChange={(e) =>
                      updateQuestion(index, { points: Number(e.target.value) })
                    }
                  />
                </label>
                {quiz.timer_enabled && (
                  <label>
                    Time limit (seconds)
                    <input
                      type="number"
                      min={5}
                      max={600}
                      required
                      value={q.time_limit_seconds ?? 30}
                      onChange={(e) =>
                        updateQuestion(index, {
                          time_limit_seconds: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                )}
              </div>
            </section>
          ))}
          <button
            type="button"
            disabled={questions.length >= 100}
            onClick={() => {
              setQuestions((q) => [...q, emptyQuestion()])
              markDirty()
            }}
          >
            Add question +
          </button>
        </fieldset>
        {error && (
          <p role="alert" className="grasp-error">
            {error}
          </p>
        )}
        <div className="actions sticky-save">
          {!hosted && (
            <button className="grasp-button" disabled={busy}>
              {busy
                ? 'Saving…'
                : dirty || id === 'new'
                  ? 'Save quiz'
                  : 'Saved ✓'}
            </button>
          )}
          <Link to="/teacher">Back to quizzes</Link>
        </div>
      </form>
    </main>
  )
}
