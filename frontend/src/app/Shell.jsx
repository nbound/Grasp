import { Link, Outlet, Navigate, useLocation, useNavigate } from 'react-router'
import { Suspense, useState } from 'react'
import { useAuth } from './AuthContext.js'
export function Shell() {
  const { session, teacher, client, error: authError } = useAuth(),
    navigate = useNavigate()
  const [error, setError] = useState('')
  async function logout() {
    const result = await client.auth.signOut()
    if (result.error) {
      setError(result.error.message)
      return
    }
    localStorage.removeItem('grasp:last-game')
    navigate('/join')
  }
  return (
    <div className="grasp-app">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header>
        <Link className="grasp-brand" to="/join">
          grasp ✳
        </Link>
        <nav className="actions" aria-label="Main navigation">
          <Link to="/join">Join a game</Link>
          {teacher && (
            <>
              <Link to="/teacher">My quizzes</Link>
              <Link to="/teacher/sessions">Sessions</Link>
            </>
          )}
          <Link to="/study">Study space</Link>
          {session ? (
            <button onClick={logout}>Sign out</button>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
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
      <footer>Grasp · Learn together, at your pace.</footer>
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
        <h1>Connect your classroom</h1>
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
        <h1>Teacher access required</h1>
        <p>
          This account has student access. A teacher invitation is required to
          create and host quizzes.
        </p>
        <Link to="/teacher-enrollment">Enter teacher invitation</Link>
      </main>
    )
  return <Outlet />
}
