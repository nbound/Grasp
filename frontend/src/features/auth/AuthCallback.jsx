import { Link, Navigate } from 'react-router'
import { useAuth } from '../../app/AuthContext.js'
export function AuthCallback() {
  const { session, teacher, loading } = useAuth()
  if (loading)
    return (
      <main>
        <p role="status">Confirming your sign-in…</p>
      </main>
    )
  if (session) return <Navigate to={teacher ? '/teacher' : '/study'} replace />
  return (
    <main>
      <h1>This sign-in link could not be restored.</h1>
      <p>
        The link may have expired or already been used. Sign in, or request a
        new password reset link.
      </p>
      <nav className="actions">
        <Link to="/login">Sign in</Link>
        <Link to="/auth/recovery">Reset password</Link>
      </nav>
    </main>
  )
}
