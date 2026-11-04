import { Navigate } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { Card } from '../../../components/ui/Card.jsx'
import { useStudent } from '../StudentContext.js'

export function LobbyPage() {
  const { session, leave, mode } = useStudent()
  if (!session) return <Navigate to="/join" replace />
  const { lobby, playerId } = session
  const player = lobby.players.find((entry) => entry.id === playerId)
  const team = lobby.teams.find((entry) => entry.id === player.teamId)
  return (
    <main>
      <p className="grasp-eyebrow">Game {lobby.pin}</p>
      <h1>You’re in, {player.nickname}.</h1>
      <p className="grasp-muted">
        Settle in. Your teacher will start the first question when everyone is
        ready.
      </p>
      {mode === 'demo' && (
        <p className="grasp-note">
          Demo lobby · Other browsers will not appear here. Gameplay is not
          connected yet.
        </p>
      )}
      <Card aria-labelledby="lobby-title">
        <h2 id="lobby-title">Ready to learn together</h2>
        <dl className="grasp-stats">
          <div>
            <dt>Your team</dt>
            <dd>{team.name}</dd>
          </div>
          <div aria-live="polite" aria-atomic="true">
            <dt>
              {mode === 'demo'
                ? 'Players in this demo'
                : 'Players in the lobby'}
            </dt>
            <dd>{lobby.players.length}</dd>
          </div>
        </dl>
        <h2>In the room</h2>
        <ul className="grasp-roster">
          {lobby.players.map((entry) => (
            <li key={entry.id}>
              <span>
                {entry.nickname}
                {entry.id === playerId ? ' (you)' : ''}
              </span>
              <span className="grasp-muted">
                {lobby.teams.find((item) => item.id === entry.teamId).name}
              </span>
            </li>
          ))}
        </ul>
        <p className="grasp-muted" role="status">
          Waiting for your teacher…
        </p>
        <Button variant="secondary" onClick={leave}>
          Leave lobby
        </Button>
      </Card>
    </main>
  )
}
