import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudentAuth } from '../src/lib/studentAuth.js'
import { authenticatedSocket } from '../src/lib/authenticatedSocket.js'

test('guest sign-in is single-flight and existing sessions are reused', async () => {
  let calls = 0
  let session
  const auth = {
    getSession: async () => ({ data: { session } }),
    signInAnonymously: async () => {
      calls++
      session = { access_token: 'test-token' }
      return { data: { session } }
    },
  }
  const token = createStudentAuth({ auth })
  assert.deepEqual(await Promise.all([token(), token(), token()]), [
    'test-token',
    'test-token',
    'test-token',
  ])
  assert.equal(calls, 1)
  session = { access_token: 'refreshed-token' }
  assert.equal(await token(), 'refreshed-token')
  assert.equal(calls, 1)
})

test('auth failures are sanitized and allow a later retry', async () => {
  const auth = {
    getSession: async () => ({ data: {} }),
    signInAnonymously: async () => ({
      error: { message: 'private detail' },
      data: {},
    }),
  }
  const token = createStudentAuth({ auth })
  await assert.rejects(token(), (error) => !error.message.includes('private'))
  auth.signInAnonymously = async () => ({
    data: { session: { access_token: 'ok' } },
  })
  assert.equal(await token(), 'ok')
})

test('socket cleanup cancels pending authentication and refresh listeners', async () => {
  const replies = []
  let resolve
  let unsubscribed = 0
  const socket = {
    connect() {
      this.auth((value) => replies.push(value))
    },
    disconnect() {},
  }
  const auth = {
    onAuthStateChange: () => ({
      data: {
        subscription: {
          unsubscribe() {
            unsubscribed++
          },
        },
      },
    }),
  }
  const lifecycle = authenticatedSocket(
    socket,
    () =>
      new Promise((done) => {
        resolve = done
      }),
    auth,
  )
  lifecycle.connect()
  lifecycle.disconnect()
  resolve('stale')
  await Promise.resolve()
  assert.deepEqual(replies, [])
  lifecycle.connect()
  resolve('fresh')
  await Promise.resolve()
  assert.deepEqual(replies, [{ accessToken: 'fresh' }])
  lifecycle.disconnect()
  assert.equal(unsubscribed, 2)
})
