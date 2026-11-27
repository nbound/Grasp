import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { socketRecovery } from '../src/lib/socketRecovery.js'

function fixture() {
  const socket = new EventEmitter()
  socket.connected = false
  socket.active = false
  let connections = 0
  socket.connect = () => {
    connections++
    return socket
  }
  socket.disconnect = () => {
    socket.emit('disconnect')
    return socket
  }
  const timers = new Map()
  let id = 0
  const recovery = socketRecovery(
    socket,
    (fn, delay) => {
      timers.set(++id, { fn, delay })
      return id
    },
    (id) => timers.delete(id),
  )
  return {
    socket,
    recovery,
    timers,
    connections: () => connections,
    tick() {
      const [id, timer] = timers.entries().next().value
      timers.delete(id)
      timer.fn()
      return timer.delay
    },
  }
}
test('refused connections retry beyond the rate-limit window, then stop; success resets backoff', () => {
  const f = fixture()
  const delays = []
  for (let i = 0; i < 5; i++) {
    f.socket.emit('connect_error')
    f.socket.emit('connect_error')
    assert.equal(f.timers.size, 1)
    delays.push(f.tick())
  }
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000])
  f.socket.emit('connect_error')
  assert.equal(f.timers.size, 0)
  f.socket.emit('connect')
  f.socket.emit('connect_error')
  assert.equal(f.tick(), 2000)
  f.recovery.close()
})
test('transport retries are not duplicated and disposal prevents later reconnects', () => {
  const f = fixture()
  f.socket.active = true
  f.socket.emit('connect_error')
  assert.equal(f.timers.size, 0)
  f.socket.active = false
  f.socket.emit('disconnect')
  assert.equal(f.timers.size, 1)
  f.recovery.close()
  assert.equal(f.timers.size, 0)
  f.socket.emit('connect_error')
  f.recovery.retry()
  assert.equal(f.connections(), 0)
})
