import { io } from 'socket.io-client'
import { createDemoStudentClient } from './demoStudentClient.js'
import { createSocketStudentClient } from './socketStudentClient.js'

export function createStudentClient(env) {
  if (env.DEV && env.VITE_STUDENT_DEMO === 'true')
    return createDemoStudentClient()
  const url = env.VITE_GAME_SERVER_URL
  if (!url) {
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
  const client = createSocketStudentClient(socket)
  // The provider owns this connection's lifecycle, including React StrictMode cleanup.
  return {
    ...client,
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
  }
}
