import { io } from 'socket.io-client'
import { createDemoStudentClient } from './demoStudentClient.js'
import { createSocketStudentClient } from './socketStudentClient.js'
import { getSupabase } from '../../../lib/supabase.js'
import { createStudentAuth } from '../../../lib/studentAuth.js'
import { authenticatedSocket } from '../../../lib/authenticatedSocket.js'

export function createStudentClient(env) {
  if (env.DEV && env.VITE_STUDENT_DEMO === 'true')
    return createDemoStudentClient()
  const url = env.VITE_GAME_SERVER_URL
  if (
    !url ||
    !env.VITE_SUPABASE_URL ||
    !env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith('sb_secret_')
  ) {
    return {
      mode: 'unconfigured',
      async join() {
        throw new Error(
          'The game server is not configured yet. Please try again later.',
        )
      },
      leave() {},
      subscribeLobby() {
        return () => {}
      },
      subscribeConnection(listener) {
        listener('unconfigured')
        return () => {}
      },
    }
  }
  const socket = io(url, { autoConnect: false })
  const supabase = getSupabase(env)
  const client = createSocketStudentClient(socket)
  const authErrors = new Set()
  // The provider owns this connection's lifecycle, including React StrictMode cleanup.
  return {
    ...client,
    ...authenticatedSocket(
      socket,
      createStudentAuth(supabase),
      supabase.auth,
      () => authErrors.forEach((listener) => listener('error')),
    ),
    subscribeConnection(listener) {
      authErrors.add(listener)
      const unsubscribe = client.subscribeConnection(listener)
      return () => {
        authErrors.delete(listener)
        unsubscribe()
      }
    },
  }
}
