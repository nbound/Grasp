import { Link, Navigate, Route, Routes } from 'react-router'
import { StudentProvider } from './StudentProvider.jsx'
import { useStudent } from './StudentContext.js'
import { JoinPage } from './pages/JoinPage.jsx'
import { LobbyPage } from './pages/LobbyPage.jsx'

const labels = {
  demo: 'Demo · local browser',
  connected: 'Connected to game server',
  connecting: 'Connecting…',
  disconnected: 'Server disconnected',
  error: 'Connection unavailable',
  unconfigured: 'Game server not configured',
}

function StudentShell() {
  const { connection } = useStudent()
  return (
    <div className="grasp-app">
      <header>
        <Link className="grasp-brand" to="/join" aria-label="Grasp home">
          grasp<span aria-hidden="true"> ✳</span>
        </Link>
        <span className="grasp-status" role="status">
          {labels[connection]}
        </span>
      </header>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/lobby" element={<LobbyPage />} />
        <Route path="*" element={<Navigate to="/join" replace />} />
      </Routes>
    </div>
  )
}

// Mount under a router. The client is injected so teacher pages can share the same transport later.
export function StudentApp({ client }) {
  return (
    <StudentProvider client={client}>
      <StudentShell />
    </StudentProvider>
  )
}
