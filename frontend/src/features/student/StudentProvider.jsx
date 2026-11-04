import { useCallback, useEffect, useRef, useState } from 'react'
import { StudentContext } from './StudentContext.js'
import { applyLobby } from './model/lobby.js'

export function StudentProvider({ client, children }) {
  const [session, setSession] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [error, setError] = useState('')
  const [joining, setJoining] = useState(false)
  const request = useRef(0)

  useEffect(() => {
    const offLobby = client.subscribeLobby((lobby) =>
      setSession((current) => applyLobby(current, lobby)),
    )
    const offConnection = client.subscribeConnection((status) => {
      setConnection(status)
      if (status === 'disconnected' || status === 'error') {
        request.current += 1
        setJoining(false)
        setSession(null)
        setError(
          'Connection lost. When the server reconnects, join again with your PIN.',
        )
      }
    })
    client.connect?.()
    return () => {
      request.current += 1
      offLobby()
      offConnection()
      client.disconnect?.()
    }
  }, [client])

  const join = useCallback(
    async (values) => {
      const attempt = ++request.current
      setError('')
      setJoining(true)
      try {
        const next = await client.join(values)
        if (attempt !== request.current) return false
        setSession(next)
        return true
      } catch (cause) {
        if (attempt === request.current) setError(cause.message)
        return false
      } finally {
        if (attempt === request.current) setJoining(false)
      }
    },
    [client],
  )

  const leave = useCallback(() => {
    request.current += 1
    client.leave()
    setSession(null)
    setJoining(false)
    setError('')
  }, [client])

  return (
    <StudentContext.Provider
      value={{
        session,
        connection,
        error,
        joining,
        join,
        leave,
        mode: client.mode,
      }}
    >
      {children}
    </StudentContext.Provider>
  )
}
