import { io } from 'socket.io-client'
import { getSupabase } from './supabase.js'
import { serverUrl, readable } from './api.js'

export function openGameSocket() {
  const client = getSupabase()
  const socket = io(serverUrl, {
    autoConnect: false,
    auth: async (callback) => {
      try {
        const { data } = await client.auth.getSession()
        if (active) callback({ accessToken: data.session?.access_token || '' })
      } catch {
        if (active) callback({ accessToken: '' })
      }
    },
  })
  const subscription = client.auth.onAuthStateChange((event) => {
    if (['TOKEN_REFRESHED', 'SIGNED_IN'].includes(event))
      setTimeout(() => {
        if (active) socket.disconnect().connect()
      })
    if (event === 'SIGNED_OUT') socket.disconnect()
  }).data.subscription
  let active = true
  return {
    socket,
    close: () => {
      active = false
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
