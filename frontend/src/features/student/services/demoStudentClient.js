import { validateJoin } from '../model/joinValidation.js'

// A single-browser fixture, explicitly enabled. No server or cross-tab synchronization.
export function createDemoStudentClient() {
  return {
    mode: 'demo',
    async join(values) {
      const result = validateJoin(values)
      if (!result.valid) throw new Error('Check your PIN and nickname.')
      if (result.values.pin !== '123456')
        throw new Error('For the demo, use PIN 123456.')
      return {
        playerId: 'demo-player',
        lobby: {
          sessionId: 'demo-session',
          pin: '123456',
          status: 'lobby',
          teams: [{ id: 'fern', name: 'Team Fern' }],
          players: [
            {
              id: 'demo-player',
              nickname: result.values.nickname,
              teamId: 'fern',
            },
          ],
        },
      }
    },
    leave() {},
    subscribeLobby() {
      return () => {}
    },
    subscribeConnection(listener) {
      listener('demo')
      return () => {}
    },
  }
}
