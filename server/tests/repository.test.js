import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRepository } from "../src/repository.js";

// Exercise the actual Supabase SDK HTTP adapter without real keys or remote data.
test("repository keeps user-scoped writes separate from admin reads and allowlists lobby fields", async (t) => {
  const requests = [];
  let hostAttempts = 0;
  const http = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const path = new URL(req.url, "http://localhost").pathname;
    requests.push({
      path,
      method: req.method,
      authorization: req.headers.authorization,
      key: req.headers.apikey,
      body: body ? JSON.parse(body) : undefined,
    });
    res.setHeader("Content-Type", "application/json");
    let value;
    if (path === "/auth/v1/user")
      value = { id: "teacher-id", is_anonymous: false };
    else if (path === "/rest/v1/quizzes") value = { id: "quiz-id" };
    else if (path === "/rest/v1/game_sessions" && req.method === "POST") {
      if (++hostAttempts === 1) {
        res.statusCode = 409;
        value = { code: "23505", message: "collision" };
      } else value = { id: "session-id" };
    } else if (path === "/rest/v1/game_sessions")
      value = {
        id: "session-id",
        join_code: "012345",
        status: "lobby",
        host_id: "teacher-id",
        expires_at: new Date(Date.now() + 60000).toISOString(),
        private_field: "hidden",
      };
    else if (path === "/rest/v1/rpc/join_game") value = "player-id";
    else if (
      path === "/rest/v1/players" &&
      new URL(req.url, "http://localhost").searchParams.has("id")
    )
      value = {
        id: "player-id",
        session_id: "session-id",
        user_id: "teacher-id",
      };
    else if (path === "/rest/v1/players")
      value = [
        {
          id: "player-id",
          nickname: "Student",
          team_number: 1,
          user_id: "hidden",
          score: 1000,
        },
      ];
    else if (path === "/rest/v1/teams")
      value = [{ team_number: 1, name: "Team 1", private_field: "hidden" }];
    else {
      res.statusCode = 404;
      value = {};
    }
    res.end(JSON.stringify(value));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => new Promise((resolve) => http.close(resolve)));
  const repo = createRepository({
    supabaseUrl: `http://127.0.0.1:${http.address().port}`,
    publishableKey: "public-fixture",
    secretKey: "admin-fixture",
  });
  const user = await repo.authenticate("user-token");
  assert.equal(user.id, "teacher-id");
  assert.equal(
    await repo.host(user, "user-token", {
      quizId: "quiz-id",
      maxPlayers: 40,
      teamCount: 2,
    }),
    "session-id",
  );
  assert.equal(hostAttempts, 2, "PIN collisions are retried");
  await assert.rejects(
    repo.host({ ...user, is_anonymous: true }, "user-token", {}),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(
    await repo.join(user, "user-token", { pin: "012345", nickname: "Student" }),
    { playerId: "player-id", sessionId: "session-id" },
  );
  assert.equal(
    await repo.resumeHost(user, "user-token", "session-id"),
    "session-id",
  );
  const lobby = await repo.lobby("session-id");
  assert.deepEqual(lobby, {
    sessionId: "session-id",
    pin: "012345",
    status: "lobby",
    teams: [{ id: "1", name: "Team 1" }],
    players: [{ id: "player-id", nickname: "Student", teamId: "1" }],
  });
  const rpc = requests.find((r) => r.path.endsWith("/rpc/join_game"));
  assert.equal(rpc.key, "public-fixture");
  assert.equal(rpc.authorization, "Bearer user-token");
  assert.deepEqual(rpc.body, { p_code: "012345", p_nickname: "Student" });
  const host = requests.find(
    (r) => r.method === "POST" && r.path.endsWith("/game_sessions"),
  );
  assert.equal(host.key, "public-fixture");
  assert.equal(host.authorization, "Bearer user-token");
  assert.equal(host.body.host_id, "teacher-id");
  assert.match(host.body.join_code, /^\d{6}$/);
  assert.equal(
    requests.find((r) => r.path.endsWith("/teams")).key,
    "admin-fixture",
  );
});
