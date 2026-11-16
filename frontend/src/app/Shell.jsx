import { AmbientGeometry } from '../components/ui/AmbientGeometry.jsx'
import { Link, Outlet, Navigate, useLocation, useNavigate } from 'react-router'
import { Suspense, useState } from 'react'
import { useAuth } from './AuthContext.js'
export function Shell() {
  const { session, teacher, client, error: authError } = useAuth(),
    navigate = useNavigate()
  const [error, setError] = useState('')
  const { pathname } = useLocation()
  const gameplay =
    pathname.startsWith('/play/') || pathname.startsWith('/teacher/host/')
  async function logout() {
    const result = await client.auth.signOut()
    if (result.error) {
      setError(result.error.message)
      return
    }
    localStorage.removeItem('grasp:last-game')
    navigate('/join')
  }
  const navigation = (
    <>
      <Link to="/join">Join a Game</Link>
      {teacher && (
        <>
          <Link to="/teacher">My Quizzes</Link>
          <Link to="/teacher/sessions">Sessions</Link>
        </>
      )}
      <Link to="/study">Study Space</Link>
      {session ? (
        <button onClick={logout}>Sign Out</button>
      ) : (
        <Link to="/login">Sign In</Link>
      )}
    </>
  )
  return (
    <div className={`grasp-app ${gameplay ? 'gameplay-shell' : ''}`}>
      <AmbientGeometry />
      <a className="skip-link" href="#content">
        Skip to Content
      </a>
      <header>
        <Link className="grasp-brand" to="/join">
          grasp ✳
        </Link>
        {!gameplay && (
          <nav className="actions desktop-nav" aria-label="Main navigation">
            {navigation}
          </nav>
        )}
        <details
          key={pathname}
          className={gameplay ? 'game-menu' : 'game-menu mobile-menu'}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary').focus()
            }
          }}
        >
          <summary>Menu</summary>
          <nav
            className="actions"
            aria-label="Main navigation"
            onClick={(event) => {
              if (event.target.closest('a, button'))
                event.currentTarget.closest('details').open = false
            }}
          >
            {navigation}
          </nav>
        </details>
      </header>
      <div id="content">
        {(error || authError) && (
          <p role="alert" className="grasp-error">
            {error || authError}
          </p>
        )}
        <Suspense
          fallback={
            <main>
              <p role="status">Loading your page…</p>
            </main>
          }
        >
          <Outlet />
        </Suspense>
      </div>
      <footer>Grasp · Your Knowledge. Your Team. Your Next Win.</footer>
    </div>
  )
}
export function ProtectedRoute({ teacher = false }) {
  const auth = useAuth(),
    location = useLocation()
  if (auth.loading)
    return (
      <main>
        <p role="status">Restoring your account…</p>
      </main>
    )
  if (!auth.client)
    return (
      <main>
        <h1>Connect Your Classroom</h1>
        <p>
          Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
          frontend/.env.local, then restart the frontend.
        </p>
      </main>
    )
  if (!auth.session || (teacher && auth.session.user.is_anonymous))
    return (
      <Navigate
        to={teacher ? '/login?role=teacher' : '/login'}
        state={{ from: location.pathname }}
        replace
      />
    )
  if (teacher && !auth.teacher)
    return (
      <main>
        <h1>Teacher Access Required</h1>
        <p>
          This account has student access. A teacher invitation is required to
          create and host quizzes.
        </p>
        <Link to="/teacher-enrollment">Enter Teacher Invitation</Link>
      </main>
    )
  return <Outlet />
}
