import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { io } from "socket.io-client";
import {
  database,
  teacherA,
  teacherB,
  quizA,
  question,
} from "../../supabase/tests/game-fixture.mjs";
import { fixtureRepository } from "./fixtureRepository.mjs";
import { createApp } from "../src/app.js";

test(
  "40 concurrent players: burst answers, room isolation, duplicate tabs, restart and final results",
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
    const hostUser = await repo.addUser(teacherA, "teacher@example.test", true),
      other = await repo.addUser(teacherB, "other@example.test", true);
    await f.as(teacherA, "select public.save_quiz($1,0,$2,$3)", [
      quizA,
      JSON.stringify({ title: "Load quiz", feedback_mode: "end" }),
      JSON.stringify([question(), question("Second", 0)]),
    ]);
    async function start(port = 0) {
      server = createApp({
        config: { origins: ["http://localhost:5173"] },
        repository: repo,
      });
      server.httpServer.listen(port, "127.0.0.1");
      await once(server.httpServer, "listening");
      return server.httpServer.address().port;
    }
    const port = await start();
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
    const host = await connect(hostUser),
      outsider = await connect(other);
    const created = ok(
      await emit(host, "host_create", {
        quizId: quizA,
        requestId: randomUUID(),
      }),
    );
    const id = created.lobby.sessionId,
      pin = created.lobby.pin;
    assert.equal(
      (await emit(outsider, "game_sync", { sessionId: id })).error.code,
      "FORBIDDEN",
    );
    const players = await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        const user = await repo.addUser(),
          socket = await connect(user);
        const joined = ok(
          await emit(socket, "player_join", {
            pin,
            nickname: `Player ${String(i).padStart(2, "0")}`,
          }),
        );
        return { user, socket, id: joined.playerId };
      }),
    );
    let d = await f.data(id);
    assert.equal(d.players.length, 40);
    assert.equal(d.players.filter((p) => p.team_number === 1).length, 20);
    ok(await emit(host, "game_start", { sessionId: id, revision: 0 }));
    d = await f.data(id);
    const q = d.questions[0];
    const started = performance.now();
    const replies = await Promise.all(
      players.map(({ socket }, i) =>
        emit(socket, "game_answer", {
          sessionId: id,
          questionId: q.id,
          choice: i % 2 ? 0 : 1,
          requestId: randomUUID(),
        }),
      ),
    );
    replies.forEach(ok);
    t.diagnostic(
      `40-answer burst acknowledged in ${Math.round(performance.now() - started)}ms`,
    );
    d = await f.data(id);
    assert.equal(d.answers.length, 40);
    assert.equal(
      d.players.reduce((n, p) => n + p.score, 0),
      20000,
    );
    const own = ok(
      await emit(players[0].socket, "game_sync", { sessionId: id }),
    ).state;
    assert.equal(own.submitted, true);
    assert.equal(own.feedback, null);
    const duplicate = await connect(players[0].user);
    ok(await emit(duplicate, "game_sync", { sessionId: id }));
    ok(
      await emit(duplicate, "game_answer", {
        sessionId: id,
        questionId: q.id,
        choice: 1,
        requestId: randomUUID(),
      }),
    );
    players[0].socket.disconnect();
    assert.equal((await f.data(id)).answers.length, 40);
    await server.close();
    await start(port);
    const resumedHost = await connect(hostUser),
      resumed = await connect(players[0].user);
    const restored = ok(
      await emit(resumed, "game_sync", { sessionId: id }),
    ).state;
    assert.equal(restored.playerId, players[0].id);
    assert.equal(restored.teamId, own.teamId);
    assert.equal(restored.submitted, true);
    let hostState = ok(
      await emit(resumedHost, "game_sync", { sessionId: id }),
    ).state;
    ok(
      await emit(resumedHost, "game_reveal", {
        sessionId: id,
        revision: hostState.revision,
      }),
    );
    hostState = ok(
      await emit(resumedHost, "game_sync", { sessionId: id }),
    ).state;
    ok(
      await emit(resumedHost, "game_next", {
        sessionId: id,
        revision: hostState.revision,
      }),
    );
    d = await f.data(id);
    ok(
      await emit(resumed, "game_answer", {
        sessionId: id,
        questionId: d.questions[1].id,
        choice: 0,
        requestId: randomUUID(),
      }),
    );
    hostState = ok(
      await emit(resumedHost, "game_sync", { sessionId: id }),
    ).state;
    ok(
      await emit(resumedHost, "game_end", {
        sessionId: id,
        revision: hostState.revision,
      }),
    );
    const results = ok(
      await emit(resumed, "game_sync", { sessionId: id }),
    ).state;
    assert.equal(results.phase, "results");
    assert.equal(results.results.length, 2);
    assert.ok(results.results.every((row) => row.playerId === players[0].id));
    assert.equal(
      results.leaderboard.find((p) => p.id === players[0].id).score,
      2000,
    );
    const exported = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${id}/results.csv`,
      {
        headers: { Authorization: `Bearer ${repo.tokenFor(players[0].user)}` },
      },
    );
    assert.equal(exported.status, 200);
    const csv = await exported.text();
    assert.ok(csv.includes("Player 00"));
    assert.ok(!csv.includes("Player 01"));
    const denied = await fetch(
      `http://127.0.0.1:${port}/api/sessions/${id}/results.csv`,
      { headers: { Authorization: `Bearer ${repo.tokenFor(other)}` } },
    );
    assert.equal(denied.status, 403);
  },
);
