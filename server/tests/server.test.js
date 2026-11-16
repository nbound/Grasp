import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { io } from "socket.io-client";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import {
  SessionManager,
  validateHost,
  validateJoin,
} from "../src/sessionManager.js";
import { PublicError, joinError } from "../src/errors.js";

const quizId = "10000000-0000-4000-8000-000000000001";
const sessionId = "20000000-0000-4000-8000-000000000001";
const origin = "http://localhost:5173";
const baseLobby = {
  sessionId,
  pin: "012345",
  status: "lobby",
  teams: [{ id: "1", name: "Team 1" }],
  players: [],
};
function repository() {
  const players = new Map();
  return {
    hostCalls: 0,
    async authenticate(token) {
      if (
        !["teacher", "student", "student2", "student3", "outsider"].includes(
          token,
        )
      )
        throw new Error("private failure");
      return { id: token, is_anonymous: token !== "teacher" };
    },
    async host(user) {
      assert.equal(user.id, "teacher");
      this.hostCalls++;
      return sessionId;
    },
    async resumeHost(user) {
      if (user.id !== "teacher") throw new PublicError("FORBIDDEN");
      return sessionId;
    },
    async join(user, _token, values) {
      if (values.pin !== baseLobby.pin) throw new PublicError("BAD_PIN");
      if (!players.has(user.id))
        players.set(user.id, {
          id: `p-${user.id}`,
          nickname: values.nickname,
          teamId: "1",
        });
      return { sessionId, playerId: players.get(user.id).id };
    },
    async lobby() {
      return { ...baseLobby, players: [...players.values()] };
    },
  };
}
async function fixture(t, repo = repository()) {
  const server = createApp({ config: { origins: [origin] }, repository: repo });
  server.httpServer.listen(0, "127.0.0.1");
  await once(server.httpServer, "listening");
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const clients = [];
  t.after(async () => {
    clients.forEach((socket) => socket.disconnect());
    await server.close();
  });
  async function client(token, options = {}) {
    const socket = io(url, {
      auth: { accessToken: token },
      extraHeaders: { Origin: origin },
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
      ...options,
    });
    clients.push(socket);
    return socket;
  }
  async function connect(token) {
    const socket = await client(token);
    const ready = once(socket, "connect");
    socket.connect();
    await ready;
    return socket;
  }
  return { server, repo, url, client, connect };
}
const emit = (socket, event, data = {}) =>
  socket.timeout(2000).emitWithAck(event, data);

test("config validates deployment origins and never prints supplied secrets", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public-fixture",
    SUPABASE_SECRET_KEY: "private-fixture",
  };
  assert.equal(readConfig(env).port, 3001);
  assert.throws(
    () => readConfig({ ...env, NODE_ENV: "production" }),
    /CLIENT_ORIGINS/,
  );
  assert.throws(() => readConfig({ ...env, PORT: "invalid" }), /PORT/);
  assert.throws(
    () => readConfig({ ...env, CLIENT_ORIGINS: "https://example.test/path" }),
    /without paths/,
  );
  assert.throws(
    () => readConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_fake" }),
    (error) => !error.message.includes("sb_secret_fake"),
  );
  assert.throws(
    () =>
      readConfig({
        ...env,
        NODE_ENV: "production",
        CLIENT_ORIGINS: "http://example.test",
      }),
    /HTTPS/,
  );
});

test("server independently validates host and Unicode join input", () => {
  assert.deepEqual(validateHost({ quizId }), {
    quizId,
    maxPlayers: 40,
    teamCount: 2,
  });
  for (const value of [
    null,
    {},
    { quizId, maxPlayers: 201 },
    { quizId, teamCount: 1 },
  ])
    assert.throws(() => validateHost(value));
  assert.deepEqual(validateJoin({ pin: "012345", nickname: " 林同学 " }), {
    pin: "012345",
    nickname: "林同学",
  });
  for (const value of [
    null,
    { pin: 123456 },
    { pin: "012345", nickname: "x" },
    { pin: "012345", nickname: "a\u0000b" },
  ])
    assert.throws(() => validateJoin(value));
  assert.equal(
    joinError({ code: "23505", message: "private" }).code,
    "DUPLICATE_NICKNAME",
  );
  assert.equal(
    joinError({ code: "P0001", message: "Game is full" }).code,
    "SESSION_FULL",
  );
});

test("health is public; missing tokens and disallowed WebSocket origins are rejected", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await (await fetch(`${f.url}/health`)).json(), {
    status: "ok",
  });
  for (const options of [
    {},
    {
      auth: { accessToken: "teacher" },
      extraHeaders: { Origin: "https://evil.test" },
    },
  ]) {
    const socket = await f.client(undefined, options);
    const failure = once(socket, "connect_error");
    socket.connect();
    const [error] = await failure;
    assert.ok(error);
    assert.equal(socket.connected, false);
    assert.ok(!error.message.includes("private"));
  }
});

test("study history and cosmetics remain available after AI routes are removed", async (t) => {
  const repo = repository();
  const study = { streak: 2, answered: 4, correct: 3, mistakes: [] };
  repo.study = async (user) => {
    assert.equal(user.id, "student");
    return study;
  };
  repo.setCosmetics = async (user, values) => {
    assert.equal(user.id, "student");
    assert.deepEqual(values, { theme: "forest", avatar: "seed" });
    return {};
  };
  const f = await fixture(t, repo);
  const headers = {
    Authorization: "Bearer student",
    "Content-Type": "application/json",
  };
  const history = await fetch(`${f.url}/api/study`, { headers });
  assert.equal(history.status, 200);
  assert.deepEqual(await history.json(), study);
  const cosmetics = await fetch(`${f.url}/api/study/cosmetics`, {
    method: "POST",
    headers,
    body: JSON.stringify({ theme: "forest", avatar: "seed" }),
  });
  assert.equal(cosmetics.status, 200);
  for (const [method, path] of [
    ["POST", "/ai/questions"],
    ["POST", "/ai/slides"],
    ["POST", "/study/tutor"],
    ["POST", "/practice"],
    ["GET", "/practice"],
    ["GET", `/practice/${quizId}`],
    ["POST", `/practice/${quizId}/answer`],
  ]) {
    const response = await fetch(`${f.url}/api${path}`, {
      method,
      headers,
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    assert.equal(response.status, 404, `${method} ${path}`);
  }
});

test("teacher hosts; three students join; room access and leave ownership are enforced", async (t) => {
  const f = await fixture(t);
  const host = await f.connect("teacher");
  const outsider = await f.connect("outsider");
  const students = await Promise.all(
    ["student", "student2", "student3"].map(f.connect),
  );
  let leaked = false;
  outsider.on("lobby_update", () => {
    leaked = true;
  });
  assert.equal(
    (await emit(outsider, "host_create", { quizId })).error.code,
    "FORBIDDEN",
  );
  assert.equal(
    (await emit(outsider, "host_join", { sessionId })).error.code,
    "FORBIDDEN",
  );
  assert.equal(
    (await emit(host, "host_create", { quizId })).data.lobby.pin,
    "012345",
  );
  await emit(host, "host_create", { quizId });
  assert.equal(f.repo.hostCalls, 1);
  for (const [index, socket] of students.entries()) {
    const joined = await emit(socket, "player_join", {
      pin: "012345",
      nickname: `Student ${index}`,
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.data.lobby.players.length, index + 1);
  }
  const retry = await emit(students[0], "player_join", {
    pin: "012345",
    nickname: "Changed",
  });
  assert.equal(retry.data.playerId, "p-student");
  await emit(students[0], "player_left", { playerId: "p-student2" });
  const snapshot = await f.server.manager.snapshot(sessionId);
  assert.deepEqual(
    snapshot.players.map((p) => p.id),
    ["p-student2", "p-student3"],
  );
  assert.equal(
    (await f.repo.lobby()).players.length,
    3,
    "leaving never deletes database membership",
  );
  assert.equal(leaked, false);
});

test("reconnect keeps identity/team and one tab leaving does not remove another", async (t) => {
  const f = await fixture(t);
  const a = await f.connect("student");
  const b = await f.connect("student");
  const values = { pin: "012345", nickname: "Student" };
  const first = await emit(a, "player_join", values);
  assert.equal(
    (await emit(b, "player_join", values)).data.playerId,
    first.data.playerId,
  );
  await emit(a, "player_left");
  assert.equal((await f.server.manager.snapshot(sessionId)).players.length, 1);
  await emit(b, "player_left");
  assert.equal((await f.server.manager.snapshot(sessionId)).players.length, 0);
  const c = await f.connect("student");
  assert.equal(
    (await emit(c, "player_join", values)).data.playerId,
    first.data.playerId,
  );
});

test("operation authentication is rechecked; raw repository errors are sanitized", async (t) => {
  const f = await fixture(t);
  const student = await f.connect("student");
  f.repo.join = async () => {
    throw new Error("sensitive database detail");
  };
  assert.deepEqual(
    await emit(student, "player_join", { pin: "012345", nickname: "Student" }),
    { ok: false, error: { code: "SERVER_ERROR" } },
  );
  f.repo.authenticate = async () => {
    throw new PublicError("UNAUTHORIZED");
  };
  assert.deepEqual(
    await emit(student, "player_join", { pin: "012345", nickname: "Student" }),
    { ok: false, error: { code: "UNAUTHORIZED" } },
  );
});

test("identity rate limit survives a new connection", async (t) => {
  const f = await fixture(t);
  const student = await f.connect("student");
  for (let i = 0; i < 29; i++) await emit(student, "player_left");
  assert.equal((await emit(student, "player_left")).error.code, "RATE_LIMITED");
  const other = await f.client("student");
  const failure = once(other, "connect_error");
  other.connect();
  assert.equal((await failure)[0].message, "UNAUTHORIZED");
});

test("manager filters disconnected records but retains multi-tab presence", async () => {
  const manager = new SessionManager({
    lobby: async () => ({
      ...baseLobby,
      players: [{ id: "p1" }, { id: "p2" }],
    }),
  });
  manager.attach("a", { sessionId, playerId: "p1" });
  manager.attach("b", { sessionId, playerId: "p1" });
  manager.detach("a");
  assert.deepEqual((await manager.snapshot(sessionId)).players, [{ id: "p1" }]);
  manager.detach("b");
  assert.deepEqual((await manager.snapshot(sessionId)).players, []);
});
