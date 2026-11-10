import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../', import.meta.url)
const read = (path) => readFile(new URL(path, root), 'utf8')
const teacherA = '10000000-0000-0000-0000-000000000001'
const teacherB = '10000000-0000-0000-0000-000000000002'
const studentA = '20000000-0000-0000-0000-000000000001'
const studentB = '20000000-0000-0000-0000-000000000002'
const studentC = '20000000-0000-0000-0000-000000000003'
const quizA = '30000000-0000-0000-0000-000000000001'
const quizB = '30000000-0000-0000-0000-000000000002'
const questionA = '40000000-0000-0000-0000-000000000001'
const questionB = '40000000-0000-0000-0000-000000000002'

test('Phase 0 migration, grants, RLS, joins, and relational integrity', async (t) => {
  const db = new PGlite()
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows
  const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0]
  const login = async (id, anonymous = false, role = 'authenticated', extra = {}) => {
    assert.ok(['authenticated', 'anon', 'service_role'].includes(role))
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: id, is_anonymous: anonymous, role, ...extra }),
    ])
    await db.exec(`set local role ${role}`)
  }
  const admin = async () => db.exec('reset role')
  const rejects = async (sql, params, code, message) => {
    await db.exec('savepoint expected_failure')
    try {
      await assert.rejects(db.query(sql, params), (error) => {
        assert.equal(error.code, code, error.message)
        if (message) assert.match(error.message, message)
        return true
      })
    } finally {
      await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure')
    }
  }
  const scenario = (name, fn) => t.test(name, async () => {
    await db.exec('begin')
    try { await fn() } finally { await db.exec('rollback') }
  })
  const host = async (code = '123456', quiz = quizA, owner = teacherA, capacity = 40) => {
    await login(owner)
    return scalar(`insert into public.game_sessions(quiz_id, host_id, join_code, max_players)
      values ($1, $2, $3, $4) returning id`, [quiz, owner, code, capacity])
  }
  const join = async (user = studentA, nickname = 'Alice', code = '123456') => {
    await login(user, true)
    return scalar('select public.join_game($1, $2)', [code, nickname])
  }
  const saveAnswer = async (session, player, quiz = quizA, question = questionA) => {
    await login(null, false, 'service_role')
    return rows(`insert into public.answers(session_id, quiz_id, player_id, question_id,
      selected_index, is_correct, points_awarded, response_ms)
      values ($1, $2, $3, $4, 1, true, 1000, 1200) returning *`, [session, quiz, player, question])
  }

  try {
    await db.exec(await read('tests/auth-shim.sql'))
    const migrations = (await readdir(new URL('migrations/', root))).filter(f => f.endsWith('.sql')).sort()
    assert.ok(migrations.length >= 1)
    const migration = await read(`migrations/${migrations[0]}`)
    // Original migration regression suite; game.test.mjs verifies the full upgrade chain.
    await db.exec(migration)
    await db.exec(await read('seed.sql'))
    await db.exec(await read('seed.sql'))

    await scenario('fresh migration and seed create only permanent teacher profiles', async () => {
      assert.equal(await scalar('select count(*)::int from public.teachers'), 2)
      assert.equal(await scalar('select count(*)::int from public.questions'), 2)
    })

    await scenario('all app tables have RLS; public visitors have no table privileges', async () => {
      const tables = await rows("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")
      assert.equal(tables.length, 7)
      for (const table of tables) {
        assert.equal(table.relrowsecurity, true, table.relname)
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          assert.equal(await scalar('select has_table_privilege($1, $2, $3)', ['anon', `public.${table.relname}`, privilege]), false)
        }
        assert.equal(await scalar('select has_table_privilege($1, $2, $3)', ['authenticated', `public.${table.relname}`, 'TRUNCATE']), false)
      }
    })

    await scenario('private functions and RPC expose only intended execute privileges', async () => {
      const funcs = await rows(`select p.oid, p.proname, p.prosecdef, p.proconfig
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private' or (n.nspname = 'public' and p.proname = 'join_game')`)
      for (const fn of funcs) {
        assert.equal(await scalar("select has_function_privilege('anon', $1::oid, 'EXECUTE')", [fn.oid]), false, fn.proname)
        assert.ok(fn.proconfig.includes('search_path=""'), fn.proname)
      }
      for (const name of ['sync_teacher', 'initialize_session', 'create_teams', 'protect_hosted_questions']) {
        assert.equal(await scalar("select has_function_privilege('authenticated', $1, 'EXECUTE')", [`private.${name}()`]), false)
      }
      assert.equal(await scalar("select has_schema_privilege('authenticated', 'public', 'CREATE')"), false)
      assert.equal(await scalar("select has_schema_privilege('authenticated', 'private', 'CREATE')"), false)
    })

    await scenario('teachers can create/read/update/delete their own unhosted quizzes', async () => {
      await login(teacherA)
      const id = await scalar("insert into public.quizzes(teacher_id,title) values ($1,'New quiz') returning id", [teacherA])
      assert.equal(await scalar('select count(*)::int from public.quizzes'), 2)
      assert.equal((await rows("update public.quizzes set title='Updated' where id=$1 returning id", [id])).length, 1)
      assert.equal((await rows('delete from public.quizzes where id=$1 returning id', [id])).length, 1)
      assert.equal(await scalar('select count(*)::int from public.questions'), 1)
    })

    await scenario('both teachers are isolated for reads, inserts, updates, and deletes', async () => {
      for (const [owner, other, otherQuiz] of [[teacherA, teacherB, quizB], [teacherB, teacherA, quizA]]) {
        await login(owner)
        assert.deepEqual(await rows('select teacher_id from public.quizzes'), [{ teacher_id: owner }])
        await rejects("insert into public.quizzes(teacher_id,title) values ($1,'Forbidden')", [other], '42501')
        assert.equal((await rows("update public.quizzes set title='Forbidden' where id=$1 returning id", [otherQuiz])).length, 0)
        assert.equal((await rows('delete from public.quizzes where id=$1 returning id', [otherQuiz])).length, 0)
        await rejects(`insert into public.questions(quiz_id,position,prompt,choices,correct_index)
          values ($1,1,'Forbidden','["A","B"]',0)`, [otherQuiz], '42501')
      }
    })

    await scenario('anonymous students and missing anonymous claims cannot use teacher APIs', async () => {
      await login(studentA, true, 'authenticated', { user_metadata: { role: 'teacher' } })
      for (const table of ['teachers', 'quizzes', 'questions']) {
        assert.equal(await scalar(`select count(*)::int from public.${table}`), 0)
      }
      await rejects("insert into public.quizzes(teacher_id,title) values ($1,'Forbidden')", [studentA], '42501')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code) values ($1,$2,'987654')", [quizA, teacherA], '42501')
      await login(teacherA, true)
      assert.equal(await scalar('select count(*)::int from public.quizzes'), 0)
      await login(teacherA, undefined, 'authenticated', { is_anonymous: undefined })
      assert.equal(await scalar('select count(*)::int from public.quizzes'), 0)
    })

    await scenario('profile edits cannot change identity, email, ownership, or timestamps', async () => {
      await login(teacherA)
      assert.equal((await rows("update public.teachers set display_name='New name' where id=$1 returning id", [teacherA])).length, 1)
      await rejects("update public.teachers set email='forged@example.test' where id=$1", [teacherA], '42501')
      await rejects('update public.quizzes set teacher_id=$1 where id=$2', [teacherB, quizA], '42501')
      await rejects("insert into public.teachers(id,email) values ($1,'fake@example.test')", [studentA], '42501')
    })

    await scenario('Auth trigger handles signup, metadata limits, email change and anonymous conversion', async () => {
      await db.query(`insert into auth.users(id,email,is_anonymous,raw_user_meta_data)
        values ('10000000-0000-0000-0000-000000000099','new@example.test',false,$1)`,
        [JSON.stringify({ display_name: 'x'.repeat(200), role: 'admin' })])
      assert.equal(await scalar("select char_length(display_name) from public.teachers where email='new@example.test'"), 80)
      await db.query('update auth.users set email=$1 where id=$2', ['updated@example.test', teacherA])
      assert.equal(await scalar('select email from public.teachers where id=$1', [teacherA]), 'updated@example.test')
      await db.query('update auth.users set is_anonymous=false,email=$1 where id=$2', ['converted@example.test', studentA])
      assert.equal(await scalar('select count(*)::int from public.teachers where id=$1', [studentA]), 1)
    })

    await scenario('question validation rejects invalid data and permits transactional reorder', async () => {
      await login(teacherA)
      for (const choices of ['{}', '[]', '["A"]', '["A",null]', '["A",1]', '["A"," "]', JSON.stringify(Array(7).fill('A'))]) {
        await rejects("update public.questions set choices=$1::jsonb where id=$2", [choices, questionA], '23514')
      }
      await rejects('update public.questions set correct_index=4 where id=$1', [questionA], '23514')
      await rejects('update public.questions set position=-1 where id=$1', [questionA], '23514')
      await rejects('update public.questions set points=-1 where id=$1', [questionA], '23514')
      await rejects('update public.questions set time_limit_seconds=0 where id=$1', [questionA], '23514')
      const id = await scalar(`insert into public.questions(quiz_id,position,prompt,choices,correct_index)
        values ($1,1,'Second','["A","B"]',0) returning id`, [quizA])
      await db.exec('set constraints questions_quiz_position_key deferred')
      await db.query('update public.questions set position=1-position where quiz_id=$1', [quizA])
      await db.exec('set constraints questions_quiz_position_key immediate')
      assert.equal(await scalar('select position from public.questions where id=$1', [id]), 0)
    })

    await scenario('host owns the quiz and cannot set server-controlled session fields', async () => {
      await login(teacherA)
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code) values ($1,$2,'111111')", [quizB, teacherA], '23503')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code,status) values ($1,$2,'111111','active')", [quizA, teacherA], '42501')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code) values ($1,$2,'ABCDEF')", [quizA, teacherA], '23514')
      const id = await host()
      assert.equal(await scalar('select count(*)::int from public.teams where session_id=$1', [id]), 2)
      await rejects("update public.game_sessions set status='active' where id=$1", [id], '42501')
      await login(teacherB)
      assert.equal(await scalar('select count(*)::int from public.game_sessions'), 0)
      assert.equal(await scalar('select count(*)::int from public.teams'), 0)
    })

    await scenario('hosted questions are immutable and historical quizzes cannot be deleted', async () => {
      await host()
      await rejects("update public.questions set prompt='Changed' where id=$1", [questionA], '23514', /immutable/)
      await rejects('delete from public.questions where id=$1', [questionA], '23514', /immutable/)
      await rejects(`insert into public.questions(quiz_id,position,prompt,choices,correct_index)
        values ($1,1,'Added','["A","B"]',0)`, [quizA], '23514')
      await rejects('delete from public.quizzes where id=$1', [quizA], '23514', /immutable/)
    })

    await scenario('unauthenticated callers cannot read tables or execute the join RPC', async () => {
      await host()
      await login(null, false, 'anon')
      await rejects('select * from public.quizzes', [], '42501')
      await rejects("select public.join_game('123456','Guest')", [], '42501')
      await login(null)
      await rejects("select public.join_game('123456','Guest')", [], '42501')
    })

    await scenario('valid join trims input, assigns balanced teams and is idempotent at capacity', async () => {
      const session = await host('123456', quizA, teacherA, 2)
      const first = await join(studentA, ' Alice ', ' 123456 ')
      const second = await join(studentB, 'Bob')
      assert.notEqual(first, second)
      assert.equal(await join(studentA, 'Ignored rename'), first)
      await login(teacherA)
      assert.deepEqual(await rows('select nickname,team_number from public.players where session_id=$1 order by nickname', [session]),
        [{ nickname: 'Alice', team_number: 1 }, { nickname: 'Bob', team_number: 2 }])
      await login(studentC, true)
      await rejects("select public.join_game('123456','Charlie')", [], 'P0001', /full/)
    })

    await scenario('joins reject malformed codes, bad nicknames and missing games', async () => {
      await host()
      await login(studentA, true)
      for (const code of [null, '', '12345', '1234567', 'ABCDEF']) {
        await rejects('select public.join_game($1,$2)', [code, 'Alice'], '22023')
      }
      for (const nickname of [null, '', '   ', 'x'.repeat(33), 'A\nB']) {
        await rejects('select public.join_game($1,$2)', ['123456', nickname], '22023')
      }
      await rejects("select public.join_game('999999','Alice')", [], 'P0001', /unavailable/)
    })

    await scenario('duplicate nicknames are case insensitive within a session', async () => {
      await host()
      await join()
      await login(studentB, true)
      await rejects("select public.join_game('123456','alice')", [], '23505', /Nickname/)
      await host('654321', quizB, teacherB)
      assert.ok(await join(studentB, 'alice', '654321'))
    })

    await scenario('expired, active and finished sessions cannot be joined', async () => {
      const session = await host()
      await admin()
      await db.query("update public.game_sessions set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1", [session])
      await login(studentA, true)
      await rejects("select public.join_game('123456','Alice')", [], 'P0001')
      for (const status of ['active', 'finished']) {
        await admin()
        await db.query("update public.game_sessions set status=$1,expires_at=now()+interval '1 day' where id=$2", [status, session])
        await login(studentA, true)
        await rejects("select public.join_game('123456','Alice')", [], 'P0001')
      }
    })

    await scenario('member reads do not recurse and expose only own player and joined session', async () => {
      const session = await host()
      await host('654321', quizB, teacherB)
      const player = await join()
      await join(studentB, 'Bob')
      await login(studentA, true)
      assert.deepEqual(await rows('select id from public.game_sessions'), [{ id: session }])
      assert.deepEqual(await rows('select id from public.players'), [{ id: player }])
      assert.equal(await scalar('select count(*)::int from public.teams'), 2)
      assert.equal(await scalar('select count(*)::int from public.questions'), 0)
      await login(studentC, true)
      for (const table of ['game_sessions', 'players', 'teams', 'answers']) {
        assert.equal(await scalar(`select count(*)::int from public.${table}`), 0)
      }
    })

    await scenario('students cannot forge players, scores, team membership or answers', async () => {
      const session = await host()
      const player = await join()
      await rejects(`insert into public.players(session_id,user_id,nickname,team_number)
        values ($1,$2,'Forged',1)`, [session, studentA], '42501')
      await rejects('update public.players set score=99999 where id=$1', [player], '42501')
      await rejects('update public.players set team_number=2 where id=$1', [player], '42501')
      await rejects(`insert into public.answers(session_id,quiz_id,player_id,question_id,selected_index,is_correct,points_awarded)
        values ($1,$2,$3,$4,1,true,1000)`, [session, quizA, player, questionA], '42501')
      await rejects('delete from public.players where id=$1', [player], '42501')
    })

    await scenario('service writes persist answers; reads are limited to answering player and host', async () => {
      const session = await host()
      const player = await join()
      await join(studentB, 'Bob')
      await saveAnswer(session, player)
      for (const [id, anonymous, count] of [[studentA,true,1],[studentB,true,0],[teacherA,false,1],[teacherB,false,0]]) {
        await login(id, anonymous)
        assert.equal(await scalar('select count(*)::int from public.answers'), count)
      }
    })

    await scenario('answer constraints prevent duplicate answers and cross-session/cross-quiz references', async () => {
      const session = await host()
      const player = await join()
      const otherSession = await host('654321', quizB, teacherB)
      await saveAnswer(session, player)
      const insert = `insert into public.answers(session_id,quiz_id,player_id,question_id,selected_index,is_correct,points_awarded)
        values ($1,$2,$3,$4,0,false,0)`
      await rejects(insert, [session, quizA, player, questionA], '23505')
      await rejects(insert, [otherSession, quizB, player, questionB], '23503')
      await rejects(insert, [session, quizA, player, questionB], '23503')
      await rejects('update public.answers set response_ms=-1 where player_id=$1', [player], '23514')
    })

    await scenario('teachers cannot change other teachers questions or read their participants/answers', async () => {
      const session = await host()
      const player = await join()
      await saveAnswer(session, player)
      await login(teacherB)
      assert.equal((await rows('update public.questions set correct_index=0 where id=$1 returning id', [questionA])).length, 0)
      assert.equal((await rows('delete from public.questions where id=$1 returning id', [questionA])).length, 0)
      for (const table of ['players', 'answers', 'teams', 'game_sessions']) {
        assert.equal(await scalar(`select count(*)::int from public.${table}`), 0)
      }
    })

    await scenario('permanent teacher JWT cannot authorize an Auth user marked anonymous', async () => {
      await db.query('update auth.users set is_anonymous=true where id=$1', [teacherA])
      await login(teacherA, false)
      assert.equal(await scalar('select private.is_teacher()'), false)
      assert.equal(await scalar('select count(*)::int from public.quizzes'), 0)
      await rejects("insert into public.quizzes(teacher_id,title) values ($1,'Forbidden')", [teacherA], '42501')
    })

    await scenario('teacher login remains a valid player identity without anonymous conversion', async () => {
      const session = await host()
      await login(teacherB, false)
      const player = await scalar("select public.join_game('123456','Teacher preview')")
      assert.equal(await scalar('select session_id from public.players where id=$1', [player]), session)
      assert.equal(await scalar('select count(*)::int from public.questions where quiz_id=$1', [quizA]), 0)
    })

    await scenario('rejoin preserves membership and cannot rename into another player identity', async () => {
      const session = await host()
      const player = await join()
      await join(studentB, 'Bob')
      assert.equal(await join(studentA, 'Bob'), player)
      await admin()
      await db.query("update public.game_sessions set status='active' where id=$1", [session])
      await login(studentA, true)
      await rejects("select public.join_game('123456','Alice')", [], 'P0001')
      assert.equal(await scalar('select id from public.players'), player)
      assert.equal(await scalar('select status from public.game_sessions'), 'active')
    })

    await scenario('capacity, expiration, unique code and team boundaries are enforced', async () => {
      await host()
      await login(teacherA)
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code) values ($1,$2,'123456')", [quizA,teacherA], '23505')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code,max_players) values ($1,$2,'234567',0)", [quizA,teacherA], '23514')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code,team_count) values ($1,$2,'234567',9)", [quizA,teacherA], '23514')
      await rejects("insert into public.game_sessions(quiz_id,host_id,join_code,expires_at) values ($1,$2,'234567',now()-interval '1 hour')", [quizA,teacherA], '23514')
    })

    await scenario('full 40-player lobby stays balanced and rejects a 41st player', async () => {
      const session = await host()
      for (let index = 1; index <= 41; index++) {
        const id = `90000000-0000-0000-0000-${String(index).padStart(12, '0')}`
        await admin()
        await db.query('insert into auth.users(id,is_anonymous) values ($1,true)', [id])
        if (index <= 40) {
          assert.ok(await join(id, `Player ${index}`))
        } else {
          await login(id, true)
          await rejects("select public.join_game('123456','Player 41')", [], 'P0001', /full/)
        }
      }
      await login(teacherA)
      assert.deepEqual(await rows('select team_number,count(*)::int as total from public.players where session_id=$1 group by team_number order by team_number', [session]),
        [{ team_number: 1, total: 20 }, { team_number: 2, total: 20 }])
    })
  } finally {
    await db.close()
  }
})

test('migration backfills existing permanent users and excludes existing anonymous users', async () => {
  const db = new PGlite()
  try {
    await db.exec(await read('tests/auth-shim.sql'))
    await db.query(`insert into auth.users(id,email,is_anonymous,raw_user_meta_data)
      values ($1,'existing@example.test',false,'{"display_name":"Existing teacher"}'),
             ($2,null,true,'{"role":"teacher"}')`, [teacherA, studentA])
    await db.exec(await read('migrations/20261029000000_initial_schema.sql'))
    assert.deepEqual((await db.query('select id, display_name from public.teachers')).rows,
      [{ id: teacherA, display_name: 'Existing teacher' }])
  } finally {
    await db.close()
  }
})
