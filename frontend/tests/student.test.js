import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJoin } from '../src/features/student/model/joinValidation.js'
import { applyLobby, parseLobby } from '../src/features/student/model/lobby.js'
import { createDemoStudentClient } from '../src/features/student/services/demoStudentClient.js'
import { createSocketStudentClient } from '../src/features/student/services/socketStudentClient.js'

const lobby = {
  sessionId: 'session-1',
  pin: '012345',
  status: 'lobby',
  teams: [{ id: 'a', name: 'Team A' }],
  players: [{ id: 'p1', nickname: 'Nate', teamId: 'a' }],
}

function fakeSocket(reply) {
  const listeners = new Map()
  return {
    connected: true,
    calls: [],
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(listener)
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    broadcast(event, value) {
      for (const listener of listeners.get(event) || []) listener(value)
    },
    count(event) {
      return listeners.get(event)?.size || 0
    },
    timeout(ms) {
      this.timeoutMs = ms
      return this
    },
    emit(event, payload, ack) {
      this.calls.push({ event, payload })
      if (ack) ack(reply?.error, reply?.value)
    },
  }
}

test('join preserves leading-zero PINs and trims the nickname', () => {
  assert.deepEqual(validateJoin({ pin: ' 012345 ', nickname: ' Nate ' }), {
    valid: true,
    errors: {},
    values: { pin: '012345', nickname: 'Nate' },
  })
})

test('invalid PINs and nicknames produce field-specific errors', () => {
  for (const pin of ['12345', '1234567', '12e345', '', 123456]) {
    assert.ok(validateJoin({ pin, nickname: 'Nate' }).errors.pin)
  }
  for (const nickname of ['', ' ', 'a', 'a'.repeat(25), 'Na\u0000te', '😀']) {
    assert.ok(validateJoin({ pin: '123456', nickname }).errors.nickname)
  }
  assert.equal(validateJoin({ pin: '123456', nickname: '林同学' }).valid, true)
})

test('lobby boundary rejects inconsistent team membership and duplicate IDs', () => {
  assert.throws(() => parseLobby({ ...lobby, pin: 123456 }))
  assert.throws(() =>
    parseLobby({
      ...lobby,
      players: [{ ...lobby.players[0], teamId: 'missing' }],
    }),
  )
  assert.throws(() =>
    parseLobby({ ...lobby, players: [...lobby.players, ...lobby.players] }),
  )
  assert.throws(() =>
    parseLobby({ ...lobby, teams: [...lobby.teams, ...lobby.teams] }),
  )
})

test('lobby boundary copies only public fields', () => {
  const parsed = parseLobby({ ...lobby, token: 'private', answers: [1] })
  assert.deepEqual(parsed, lobby)
  parsed.players[0].nickname = 'Other'
  assert.equal(lobby.players[0].nickname, 'Nate')
})

test('lobby updates count players using the server snapshot', () => {
  const session = { playerId: 'p1', lobby }
  const update = {
    ...lobby,
    players: [...lobby.players, { id: 'p2', nickname: 'Sam', teamId: 'a' }],
  }
  assert.equal(applyLobby(session, update).lobby.players.length, 2)
  assert.equal(applyLobby(session, { ...lobby, sessionId: 'other' }), session)
  assert.equal(applyLobby(session, { ...lobby, players: [] }), null)
  assert.equal(applyLobby(null, update), null)
})

test('socket join sends the draft contract and accepts confirmed membership', async () => {
  const socket = fakeSocket({
    value: { ok: true, data: { playerId: 'p1', lobby } },
  })
  const client = createSocketStudentClient(socket, { timeoutMs: 100 })
  assert.deepEqual(await client.join({ pin: '012345', nickname: ' Nate ' }), {
    playerId: 'p1',
    lobby,
  })
  assert.deepEqual(socket.calls, [
    { event: 'player_join', payload: { pin: '012345', nickname: 'Nate' } },
  ])
  assert.equal(socket.timeoutMs, 100)
})

test('socket join maps invalid PIN and duplicate nickname errors', async () => {
  for (const [code, message] of [
    ['BAD_PIN', /could not be found/],
    ['DUPLICATE_NICKNAME', /already taken/],
  ]) {
    const client = createSocketStudentClient(
      fakeSocket({ value: { ok: false, error: { code } } }),
    )
    await assert.rejects(
      client.join({ pin: '012345', nickname: 'Nate' }),
      message,
    )
  }
})

test('socket join handles a timeout and malformed acknowledgements', async () => {
  const values = { pin: '012345', nickname: 'Nate' }
  await assert.rejects(
    createSocketStudentClient(fakeSocket({ error: new Error('timeout') })).join(
      values,
    ),
    /did not confirm/,
  )
  for (const data of [
    null,
    { playerId: 'unknown', lobby },
    { playerId: 'p1', lobby: { ...lobby, pin: '654321' } },
  ]) {
    await assert.rejects(
      createSocketStudentClient(fakeSocket({ value: { ok: true, data } })).join(
        values,
      ),
      /unexpected lobby/,
    )
  }
})

test('disconnected and invalid joins never emit or enter the offline queue', async () => {
  const socket = fakeSocket()
  const client = createSocketStudentClient(socket)
  await assert.rejects(client.join({ pin: '', nickname: '' }), /Check your PIN/)
  socket.connected = false
  await assert.rejects(
    client.join({ pin: '012345', nickname: 'Nate' }),
    /disconnected/,
  )
  assert.equal(socket.calls.length, 0)
})

test('lobby subscriptions ignore malformed snapshots and remove only their own listeners', () => {
  const socket = fakeSocket()
  const client = createSocketStudentClient(socket)
  let count = 0
  const offA = client.subscribeLobby(() => count++)
  const offB = client.subscribeLobby(() => count++)
  socket.broadcast('lobby_update', { invalid: true })
  assert.equal(count, 0)
  socket.broadcast('lobby_update', lobby)
  assert.equal(count, 2)
  offA()
  socket.broadcast('lobby_update', lobby)
  assert.equal(count, 3)
  offB()
  assert.equal(socket.count('lobby_update'), 0)
})

test('connection subscriptions report errors and clean up', () => {
  const socket = fakeSocket()
  const statuses = []
  const off = createSocketStudentClient(socket).subscribeConnection((status) =>
    statuses.push(status),
  )
  socket.broadcast('disconnect')
  socket.broadcast('connect')
  socket.broadcast('connect_error')
  assert.deepEqual(statuses, [
    'connected',
    'disconnected',
    'connected',
    'error',
  ])
  off()
  for (const event of ['connect', 'disconnect', 'connect_error'])
    assert.equal(socket.count(event), 0)
})

test('a new socket begins connecting without falsely reporting a lost connection', () => {
  const socket = fakeSocket()
  socket.connected = false
  const statuses = []
  createSocketStudentClient(socket).subscribeConnection((status) =>
    statuses.push(status),
  )
  assert.deepEqual(statuses, ['connecting'])
})

test('leave uses socket identity and emits nothing when disconnected', () => {
  const socket = fakeSocket()
  const client = createSocketStudentClient(socket)
  client.leave()
  socket.connected = false
  client.leave()
  assert.deepEqual(socket.calls, [{ event: 'player_left', payload: {} }])
})

test('demo requires its fixture PIN and never invents other players', async () => {
  const client = createDemoStudentClient()
  assert.equal(client.mode, 'demo')
  await assert.rejects(
    client.join({ pin: '654321', nickname: 'Nate' }),
    /123456/,
  )
  const joined = await client.join({ pin: '123456', nickname: ' Nate ' })
  assert.equal(joined.lobby.players.length, 1)
  assert.equal(joined.lobby.players[0].nickname, 'Nate')
  assert.equal(joined.lobby.players[0].id, joined.playerId)
})
