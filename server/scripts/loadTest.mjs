// Local load test for the game server, all on 127.0.0.1. A child process runs the
// real Socket.IO app on embedded PGlite (the real Supabase migrations) with fixture
// auth; this process drives socket.io-client players. Clients and server need
// separate processes: sharing one event loop corrupted frames at 200 players.
// No env files, no hosted services.
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import {
  database,
  question,
  quizA,
  teacherA,
} from "../../supabase/tests/game-fixture.mjs";
import { fixtureRepository } from "../tests/fixtureRepository.mjs";
import { createApp } from "../src/app.js";

const MAX_PLAYERS = 200; // validateHost and the max_players check constraint
const TEAMS = 2;
const ACK_MS = 15000;
// app.js consume(): 30 operations per user per minute, and the socket handshake
// counts as one. The host spends 4 fixed operations (handshake, host_create,
// game_start, final game_sync) and 4 per question (game_sync, game_reveal,
// game_sync, game_next). Players need at most 4 + questions, so the host binds.
const USER_OPS = 30;
const HOST_FIXED_OPS = 4;
const HOST_OPS_PER_QUESTION = 4;
const MAX_QUESTIONS = Math.floor(
  (USER_OPS - HOST_FIXED_OPS) / HOST_OPS_PER_QUESTION,
);

const usage = `Usage: node scripts/loadTest.mjs [--players N] [--questions N]

Plays one full game against the real Socket.IO server on 127.0.0.1, backed by
embedded PGlite (the real migrations) and local fixture auth. Fully local.

  --players N     players that join, 1-${MAX_PLAYERS} (default 40; ${MAX_PLAYERS} is the server's per-session cap)
  --questions N   questions to play, 1-${MAX_QUESTIONS} (default 3)
  -h, --help      show this help

Question ceiling: the server allows ${USER_OPS} operations per user per minute, and
the socket handshake counts as one. The host needs ${HOST_FIXED_OPS} fixed operations
(handshake, host_create, game_start, final game_sync) plus ${HOST_OPS_PER_QUESTION} per question
(game_sync, game_reveal, game_sync, game_next): ${HOST_FIXED_OPS} + ${HOST_OPS_PER_QUESTION} x ${MAX_QUESTIONS} = ${HOST_FIXED_OPS + HOST_OPS_PER_QUESTION * MAX_QUESTIONS} <= ${USER_OPS}.

Exits 0 on PASS, 1 on any failed or timed-out ack, dropped socket, failed
reconnect, wrong score or unclean shutdown, 2 on invalid arguments.`;

function parseArgs(argv) {
  const opts = { players: 40, questions: 3 };
  const limits = { players: MAX_PLAYERS, questions: MAX_QUESTIONS };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-h" || argv[i] === "--help") return null;
    const match = /^--(players|questions)(?:=(.*))?$/.exec(argv[i]);
    if (!match) throw new Error(`unknown argument ${argv[i]}`);
    const [, name, inline] = match;
    const raw = inline ?? argv[++i];
    const value = Number(raw);
    if (!/^\d+$/.test(raw ?? "") || value < 1 || value > limits[name]) {
      const why =
        name === "players"
          ? "the server accepts at most 200 players per session"
          : `the host's ${USER_OPS} ops/minute rate limit allows ${HOST_FIXED_OPS} fixed + ${HOST_OPS_PER_QUESTION} per question`;
      throw new Error(
        `--${name} must be an integer from 1 to ${limits[name]} (${why}); got ${raw ?? "nothing"}`,
      );
    }
    opts[name] = value;
  }
  return opts;
}

const failures = [];
const fail = (message) => failures.push(message);
const sockets = [];

// Socket drops are reported where they happen (see connect); here they only fail the op.
async function call(socket, event, payload) {
  if (!socket.connected) throw new Error(`${event} failed: socket dropped`);
  const t0 = performance.now();
  let reply;
  try {
    reply = await socket.timeout(ACK_MS).emitWithAck(event, payload);
  } catch {
    throw new Error(
      socket.connected
        ? `${event} ack timeout (${ACK_MS} ms)`
        : `${event} failed: socket dropped`,
    );
  }
  if (!reply?.ok)
    throw new Error(`${event} ${reply?.error?.code ?? "malformed ack"}`);
  return { data: reply.data, ms: performance.now() - t0 };
}

function percentiles(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return [at(0.5), at(0.95), sorted.at(-1)];
}

const cell = (n) =>
  (Number.isFinite(n) ? String(Math.round(n)) : "-").padStart(9);
function row(name, ok, times, wall, note) {
  console.log(
    name.padEnd(12) +
      ok.padStart(9) +
      percentiles(times).map(cell).join("") +
      cell(wall) +
      (note ? `   ${note}` : ""),
  );
}

// Runs fn for every item at once; fn returns the latency to record.
async function measure(name, items, fn, note = () => "") {
  const start = performance.now(),
    times = [],
    errors = new Map();
  await Promise.all(
    items.map(async (item) => {
      try {
        times.push(await fn(item));
      } catch (e) {
        errors.set(e.message, [...(errors.get(e.message) || []), item]);
      }
    }),
  );
  row(
    name,
    `${times.length}/${items.length}`,
    times,
    performance.now() - start,
    note(),
  );
  for (const [message, who] of errors)
    fail(
      `${name}: ${message} x${who.length} (${who
        .slice(0, 3)
        .map((p) => p.nickname)
        .join(", ")}${who.length > 3 ? ", ..." : ""})`,
    );
  return errors.size === 0;
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} timed out after ${ms} ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function run(ctx, N, Q) {
  // Deterministic answers: correct index rotates per question, about two thirds
  // of answers are right, and every tenth player (from the fifth) skips one question.
  const quiz = Array.from({ length: Q }, (_, q) =>
    question(`Q${q + 1}`, q % 4),
  );
  const choiceFor = (i, q) => {
    if (i % 10 === 4 && q === Math.floor(i / 10) % Q) return null;
    const correct = quiz[q].correct_index;
    return (i + q) % 3 ? correct : (correct + 1 + (i % 3)) % 4;
  };

  const { rpc, url } = (ctx.server = await startServer());
  const hostToken = await rpc(
    "addUser",
    teacherA,
    "teacher@example.test",
    true,
  );
  await rpc(
    "saveQuiz",
    JSON.stringify({
      title: "Load test",
      feedback_mode: "after_question",
      timer_enabled: false,
    }),
    JSON.stringify(quiz),
  );
  const connect = (token, label) =>
    new Promise((resolve, reject) => {
      const socket = io(url, {
        auth: { accessToken: token },
        transports: ["websocket"],
        autoConnect: false,
        reconnection: false,
      });
      sockets.push(socket);
      const timer = setTimeout(
        () => reject(new Error(`connect timeout (${ACK_MS} ms)`)),
        ACK_MS,
      );
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("connect_error", (e) => {
        clearTimeout(timer);
        reject(new Error(`connect_error ${e.message}`));
      });
      // Any drop we did not ask for fails the run, with the transport's reason.
      socket.on("disconnect", (reason, detail) => {
        if (reason === "io client disconnect") return;
        const why = detail?.description?.message ?? detail?.message;
        fail(`${label} socket dropped: ${reason}${why ? ` (${why})` : ""}`);
      });
      socket.connect();
    });

  const host = await connect(hostToken, "host");
  const hostCall = async (event, payload) => {
    try {
      return (await call(host, event, payload)).data;
    } catch (e) {
      throw new Error(`host ${e.message}`);
    }
  };
  const created = await hostCall("host_create", {
    quizId: quizA,
    maxPlayers: N,
    teamCount: TEAMS,
    requestId: randomUUID(),
  });
  const sessionId = created.sessionId,
    pin = created.lobby.pin;
  const questionIds = (await rpc("data", sessionId)).questions.map((q) => q.id);

  const players = await Promise.all(
    Array.from({ length: N }, async (_, i) => ({
      i,
      nickname: `Player ${String(i + 1).padStart(3, "0")}`,
      token: await rpc("addUser"),
      expected: quiz.reduce(
        (sum, q, qi) =>
          sum + (choiceFor(i, qi) === q.correct_index ? q.points : 0),
        0,
      ),
    })),
  );
  const connected = await measure("connect", players, async (p) => {
    const t0 = performance.now();
    p.socket = await connect(p.token, p.nickname);
    return performance.now() - t0;
  });
  if (!connected) throw new Error("not every player connected");
  const joined = await measure("join", players, async (p) => {
    const { data, ms } = await call(p.socket, "player_join", {
      pin,
      nickname: p.nickname,
    });
    p.playerId = data.playerId;
    p.teamId = data.lobby.players.find((x) => x.id === p.playerId)?.teamId;
    if (!p.teamId) throw new Error("player_join lobby lacks the new player");
    return ms;
  });
  if (!joined) throw new Error("not every player joined");

  await hostCall("game_start", { sessionId, revision: 0 });
  for (let q = 0; q < Q; q++) {
    const answering = players.filter((p) => choiceFor(p.i, q) !== null);
    const skipped = N - answering.length;
    await measure(
      `q${q + 1} answers`,
      answering,
      async (p) =>
        (
          await call(p.socket, "game_answer", {
            sessionId,
            questionId: questionIds[q],
            choice: choiceFor(p.i, q),
            requestId: randomUUID(),
          })
        ).ms,
      () => (skipped ? `${skipped} skipped` : ""),
    );
    if (q === 0) {
      // Mid-game reconnect: drop ~10% of players, resume on new sockets.
      const k = Math.max(1, Math.round(N / 10));
      const sample = Array.from(
        { length: k },
        (_, j) => players[Math.floor((j * N) / k)],
      );
      let restored = 0;
      const reconnected = await measure(
        "reconnect",
        sample,
        async (p) => {
          p.socket.disconnect();
          const t0 = performance.now();
          p.socket = await connect(p.token, p.nickname);
          const { state } = (await call(p.socket, "game_sync", { sessionId }))
            .data;
          const ms = performance.now() - t0;
          if (state.playerId !== p.playerId || state.teamId !== p.teamId)
            throw new Error(
              `restored player ${state.playerId} team ${state.teamId}, expected ${p.playerId} team ${p.teamId}`,
            );
          restored++;
          return ms;
        },
        () => `playerId + teamId restored ${restored}/${k}`,
      );
      if (!reconnected) throw new Error("reconnect failed");
    }
    let { revision } = (await hostCall("game_sync", { sessionId })).state;
    await hostCall("game_reveal", { sessionId, revision });
    ({ revision } = (await hostCall("game_sync", { sessionId })).state);
    await hostCall("game_next", { sessionId, revision });
  }

  const final = (await hostCall("game_sync", { sessionId })).state;
  const d = await rpc("data", sessionId);
  if (final.phase !== "results")
    fail(`final phase is ${final.phase}, expected results`);
  if (d.players.length !== N)
    fail(`database has ${d.players.length} players, expected ${N}`);
  if (final.leaderboard.length !== N)
    fail(
      `host leaderboard has ${final.leaderboard.length} rows, expected ${N}`,
    );
  const dbPlayers = new Map(d.players.map((p) => [p.id, p]));
  const board = new Map(final.leaderboard.map((p) => [p.id, p]));
  let exactPlayers = 0;
  for (const p of players) {
    const db = dbPlayers.get(p.playerId),
      lb = board.get(p.playerId),
      wrong = [];
    if (!db) wrong.push("missing from database");
    else {
      if (db.score !== p.expected) wrong.push(`database score ${db.score}`);
      if (String(db.team_number) !== p.teamId)
        wrong.push(`database team ${db.team_number}`);
    }
    if (!lb) wrong.push("missing from host leaderboard");
    else {
      if (lb.score !== p.expected) wrong.push(`host score ${lb.score}`);
      if (lb.teamId !== p.teamId) wrong.push(`host team ${lb.teamId}`);
    }
    if (!wrong.length) exactPlayers++;
    else
      fail(
        `${p.nickname} (team ${p.teamId}, expected ${p.expected}): ${wrong.join(", ")}`,
      );
  }
  let exactTeams = 0;
  const sizes = [];
  for (let t = 1; t <= TEAMS; t++) {
    const id = String(t),
      members = d.players.filter((p) => p.team_number === t);
    const expected = players
      .filter((p) => p.teamId === id)
      .reduce((sum, p) => sum + p.expected, 0);
    const dbTotal = members.reduce((sum, p) => sum + p.score, 0);
    const hostTotal = final.teamScores.find((x) => x.id === id)?.score;
    sizes.push(members.length);
    if (dbTotal === expected && hostTotal === expected) exactTeams++;
    else
      fail(
        `team ${id}: expected ${expected}, database ${dbTotal}, host ${hostTotal ?? "missing"}`,
      );
  }
  const balanced = Math.max(...sizes) - Math.min(...sizes) <= 1;
  if (!balanced) fail(`team sizes unbalanced: ${sizes.join("/")}`);
  console.log(
    `${"scores".padEnd(12)}${exactPlayers}/${N} players exact, ${exactTeams}/${TEAMS} teams exact, team sizes ${sizes.join("/")} ${balanced ? "(balanced)" : "(UNBALANCED)"}`,
  );
}

// Child process: the real app on PGlite, answering the parent's fixture requests.
async function serve() {
  const f = await database(),
    repo = fixtureRepository(f);
  const app = createApp({
    config: { origins: ["http://localhost:5173"] },
    repository: repo,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  const ops = {
    addUser: async (...args) => repo.tokenFor(await repo.addUser(...args)),
    saveQuiz: (quiz, questions) =>
      f.as(teacherA, "select public.save_quiz($1,0,$2,$3)", [
        quizA,
        quiz,
        questions,
      ]),
    data: (id) => f.data(id),
    close: async () => {
      await app.close();
      await f.close();
    },
  };
  process.on("message", async ({ id, op, args }) => {
    try {
      process.send({ id, result: await ops[op](...args) });
    } catch (e) {
      process.send({ id, error: e.message });
    }
    // With the app and database closed, the child exits on its own unless a handle leaks.
    if (op === "close") process.disconnect();
  });
  process.send({ port: app.httpServer.address().port });
}

async function startServer() {
  const child = fork(fileURLToPath(import.meta.url), ["--serve"]);
  const pending = new Map();
  let seq = 0;
  const exited = once(child, "exit");
  child.on("message", (m) => {
    const call = pending.get(m.id);
    if (!call) return;
    pending.delete(m.id);
    if (m.error) call.reject(new Error(m.error));
    else call.resolve(m.result);
  });
  child.on("exit", (code) => {
    for (const call of pending.values())
      call.reject(new Error(`server process exited (${code})`));
    pending.clear();
  });
  const rpc = (op, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      child.send({ id, op, args });
    });
  const [{ port }] = await Promise.race([
    once(child, "message"),
    exited.then(([code]) => {
      throw new Error(`server process exited (${code}) before listening`);
    }),
  ]);
  return { child, rpc, exited, url: `http://127.0.0.1:${port}` };
}

async function shutdown(ctx) {
  for (const s of sockets) s.disconnect();
  const server = ctx.server,
    problems = [],
    t0 = performance.now();
  if (server) {
    try {
      // The server first drains one roster broadcast per disconnect, so allow time.
      await withTimeout(
        server.rpc("close"),
        30000,
        "server and database close",
      );
      const [code] = await withTimeout(server.exited, 5000, "server exit");
      if (code !== 0) throw new Error(`server process exited with ${code}`);
    } catch (e) {
      server.child.kill();
      problems.push(e.message);
      fail(`unclean shutdown: ${e.message}`);
    }
  }
  console.log(
    `${"shutdown".padEnd(12)}${problems.length ? `UNCLEAN: ${problems.join("; ")}` : `clean: ${sockets.length} sockets disconnected, server and database closed and process exited in ${Math.round(performance.now() - t0)} ms`}`,
  );
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}\nRun with --help for usage.`);
    process.exitCode = 2;
    return;
  }
  if (!opts) return console.log(usage);
  const { players: N, questions: Q } = opts;
  const started = performance.now(),
    ctx = {};
  console.log(
    `Grasp load test: ${N} players, ${Q} questions, ${TEAMS} teams, after_question feedback, timer off`,
  );
  console.log(
    "embedded PGlite + local fixture auth, 127.0.0.1; latencies are local and not representative of hosted Postgres",
  );
  console.log(
    `(server in a child process, clients in this one; ack timeout ${ACK_MS} ms)\n`,
  );
  console.log(
    "phase".padEnd(12) +
      ["ok", "p50 ms", "p95 ms", "max ms", "wall ms"]
        .map((h) => h.padStart(9))
        .join(""),
  );
  try {
    await run(ctx, N, Q);
  } catch (e) {
    console.log(`${"aborted".padEnd(12)}${e.message}`);
    fail(`aborted: ${e.message}`);
  }
  await shutdown(ctx);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const message of failures) console.log(`  - ${message}`);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `\n${failures.length ? "FAIL" : "PASS"}  ${N} players, ${Q} questions, ${seconds} s total`,
  );
  process.exitCode = failures.length ? 1 : 0;
  // If anything still holds the event loop open, report it instead of hanging.
  setTimeout(() => {
    console.log("unclean shutdown: open handles");
    process.exit(1);
  }, 3000).unref();
}

for (const event of ["uncaughtException", "unhandledRejection"])
  process.on(event, (e) => {
    console.error(`load test crashed: ${e?.message ?? e}`);
    process.exit(1);
  });
if (process.argv[2] === "--serve") await serve();
else await main();
