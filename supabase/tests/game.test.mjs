import test from "node:test";
import assert from "node:assert/strict";
import {
  database,
  teacherA,
  teacherB,
  studentA,
  studentB,
  quizA,
  questionA,
  question,
} from "./game-fixture.mjs";

test("game creation migration, authoritative roles, atomic saves and durable scoring", async (t) => {
  const f = await database();
  t.after(() => f.close());
  const { admin, as, scalar, command, data } = f;
  await t.test(
    "registered students and metadata forgery cannot create teachers",
    async () => {
      await admin(
        "update auth.users set is_anonymous=false,email='student@example.test',raw_user_meta_data='{\"grasp_role\":\"teacher\"}' where id=$1",
        [studentA],
      );
      assert.equal(
        await scalar(
          admin("select count(*)::int from public.teachers where id=$1", [
            studentA,
          ]),
        ),
        0,
      );
      assert.equal(
        (
          await as(
            studentA,
            "select * from public.quizzes",
            [],
            "authenticated",
            false,
          )
        ).length,
        0,
      );
      await assert.rejects(
        as(
          studentA,
          'select public.save_quiz(null,null,\'{"title":"No"}\',$1)',
          [JSON.stringify([question()])],
          "authenticated",
          false,
        ),
        /FORBIDDEN/,
      );
    },
  );
  await t.test(
    "ownership, atomic question reorder, stale edits and invalid rollback",
    async () => {
      await assert.rejects(
        as(teacherB, "select public.save_quiz($1,0,$2,$3)", [
          quizA,
          JSON.stringify({ title: "Stolen" }),
          JSON.stringify([question()]),
        ]),
        /FORBIDDEN/,
      );
      await as(teacherA, "select public.save_quiz($1,0,$2,$3)", [
        quizA,
        JSON.stringify({ title: "Updated", feedback_mode: "end" }),
        JSON.stringify([question("First"), question("Second", 0)]),
      ]);
      await assert.rejects(
        as(teacherA, "select public.save_quiz($1,0,$2,$3)", [
          quizA,
          JSON.stringify({ title: "Stale" }),
          JSON.stringify([question()]),
        ]),
        /STALE_VERSION/,
      );
      await assert.rejects(
        as(teacherA, "select public.save_quiz($1,1,$2,$3)", [
          quizA,
          JSON.stringify({ title: "Invalid" }),
          JSON.stringify([
            question("Valid"),
            { ...question(), choices: ["bad"] },
          ]),
        ]),
      );
      assert.equal(
        await scalar(
          admin("select title from public.quizzes where id=$1", [quizA]),
        ),
        "Updated",
      );
      assert.equal(
        await scalar(
          admin("select count(*)::int from public.questions where quiz_id=$1", [
            quizA,
          ]),
        ),
        2,
      );
    },
  );
  const session = await f.host(),
    player = await f.join(),
    playerB = await f.join(studentB, "Second");
  await t.test(
    "hosted questions cannot change and students cannot invoke trusted RPCs",
    async () => {
      await assert.rejects(
        as(teacherA, "select public.save_quiz($1,1,$2,$3)", [
          quizA,
          JSON.stringify({ title: "Changed" }),
          JSON.stringify([question()]),
        ]),
        /QUIZ_HOSTED/,
      );
      await assert.rejects(
        as(studentA, "select public.game_data($1)", [session]),
        /permission denied/,
      );
      await assert.rejects(
        as(studentA, "select public.game_command($1,$2,'start','{}')", [
          teacherA,
          session,
        ]),
        /permission denied/,
      );
      await assert.rejects(
        command(teacherB, session, "start", { revision: 0 }),
        /FORBIDDEN/,
      );
    },
  );
  await command(teacherA, session, "start", { revision: 0 });
  let d = await data(session),
    q = d.questions[0];
  await t.test(
    "answer validation, atomic points, duplicate retries and direct RLS",
    async () => {
      await assert.rejects(
        command(teacherB, session, "answer", { questionId: q.id, choice: 1 }),
        /FORBIDDEN/,
      );
      await assert.rejects(
        command(studentA, session, "answer", {
          questionId: questionA,
          choice: 1,
        }),
        /WRONG_QUESTION/,
      );
      await assert.rejects(
        command(studentA, session, "answer", { questionId: q.id, choice: 9 }),
        /INVALID_INPUT/,
      );
      const payload = {
        questionId: q.id,
        choice: 1,
        requestId: "90000000-0000-0000-0000-000000000001",
      };
      const replies = await Promise.all(
        Array.from({ length: 10 }, () =>
          command(studentA, session, "answer", payload),
        ),
      );
      assert.equal(replies.filter((r) => !r.duplicate).length, 1);
      d = await data(session);
      assert.equal(d.players.find((p) => p.id === player).score, 1000);
      assert.equal(d.answers.length, 1);
      assert.equal(d.answers[0].attempts, 1);
      assert.ok(d.answers[0].response_ms >= 0);
      await assert.rejects(
        command(studentA, session, "answer", { ...payload, choice: 2 }),
        /ALREADY_ANSWERED/,
      );
      assert.equal(
        (await as(studentA, "select * from public.answers")).length,
        0,
      );
      assert.equal(
        (await as(studentA, "select * from public.players")).length,
        0,
      );
      assert.equal(
        (await as(teacherB, "select * from public.answers")).length,
        0,
      );
      assert.equal(
        (await as(teacherA, "select * from public.answers")).length,
        1,
      );
    },
  );
  await t.test(
    "phase transitions and streak reset have no score multiplier",
    async () => {
      await assert.rejects(
        command(teacherA, session, "next", { revision: d.session.revision }),
        /INVALID_PHASE/,
      );
      await command(teacherA, session, "reveal", {
        revision: d.session.revision,
      });
      d = await data(session);
      await assert.rejects(
        command(studentB, session, "answer", { questionId: q.id, choice: 1 }),
        /ANSWER_CLOSED/,
      );
      await command(teacherA, session, "next", {
        revision: d.session.revision,
      });
      d = await data(session);
      q = d.questions[1];
      await command(studentA, session, "answer", {
        questionId: q.id,
        choice: 1,
      });
      d = await data(session);
      assert.equal(d.players.find((p) => p.id === player).streak, 0);
      assert.equal(d.players.find((p) => p.id === player).score, 1000);
      assert.equal(d.players.find((p) => p.id === playerB).score, 0);
      await command(teacherA, session, "end", { revision: d.session.revision });
      d = await data(session);
      assert.equal(d.session.phase, "results");
      assert.ok(d.session.finished_at);
      // Retried acknowledged answer still succeeds after the phase advances.
      assert.equal(
        (
          await command(studentA, session, "answer", {
            questionId: q.id,
            choice: 1,
          })
        ).duplicate,
        true,
      );
    },
  );
  await t.test(
    "every table has RLS and anonymous visitors lack table grants",
    async () => {
      const rows = await admin(
        "select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'",
      );
      for (const r of rows) {
        assert.equal(r.relrowsecurity, true, r.relname);
        assert.equal(
          await scalar(
            admin("select has_table_privilege('anon',$1,'SELECT')", [
              "public." + r.relname,
            ]),
          ),
          false,
        );
      }
    },
  );
  await t.test(
    "timers expire durably, refuse late answers and reset missed streaks",
    async () => {
      const quiz = await scalar(
        as(teacherA, "select public.save_quiz(null,null,$1,$2)", [
          JSON.stringify({ title: "Timed", timer_enabled: true }),
          JSON.stringify([question()]),
        ]),
      );
      const sid = await scalar(
        as(
          teacherA,
          "insert into public.game_sessions(quiz_id,host_id,join_code) values($1,$2,'777777') returning id",
          [quiz, teacherA],
        ),
      );
      await as(studentB, "select public.join_game('777777','Timed player')");
      await command(teacherA, sid, "start", { revision: 0 });
      let timed = await data(sid);
      assert.ok(timed.session.deadline);
      await admin(
        "update public.game_sessions set deadline=clock_timestamp()-interval '1 second' where id=$1",
        [sid],
      );
      await admin("update public.players set streak=3 where session_id=$1", [
        sid,
      ]);
      await assert.rejects(
        command(studentB, sid, "answer", {
          questionId: timed.questions[0].id,
          choice: 1,
        }),
        /ANSWER_CLOSED/,
      );
      await command(null, sid, "expire");
      timed = await data(sid);
      assert.equal(timed.session.phase, "feedback");
      assert.equal(timed.players[0].streak, 0);
      assert.equal(timed.answers.length, 0);
      await command(teacherA, sid, "next", {
        revision: timed.session.revision,
      });
      assert.equal((await data(sid)).session.phase, "results");
    },
  );
  await t.test(
    "duel forces two seats, requires two opponents and enforces capacity",
    async () => {
      const quiz = await scalar(
        as(teacherA, "select public.save_quiz(null,null,$1,$2)", [
          JSON.stringify({ title: "Duel", game_mode: "duel" }),
          JSON.stringify([question()]),
        ]),
      );
      const sid = await scalar(
        as(
          teacherA,
          "insert into public.game_sessions(quiz_id,host_id,join_code,max_players) values($1,$2,'888888',100) returning id",
          [quiz, teacherA],
        ),
      );
      assert.equal((await data(sid)).session.max_players, 2);
      await as(studentA, "select public.join_game('888888','One')");
      await assert.rejects(
        command(teacherA, sid, "start", { revision: 0 }),
        /NEED_PLAYERS/,
      );
      await as(studentB, "select public.join_game('888888','Two')");
      await assert.rejects(
        as(teacherB, "select public.join_game('888888','Third')"),
        /Game is full/,
      );
      await command(teacherA, sid, "start", { revision: 0 });
      assert.equal((await data(sid)).session.deadline, null);
    },
  );
  await t.test(
    "practice answers are owned, atomic, immutable and cannot be forged",
    async () => {
      const set = await scalar(
        admin(
          "insert into public.practice_sets(user_id,questions,difficulty) values($1,$2,1) returning id",
          [studentA, JSON.stringify([question()])],
        ),
      );
      await assert.rejects(
        as(studentA, "select public.practice_answer($1,$2,0,1)", [
          studentA,
          set,
        ]),
        /permission denied/,
      );
      await assert.rejects(
        as(
          null,
          "select public.practice_answer($1,$2,0,1)",
          [studentB, set],
          "service_role",
        ),
        /FORBIDDEN/,
      );
      await as(
        null,
        "select public.practice_answer($1,$2,0,1)",
        [studentA, set],
        "service_role",
      );
      await as(
        null,
        "select public.practice_answer($1,$2,0,0)",
        [studentA, set],
        "service_role",
      );
      const rows = await admin(
        "select * from public.practice_answers where set_id=$1",
        [set],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].selected_index, 1);
      assert.equal(rows[0].is_correct, true);
      assert.equal(
        await scalar(
          admin(
            "select count(*)::int from public.study_days where user_id=$1",
            [studentA],
          ),
        ),
        1,
      );
    },
  );
});
