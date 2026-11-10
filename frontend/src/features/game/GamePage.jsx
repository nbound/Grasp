import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { openGameSocket, emit } from '../../lib/gameSocket.js'
import { downloadResults } from '../../lib/api.js'

function Countdown({ deadline, serverNow }) {
  const [remaining, setRemaining] = useState(null)
  useEffect(() => {
    const delta = Date.parse(serverNow) - Date.now()
    const update = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((Date.parse(deadline) - Date.now() - delta) / 1000),
        ),
      )
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [deadline, serverNow])
  return (
    <p role="timer" aria-label="Seconds remaining">
      {remaining ?? '…'} seconds remaining
    </p>
  )
}
function Scores({ state }) {
  const rows = state.mode === 'team' ? state.teamScores : state.leaderboard
  if (!rows.length) return <p>Scores will appear when feedback is released.</p>
  return (
    <section className="grasp-card">
      <h2>{state.mode === 'team' ? 'Team scoreboard' : 'Leaderboard'}</h2>
      <ol className="scoreboard">
        {rows.map((row) => (
          <li key={row.id}>
            <span>
              #{row.rank} {row.name || row.nickname}
            </span>
            <strong>{row.score.toLocaleString()} pts</strong>
          </li>
        ))}
      </ol>
      <p className="grasp-muted">
        Equal scores share a rank. Speed never changes points.
      </p>
    </section>
  )
}
export function GamePage() {
  const { sessionId } = useParams()
  return <Game key={sessionId} sessionId={sessionId} />
}
function Game({ sessionId }) {
  const connection = useRef(null)
  const [state, setState] = useState(null),
    [status, setStatus] = useState('connecting'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(true),
    audio = useRef(null),
    played = useRef('')
  useEffect(() => {
    const { socket, close } = openGameSocket()
    connection.current = socket
    let alive = true
    const accept = (value) => {
      if (alive)
        setState((old) =>
          !old || value.revision >= old.revision ? value : old,
        )
    }
    const sync = async () => {
      try {
        const reply = await emit(socket, 'game_sync', { sessionId })
        accept(reply.state)
        if (alive) {
          setStatus('connected')
          setError('')
        }
      } catch (e) {
        if (alive) setError(e.message)
      }
    }
    socket.on('connect', sync)
    socket.on('disconnect', () => {
      if (alive) setStatus('reconnecting')
    })
    socket.on('connect_error', () => {
      if (alive) setStatus('reconnecting')
    })
    socket.on('game_update', accept)
    socket.connect()
    const resync = setInterval(() => {
      if (socket.connected) void sync()
    }, 15000)
    return () => {
      alive = false
      clearInterval(resync)
      connection.current = null
      close()
    }
  }, [sessionId])
  useEffect(() => {
    const key = `${state?.question?.id}:${state?.feedback?.correct}`
    if (
      !state?.feedback ||
      muted ||
      state.isHost ||
      played.current === key ||
      !audio.current
    )
      return
    played.current = key
    const context = audio.current,
      oscillator = context.createOscillator(),
      gain = context.createGain()
    oscillator.frequency.value = state.feedback.correct ? 660 : 220
    gain.gain.setValueAtTime(0.05, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.2)
  }, [state, muted])
  useEffect(
    () => () => {
      void audio.current?.close()
    },
    [],
  )
  async function command(action, extra = {}) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await emit(connection.current, `game_${action}`, {
        sessionId,
        revision: state.revision,
        ...extra,
      })
      const { state: next } = await emit(connection.current, 'game_sync', {
        sessionId,
      })
      setState((old) => (next.revision >= old.revision ? next : old))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  async function download() {
    try {
      await downloadResults(sessionId)
    } catch (e) {
      setError(e.message)
    }
  }
  const disabled = busy || status !== 'connected'
  return (
    <main
      className={`wide ${state?.feedback && !state.isHost ? (state.feedback.correct ? 'feedback-correct' : 'feedback-incorrect') : ''}`}
    >
      <div className="page-heading">
        <p role="status">
          {status === 'connected'
            ? '● Connected'
            : 'Reconnecting… Your saved answers are safe.'}
        </p>
        <button
          aria-pressed={!muted}
          onClick={() => {
            if (muted) {
              audio.current ||= new AudioContext()
              void audio.current.resume()
            }
            setMuted((v) => !v)
          }}
        >
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </div>
      {error && (
        <p className="grasp-error" role="alert">
          {error}
        </p>
      )}
      {!state && (
        <p>
          Restoring your game… <Link to="/join">Back to join</Link>
        </p>
      )}
      {state && (
        <>
          <p className="grasp-eyebrow">
            {state.mode.replaceAll('_', ' ')} · {state.title}
          </p>
          {state.phase === 'lobby' ? (
            <>
              <h1>
                {state.isHost
                  ? 'Bring everyone together.'
                  : 'You’re in. Get ready to learn.'}
              </h1>
              <p>
                Join at <strong>{window.location.origin}/join</strong>
              </p>
              <p
                className="game-pin"
                aria-label={`Game PIN ${state.pin.split('').join(' ')}`}
              >
                {state.pin}
              </p>
              <p>
                {state.players.filter((p) => p.connected).length} connected ·{' '}
                {state.players.length} joined
              </p>
              {!state.isHost && (
                <p>
                  You are{' '}
                  <strong>
                    {
                      state.players.find((p) => p.id === state.playerId)
                        ?.nickname
                    }
                  </strong>
                  , on {state.teams.find((t) => t.id === state.teamId)?.name}.
                </p>
              )}
              <div className="quiz-grid">
                {state.teams.map((team) => (
                  <section key={team.id} className="grasp-card">
                    <h2>{team.name}</h2>
                    <ul>
                      {state.players
                        .filter((p) => p.teamId === team.id)
                        .map((p) => (
                          <li key={p.id}>
                            {p.nickname}{' '}
                            <span className="grasp-muted">
                              {p.connected ? '· ready' : '· disconnected'}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="progress-heading">
                <label htmlFor="game-progress">
                  Question{' '}
                  {Math.min(state.questionIndex + 1, state.questionCount)} of{' '}
                  {state.questionCount}
                </label>
                <span>
                  {state.feedback && !state.isHost
                    ? `✦ ${state.feedback.streak} answer streak`
                    : ''}
                </span>
              </div>
              <progress
                id="game-progress"
                max={state.questionCount}
                value={
                  state.phase === 'results'
                    ? state.questionCount
                    : state.questionIndex + 1
                }
              />
              {state.phase !== 'results' && state.question && (
                <>
                  <h1>{state.question.prompt}</h1>
                  {state.deadline && (
                    <Countdown
                      deadline={state.deadline}
                      serverNow={state.serverNow}
                    />
                  )}
                  {state.isHost ? (
                    <section className="grasp-card">
                      <p role="status">
                        {state.answerCount} of {state.players.length} answered
                      </p>
                      <ol>
                        {state.question.choices.map((choice, i) => (
                          <li key={i}>
                            {choice}
                            {state.distribution
                              ? ` — ${state.distribution[i]} answers`
                              : ''}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : (
                    <div className="answer-grid">
                      {state.question.choices.map((choice, i) => (
                        <button
                          className={`answer-option ${state.selectedIndex === i ? 'selected' : ''}`}
                          key={i}
                          disabled={
                            disabled ||
                            state.submitted ||
                            state.phase !== 'question'
                          }
                          onClick={() =>
                            command('answer', {
                              questionId: state.question.id,
                              choice: i,
                              requestId: crypto.randomUUID(),
                            })
                          }
                        >
                          <span>{String.fromCharCode(65 + i)}</span>
                          {choice}
                          {state.selectedIndex === i && ' ✓ Selected'}
                        </button>
                      ))}
                    </div>
                  )}
                  {state.submitted && !state.feedback && (
                    <p role="status">
                      Answer saved. Feedback will appear{' '}
                      {state.feedbackMode === 'end'
                        ? 'at the end of the game'
                        : 'when your teacher reveals the answer'}
                      .
                    </p>
                  )}
                  {state.feedback && (
                    <section className="grasp-card feedback" role="status">
                      <h2>
                        {state.isHost
                          ? 'Answer revealed'
                          : state.feedback.correct
                            ? '✓ Correct! Keep growing.'
                            : state.submitted
                              ? '↗ A chance to learn.'
                              : '— No answer submitted.'}
                      </h2>
                      <p>
                        <strong>
                          {state.question.choices[state.feedback.correctIndex]}
                        </strong>
                      </p>
                      <p>{state.feedback.explanation}</p>
                      {!state.isHost && <p>+{state.feedback.points} points</p>}
                    </section>
                  )}
                </>
              )}
              {['feedback', 'results'].includes(state.phase) && (
                <Scores state={state} />
              )}
              {state.phase === 'results' && (
                <>
                  <h1>Look how much you explored.</h1>
                  <p>
                    Game complete. Review the explanations and keep learning.
                  </p>
                  <button onClick={download}>
                    Download {state.isHost ? 'class' : 'my'} CSV
                  </button>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Question</th>
                          <th>Answer</th>
                          <th>Correct answer</th>
                          <th>Points</th>
                          <th>Attempts</th>
                          <th>Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.results.map((row) => (
                          <tr key={`${row.playerId}:${row.questionId}`}>
                            <td>{row.name}</td>
                            <td>
                              {row.question}
                              <details>
                                <summary>Explanation</summary>
                                {row.explanation}
                              </details>
                            </td>
                            <td>{row.answer || 'Not answered'}</td>
                            <td>{row.correctAnswer}</td>
                            <td>{row.points}</td>
                            <td>{row.attempts}</td>
                            <td>
                              {row.responseMs === null
                                ? '—'
                                : `${(row.responseMs / 1000).toFixed(1)}s`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Link to={state.isHost ? '/teacher/sessions' : '/study'}>
                    Continue to{' '}
                    {state.isHost ? 'session history' : 'my study space'} →
                  </Link>
                </>
              )}
            </>
          )}
          {state.isHost && state.phase !== 'results' && (
            <div className="actions sticky-save">
              {state.phase === 'lobby' && (
                <button
                  className="grasp-button"
                  disabled={disabled}
                  onClick={() => command('start')}
                >
                  Start game
                </button>
              )}
              {state.phase === 'question' && (
                <button
                  className="grasp-button"
                  disabled={disabled}
                  onClick={() => command('reveal')}
                >
                  Lock answers & reveal
                </button>
              )}
              {state.phase === 'feedback' && (
                <button
                  className="grasp-button"
                  disabled={disabled}
                  onClick={() => command('next')}
                >
                  {state.questionIndex + 1 === state.questionCount
                    ? 'Finish game'
                    : 'Next question'}
                </button>
              )}
              <button
                disabled={disabled}
                onClick={() => {
                  if (window.confirm('End this game and show final results?'))
                    void command('end')
                }}
              >
                End game
              </button>
            </div>
          )}
        </>
      )}
    </main>
  )
}
