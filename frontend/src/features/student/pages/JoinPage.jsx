import { useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { Button } from '../../../components/ui/Button.jsx'
import { Card } from '../../../components/ui/Card.jsx'
import { TextInput } from '../../../components/ui/TextInput.jsx'
import { useStudent } from '../StudentContext.js'
import { validateJoin } from '../model/joinValidation.js'

export function JoinPage() {
  const { join, joining, error, session, mode, connection } = useStudent()
  const [values, setValues] = useState({ pin: '', nickname: '' })
  const [errors, setErrors] = useState({})
  const form = useRef(null)
  const navigate = useNavigate()
  if (session) return <Navigate to="/lobby" replace />

  async function submit(event) {
    event.preventDefault()
    if (joining) return
    const result = validateJoin(values)
    setErrors(result.errors)
    if (!result.valid) {
      form.current.elements.namedItem(Object.keys(result.errors)[0])?.focus()
      return
    }
    if (await join(result.values)) navigate('/lobby')
  }

  return (
    <main>
      <p className="grasp-eyebrow">A little review. A lot of discovery.</p>
      <h1>
        Find your team.
        <br />
        Grow what you know.
      </h1>
      <p className="grasp-muted">
        Join your class with a PIN. No account, no countdown—just room to learn
        together.
      </p>
      {mode === 'demo' && (
        <p className="grasp-note">
          Demo mode · Use PIN <strong>123456</strong>. This lobby runs only in
          this browser.
        </p>
      )}
      <Card aria-labelledby="join-title">
        <h2 id="join-title">Join a game</h2>
        <form ref={form} onSubmit={submit} noValidate aria-busy={joining}>
          <TextInput
            id="pin"
            name="pin"
            label="Game PIN"
            hint="Your teacher will share a 6-digit code."
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={values.pin}
            onChange={(event) =>
              setValues({ ...values, pin: event.target.value })
            }
            error={errors.pin}
          />
          <TextInput
            id="nickname"
            name="nickname"
            label="Your nickname"
            hint="Pick a name your class will recognize."
            autoComplete="nickname"
            value={values.nickname}
            onChange={(event) =>
              setValues({ ...values, nickname: event.target.value })
            }
            error={errors.nickname}
          />
          {error && (
            <p role="alert" className="grasp-error">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={
              joining || (mode === 'live' && connection !== 'connected')
            }
          >
            {joining ? 'Joining…' : 'Join your team →'}
          </Button>
        </form>
      </Card>
      <p className="grasp-muted">
        Questions move at your teacher’s pace. Take the time you need.
      </p>
    </main>
  )
}
