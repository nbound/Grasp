import { io } from 'socket.io-client'
import { getSupabase } from './supabase.js'
import { serverUrl, readable } from './api.js'
import { socketRecovery } from './socketRecovery.js'

export function openGameSocket() {
  const client = getSupabase()
  let active = true,
    currentToken
  const socket = io(serverUrl, {
    autoConnect: false,
    // Avoid abandoned polling requests during page transitions. Retain polling
    // as a fallback for networks that block WebSockets.
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    auth: async (callback) => {
      try {
        const { data } = await client.auth.getSession()
        if (active) {
          currentToken = data.session?.access_token || ''
          callback({ accessToken: currentToken })
        }
      } catch {
        if (active) callback({ accessToken: '' })
      }
    },
  })
  const recovery = socketRecovery(socket)
  const subscription = client.auth.onAuthStateChange((event, session) => {
    if (['TOKEN_REFRESHED', 'SIGNED_IN'].includes(event))
      setTimeout(() => {
        if (active && session?.access_token !== currentToken) recovery.retry()
      })
    if (event === 'SIGNED_OUT') {
      active = false
      recovery.close()
      socket.disconnect()
    }
  }).data.subscription
  return {
    socket,
    retry: recovery.retry,
    close: () => {
      active = false
      recovery.close()
      subscription.unsubscribe()
      socket.disconnect()
    },
  }
}
export function emit(socket, event, payload) {
  if (!socket.connected)
    return Promise.reject(
      new Error('Reconnecting. Wait for the connection before continuing.'),
    )
  return socket
    .timeout(10000)
    .emitWithAck(event, payload)
    .then((reply) => {
      if (!reply?.ok) throw new Error(readable(reply?.error))
      return reply.data
    })
}
export async function withSocket(operation) {
  const connection = openGameSocket()
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Unable to connect to the game server.')),
        10000,
      )
      connection.socket.once('connect', () => {
        clearTimeout(timeout)
        resolve()
      })
      connection.socket.once('connect_error', () => {
        clearTimeout(timeout)
        reject(
          new Error('Unable to connect. Check your sign-in and try again.'),
        )
      })
      connection.socket.connect()
    })
    return await operation(connection.socket)
  } finally {
    connection.close()
  }
}
