import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { api, downloadResults } from '../../lib/api.js'
export function History({ teacher = false }) {
  const [sessions, setSessions] = useState(null),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0)
  useEffect(() => {
    let alive = true
    api(`/history${teacher ? '?role=teacher' : ''}`)
      .then((data) => {
        if (alive)
          setSessions(
            teacher
              ? data
              : data.map((p) => ({ ...p.game_sessions, nickname: p.nickname })),
          )
      })
      .catch((e) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [teacher, reload])
  return (
    <section>
      <div className="page-heading">
        <h2>{teacher ? 'Past and active sessions' : 'Your games'}</h2>
        <button
          onClick={() => {
            setError('')
            setReload((x) => x + 1)
          }}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="grasp-error">
          {error}
        </p>
      )}
      {!sessions && !error && <p role="status">Loading history…</p>}
      {sessions?.length === 0 && (
        <p>Join a game to start a learning history.</p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Quiz</th>
              <th>Date</th>
              <th>Status</th>
              <th>{teacher ? 'Participants' : 'Nickname'}</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {sessions?.map((s) => (
              <tr key={s.id}>
                <td>{s.quizzes?.title}</td>
                <td>{new Date(s.created_at).toLocaleString()}</td>
                <td>{s.phase || s.status}</td>
                <td>{teacher ? s.players?.[0]?.count : s.nickname}</td>
                <td>
                  <Link
                    to={teacher ? `/teacher/host/${s.id}` : `/play/${s.id}`}
                  >
                    {s.status === 'finished' ? 'Results' : 'Resume'}
                  </Link>
                  {s.status === 'finished' && (
                    <button
                      onClick={() =>
                        downloadResults(s.id).catch((e) => setError(e.message))
                      }
                    >
                      CSV
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
