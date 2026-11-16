// GR-38: the per-quiz timer only closes questions. It never changes points.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { io } from "socket.io-client";
import {
  database,
  teacherA,
  question,
} from "../../supabase/tests/game-fixture.mjs";
import { fixtureRepository } from "./fixtureRepository.mjs";
import { createApp } from "../src/app.js";

// Correct indexes 1, 0, 2. null means the player does not answer in time.
// Joined in order, players alternate teams 1, 2, 1, 2.
const correct = [1, 0, 2];
const choices = [
  [1, 0, 2], // 3 correct
  [0, 0, 2], // wrong, correct, correct
  [1, 3, 2], // correct, wrong, correct
  [1, 0, null], // correct, correct, then late (timed) or missed (untimed)
];

test(
  "timed and untimed runs of the same quiz award identical points; late answers are closed",
  { timeout: 60000 },
  async (t) => {
    const f = await database(),
      repo = fixtureRepository(f),
      sockets = [];
    let server;
    t.after(async () => {
      for (const s of sockets) s.disconnect();
      if (server) await server.close();
      await f.close();
    });
    const hostUser = await repo.addUser(teacherA, "teacher@example.test", true);
    const questions = JSON.stringify(
      correct.map((c, i) => ({
        ...question(`Question ${i + 1}`, c),
        time_limit_seconds: 60,
      })),
    );
    const saveQuiz = async (quiz) =>
      f.scalar(
        f.as(teacherA, "select public.save_quiz(null,0,$1,$2)", [
          JSON.stringify(quiz),
          questions,
        ]),
      );
    // No timer_enabled field: the default must be off.
    const untimedQuiz = await saveQuiz({ title: "Untimed" });
    const timedQuiz = await saveQuiz({ title: "Timed", timer_enabled: true });
    const [untimedRow] = await f.admin(
      "select timer_enabled from public.quizzes where id=$1",
      [untimedQuiz],
    );
    assert.equal(untimedRow.timer_enabled, false);

    server = createApp({
      config: { origins: ["http://localhost:5173"] },
      repository: repo,
    });
    server.httpServer.listen(0, "127.0.0.1");
    await once(server.httpServer, "listening");
    const port = server.httpServer.address().port;
    async function connect(user) {
      const socket = io(`http://127.0.0.1:${port}`, {
        auth: { accessToken: repo.tokenFor(user) },
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
      });
      sockets.push(socket);
      socket.connect();
      await once(socket, "connect");
      return socket;
    }
    const emit = (s, event, payload) =>
      s.timeout(15000).emitWithAck(event, payload);
    const ok = (reply) => {
      assert.equal(reply.ok, true, JSON.stringify(reply));
      return reply.data;
    };

    async function play(quizId, timed) {
      const host = await connect(hostUser);
      const id = ok(
        await emit(host, "host_create", { quizId, requestId: randomUUID() }),
      ).lobby.sessionId;
      const pin = (await f.data(id)).session.join_code;
      const players = [];
      for (let i = 0; i < choices.length; i++) {
        const socket = await connect(await repo.addUser());
        const { playerId } = ok(
          await emit(socket, "player_join", { pin, nickname: `Player ${i}` }),
        );
        players.push({ socket, playerId });
      }
      const command = async (action) =>
        ok(
          await emit(host, `game_${action}`, {
            sessionId: id,
            revision: (await f.data(id)).session.revision,
          }),
        );
      await command("start");
      for (let q = 0; q < correct.length; q++) {
        let d = await f.data(id);
        assert.equal(d.session.phase, "question");
        assert.equal(d.session.timer_enabled, timed);
        if (!timed) assert.equal(d.session.deadline, null);
        else {
          // Two clock_timestamp() calls, so allow a few milliseconds between them.
          const limit =
            Date.parse(d.session.deadline) -
            Date.parse(d.session.question_started_at);
          assert.ok(limit >= 60000 && limit < 60050, `time limit ${limit}`);
        }
        // Timed Q2: every answer arrives about 45 s after the question opened.
        if (timed && q === 1)
          await f.admin(
            "update public.game_sessions set question_started_at=clock_timestamp()-interval '45 seconds' where id=$1",
            [id],
          );
        const questionId = d.questions[q].id;
        for (let i = 0; i < players.length; i++) {
          if (choices[i][q] === null) continue;
          ok(
            await emit(players[i].socket, "game_answer", {
              sessionId: id,
              questionId,
              choice: choices[i][q],
              requestId: randomUUID(),
            }),
          );
        }
        if (timed && q === 2) {
          // The deadline passes before Player 3 answers.
          await f.admin(
            "update public.game_sessions set deadline=clock_timestamp()-interval '1 second' where id=$1",
            [id],
          );
          const late = await emit(players[3].socket, "game_answer", {
            sessionId: id,
            questionId,
            choice: correct[q],
            requestId: randomUUID(),
          });
          assert.equal(late.ok, false);
          assert.equal(late.error.code, "ANSWER_CLOSED");
          // No host action: syncing recovers the overdue deadline into feedback.
          const synced = ok(
            await emit(players[3].socket, "game_sync", { sessionId: id }),
          ).state;
          assert.equal(synced.phase, "feedback");
          assert.equal(synced.deadline, null);
          assert.equal(synced.feedback.points, 0);
          assert.equal(synced.feedback.streak, 0);
        } else await command("reveal");
        d = await f.data(id);
        assert.equal(d.session.phase, "feedback");
        if (timed && q === 1)
          for (const a of d.answers.filter((a) => a.question_id === questionId))
            assert.ok(a.response_ms >= 45000, `slow answer ${a.response_ms}`);
        await command("next");
      }
      const d = await f.data(id);
      assert.equal(d.session.phase, "results");
      const state = ok(await emit(host, "game_sync", { sessionId: id })).state;
      return { d, state, players };
    }

    const runs = {
      untimed: await play(untimedQuiz, false),
      timed: await play(timedQuiz, true),
    };
    const summary = {};
    for (const [name, { d, state, players }] of Object.entries(runs)) {
      const position = new Map(d.questions.map((q) => [q.id, q.position]));
      const rows = players.map(({ playerId }) => {
        const p = d.players.find((x) => x.id === playerId);
        const answers = d.answers.filter((a) => a.player_id === playerId);
        const points = correct.map(
          (_, q) =>
            answers.find((a) => position.get(a.question_id) === q)
              ?.points_awarded ?? null,
        );
        // Score is exactly the sum of fixed per-answer points; streak adds nothing.
        assert.equal(
          p.score,
          points.reduce((sum, v) => sum + (v ?? 0), 0),
        );
        return {
          team: p.team_number,
          score: p.score,
          streak: p.streak,
          points,
        };
      });
      // Team totals equal the sum of member points and match the host scoreboard.
      const teams = {};
      for (const r of rows) teams[r.team] = (teams[r.team] || 0) + r.score;
      assert.deepEqual(
        Object.fromEntries(state.teamScores.map((t) => [t.id, t.score])),
        teams,
        `${name} team scoreboard`,
      );
      // The missing Q3 answer appears in results with zero attempts and points.
      const missed = state.results.find(
        (r) =>
          r.playerId === players[3].playerId &&
          r.questionId === d.questions[2].id,
      );
      assert.equal(missed.points, 0);
      assert.equal(missed.attempts, 0);
      summary[name] = { rows, teams };
    }
    assert.deepEqual(summary.timed, summary.untimed);
    assert.deepEqual(summary.untimed, {
      rows: [
        { team: 1, score: 3000, streak: 3, points: [1000, 1000, 1000] },
        { team: 2, score: 2000, streak: 2, points: [0, 1000, 1000] },
        { team: 1, score: 2000, streak: 1, points: [1000, 0, 1000] },
        { team: 2, score: 2000, streak: 0, points: [1000, 1000, null] },
      ],
      teams: { 1: 5000, 2: 4000 },
    });
  },
);
