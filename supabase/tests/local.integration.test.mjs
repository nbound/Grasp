import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID, randomInt } from 'node:crypto'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Explicit opt-in via npm run test:local. Never reads application .env files.
test('local Supabase Auth, Data API, and concurrent joins', async (t) => {
  const status = JSON.parse(execFileSync('npx', ['--yes', 'supabase', 'status', '-o', 'json'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }))
  const base = new URL(status.API_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Only local Supabase is permitted')
  assert.equal(base.port, '54321')
  const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY
  const adminKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  assert.ok(publicKey && adminKey, 'Local API keys are required')
  const users = []
  const quizzes = []
  const sessions = []
  const run = randomUUID()
  const request = async (path, { method = 'GET', body, token, admin = false } = {}) => {
    const key = admin ? adminKey : publicKey
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' }
    if (token) headers.Authorization = `Bearer ${token}`
    else if (admin && key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
    const response = await fetch(new URL(path, base), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const text = await response.text()
    return { status: response.status, data: text ? JSON.parse(text) : null }
  }
  const ok = (result) => {
    assert.ok(result.status >= 200 && result.status < 300,
      `HTTP ${result.status}: ${result.data?.message ?? result.data?.msg ?? result.data?.error_description ?? result.data?.code ?? 'request failed'}`)
    return result.data
  }
  const teacher = async (label) => {
    const email = `grasp-${label.toLowerCase().replaceAll(' ', '-')}-${run}@example.test`
    const password = randomUUID() + 'Aa1!'
    const signup = ok(await request('/auth/v1/signup', {
      method: 'POST', body: { email, password, data: { display_name: label } },
    }))
    const id = signup.user?.id ?? signup.id
    assert.ok(id)
    users.push(id)
    // Exercise normal signup, then confirm this local test identity as admin.
    ok(await request(`/auth/v1/admin/users/${id}`, {
      method: 'PUT', admin: true, body: { email_confirm: true },
    }))
    const login = ok(await request('/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password },
    }))
    assert.equal(login.user.is_anonymous, false)
    return { id, token: login.access_token }
  }
  const student = async () => {
    const signup = ok(await request('/auth/v1/signup', { method: 'POST', body: { data: {} } }))
    assert.equal(signup.user.is_anonymous, true)
    users.push(signup.user.id)
    return { id: signup.user.id, token: signup.access_token }
  }
  const quiz = async (owner) => {
    const [created] = ok(await request('/rest/v1/quizzes', {
      method: 'POST', token: owner.token, body: { teacher_id: owner.id, title: `Integration ${run}` },
    }))
    quizzes.push(created.id)
    ok(await request('/rest/v1/questions', {
      method: 'POST', token: owner.token,
      body: { quiz_id: created.id, position: 0, prompt: 'Two plus two?', choices: ['3', '4'], correct_index: 1 },
    }))
    return created.id
  }
  const host = async (owner, quizId, capacity = 40) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = String(randomInt(100000, 1000000))
      const result = await request('/rest/v1/game_sessions', {
        method: 'POST', token: owner.token,
        body: { quiz_id: quizId, host_id: owner.id, join_code: code, max_players: capacity },
      })
      if (result.data?.code === '23505') continue
      const [session] = ok(result)
      sessions.push(session.id)
      return session
    }
    assert.fail('Unable to allocate an unused local join code')
  }
  const join = (who, session, nickname) => request('/rest/v1/rpc/join_game', {
    method: 'POST', token: who.token, body: { p_code: session.join_code, p_nickname: nickname },
  })

  try {
    const a = await teacher('Teacher A')
    const b = await teacher('Teacher B')
    const x = await student()
    const y = await student()
    const qa = await quiz(a)
    const qb = await quiz(b)

    await t.test('real signup provisions profiles and teacher queries remain isolated', async () => {
      for (const [owner, ownQuiz, otherQuiz] of [[a, qa, qb], [b, qb, qa]]) {
        const profiles = ok(await request('/rest/v1/teachers?select=id,display_name', { token: owner.token }))
        assert.deepEqual(profiles.map(p => p.id), [owner.id])
        const data = ok(await request('/rest/v1/quizzes?select=*,questions(count)', { token: owner.token }))
        assert.deepEqual(data.map(q => q.id), [ownQuiz])
        assert.equal(data[0].questions[0].count, 1)
        assert.deepEqual(ok(await request(`/rest/v1/quizzes?id=eq.${otherQuiz}`, {
          method: 'PATCH', token: owner.token, body: { title: 'Forbidden' },
        })), [])
      }
    })

    await t.test('student tokens cannot read questions or write answers and anonymous visitors cannot join', async () => {
      assert.deepEqual(ok(await request('/rest/v1/questions?select=*', { token: x.token })), [])
      const denied = await request('/rest/v1/answers', {
        method: 'POST', token: x.token,
        body: { session_id: randomUUID(), quiz_id: qa, player_id: randomUUID(),
          question_id: randomUUID(), selected_index: 1, is_correct: true, points_awarded: 1000 },
      })
      assert.equal(denied.status, 403)
      assert.equal(denied.data.code, '42501')
      const signedOut = await request('/rest/v1/rpc/join_game', {
        method: 'POST', body: { p_code: '123456', p_nickname: 'Forbidden' },
      })
      assert.ok([401, 403].includes(signedOut.status))
      const invalidToken = await request('/rest/v1/quizzes', { token: 'not-a-valid-jwt' })
      assert.equal(invalidToken.status, 401)
    })

    await t.test('simultaneous joins cannot overfill the last slot', async () => {
      const session = await host(a, qa, 1)
      const results = await Promise.all([join(x, session, 'Alice'), join(y, session, 'Bob')])
      assert.equal(results.filter(r => r.status === 200).length, 1)
      assert.equal(results.filter(r => r.data?.message === 'Game is full').length, 1)
      const players = ok(await request(`/rest/v1/players?session_id=eq.${session.id}`, { token: a.token }))
      assert.equal(players.length, 1)
    })

    await t.test('simultaneous retries by one student create exactly one player', async () => {
      const session = await host(a, qa, 1)
      const results = await Promise.all(Array.from({ length: 8 }, () => join(x, session, 'Alice')))
      const ids = results.map(ok)
      assert.equal(new Set(ids).size, 1)
      const players = ok(await request(`/rest/v1/players?session_id=eq.${session.id}`, { token: a.token }))
      assert.equal(players.length, 1)
    })

    await t.test('simultaneous duplicate nicknames admit only one identity', async () => {
      const session = await host(a, qa)
      const results = await Promise.all([join(x, session, 'Same'), join(y, session, 'same')])
      assert.equal(results.filter(r => r.status === 200).length, 1)
      assert.equal(results.filter(r => r.data?.code === '23505').length, 1)
    })

    await t.test('native RLS permits joined-session reads without recursion or roster leaks', async () => {
      const session = await host(a, qa)
      const player = ok(await join(x, session, 'Alice'))
      ok(await join(y, session, 'Bob'))
      const member = ok(await request(`/rest/v1/game_sessions?id=eq.${session.id}`, { token: x.token }))
      assert.equal(member.length, 1)
      const players = ok(await request(`/rest/v1/players?session_id=eq.${session.id}`, { token: x.token }))
      assert.deepEqual(players.map(p => p.id), [player])
      assert.deepEqual(ok(await request(`/rest/v1/game_sessions?id=eq.${session.id}`, { token: b.token })), [])
    })

    await t.test('joining concurrently with host start leaves a valid state; later joins fail', async () => {
      const session = await host(a, qa)
      const [joining, starting] = await Promise.all([
        join(x, session, 'Alice'),
        request(`/rest/v1/game_sessions?id=eq.${session.id}`, { method: 'PATCH', admin: true, body: { status: 'active' } }),
      ])
      ok(starting)
      assert.ok(joining.status === 200 || joining.data?.message === 'Game not found or unavailable')
      const after = await join(y, session, 'Bob')
      assert.equal(after.data?.message, 'Game not found or unavailable')
      const players = ok(await request(`/rest/v1/players?session_id=eq.${session.id}`, { token: a.token }))
      assert.equal(players.length, joining.status === 200 ? 1 : 0)
    })

    await t.test('server-saved answers are visible only to the player and host; duplicates fail', async () => {
      const session = await host(a, qa)
      const player = ok(await join(x, session, 'Alice'))
      ok(await join(y, session, 'Bob'))
      const [question] = ok(await request(`/rest/v1/questions?quiz_id=eq.${qa}`, { token: a.token }))
      const body = { session_id: session.id, quiz_id: qa, player_id: player,
        question_id: question.id, selected_index: 1, is_correct: true, points_awarded: 1000, response_ms: 1000 }
      const [answer] = ok(await request('/rest/v1/answers', { method: 'POST', admin: true, body }))
      for (const [who, expected] of [[a, 1], [x, 1], [b, 0], [y, 0]]) {
        const visible = ok(await request(`/rest/v1/answers?id=eq.${answer.id}`, { token: who.token }))
        assert.equal(visible.length, expected)
      }
      const duplicate = await request('/rest/v1/answers', { method: 'POST', admin: true, body })
      assert.equal(duplicate.data?.code, '23505')
    })
  } finally {
    // Delete only rows owned by this run, in dependency order; preserve all other local data.
    for (const id of sessions) {
      ok(await request(`/rest/v1/players?session_id=eq.${id}`, { method: 'DELETE', admin: true }))
      ok(await request(`/rest/v1/game_sessions?id=eq.${id}`, { method: 'DELETE', admin: true }))
    }
    for (const id of quizzes) ok(await request(`/rest/v1/quizzes?id=eq.${id}`, { method: 'DELETE', admin: true }))
    for (const id of users) ok(await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', admin: true }))
  }
})
