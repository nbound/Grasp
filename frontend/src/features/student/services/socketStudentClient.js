import { validateJoin } from '../model/joinValidation.js'
import { parseLobby } from '../model/lobby.js'

const messages = {
  BAD_PIN: 'That game could not be found. Check the PIN with your teacher.',
  DUPLICATE_NICKNAME: 'That nickname is already taken. Try another one.',
  SESSION_CLOSED: 'This game is no longer accepting players.',
  SESSION_FULL: 'This game is full. Check with your teacher.',
  UNAUTHORIZED: 'Your sign-in expired. Reconnect and try again.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  SERVER_BUSY: 'The server is busy. Please try again.',
}

export function createSocketStudentClient(socket, { timeoutMs = 8000 } = {}) {
  return {
    mode: 'live',
    async join(values) {
      const result = validateJoin(values)
      if (!result.valid) throw new Error('Check your PIN and nickname.')
      // Socket.io normally buffers emits while disconnected; joins must not be queued.
      if (!socket.connected)
        throw new Error(
          'The server is disconnected. Wait for a connection and try again.',
        )
      return new Promise((resolve, reject) => {
        socket
          .timeout(timeoutMs)
          .emit('player_join', result.values, (error, reply) => {
            if (error)
              return reject(
                new Error('The server did not confirm your join. Try again.'),
              )
            if (reply?.ok !== true)
              return reject(
                new Error(
                  messages[reply?.error?.code] ||
                    'Unable to join this game. Try again.',
                ),
              )
            try {
              const lobby = parseLobby(reply.data?.lobby)
              const playerId = reply.data?.playerId
              if (
                lobby.pin !== result.values.pin ||
                !lobby.players.some((player) => player.id === playerId)
              ) {
                throw new Error('Invalid join acknowledgement')
              }
              resolve({ playerId, lobby })
            } catch {
              reject(
                new Error(
                  'The server returned an unexpected lobby. Please try again.',
                ),
              )
            }
          })
      })
    },
    leave() {
      // The server identifies membership from the socket, never a supplied player ID.
      if (socket.connected) socket.emit('player_left', {})
    },
    subscribeLobby(listener) {
      const handle = (payload) => {
        try {
          listener(parseLobby(payload))
        } catch {
          /* Ignore malformed broadcasts. */
        }
      }
      socket.on('lobby_update', handle)
      return () => socket.off('lobby_update', handle)
    },
    subscribeConnection(listener) {
      const connected = () => listener('connected')
      const disconnected = () => listener('disconnected')
      const failed = () => listener('error')
      socket.on('connect', connected)
      socket.on('disconnect', disconnected)
      socket.on('connect_error', failed)
      listener(socket.connected ? 'connected' : 'connecting')
      return () => {
        socket.off('connect', connected)
        socket.off('disconnect', disconnected)
        socket.off('connect_error', failed)
      }
    },
  }
}
