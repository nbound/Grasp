import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";
import { io } from "socket.io-client";
import { readConfig } from "../src/config.js";
import {
  assertSmokeTarget,
  cleanupSmokeFixtures,
  parseSmokeOptions,
} from "./hostedSmokeSupport.js";

// Opt-in only. This script writes disposable test fixtures to the explicitly
// named hosted project. Normal tests/CI never import or run this entry point.
let stage = "configuration";
let admin;
let interrupted = false;
let terminal;
let holdController;
let manual = false;
let hostConnectionLost = false;
const fixtures = { quizzes: [], users: [] };
const sockets = [];
const runId = randomUUID();
const interrupt = () => {
  interrupted = true;
  holdController?.abort();
  sockets.forEach((socket) => socket.disconnect());
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const requireCheck = (condition) => {
  if (!condition) throw new Error("Smoke check failed");
};
const ok = (response) => {
  requireCheck(!response.error);
  return response.data;
};

try {
  const options = parseSmokeOptions(process.argv.slice(2));
  for (const name of [".env.local", ".env"]) {
    const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
    if (existsSync(path)) process.loadEnvFile(path);
  }
  const config = readConfig();
  assertSmokeTarget(config, options.projectRef);
  if (options.hold && !process.stdin.isTTY)
    throw new Error("Interactive terminal required");
  const endpoint = `http://localhost:${config.port}`;
  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, init) => {
        if (interrupted) throw new Error("Interrupted");
        return fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
      },
    },
  };
  // Cleanup requests must remain possible after Ctrl+C.
  admin = createClient(config.supabaseUrl, config.secretKey, {
    ...clientOptions,
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
  const client = () =>
    createClient(config.supabaseUrl, config.publishableKey, clientOptions);
  console.log(`Fixture label: Grasp smoke ${runId}`);
  stage =
    "local backend health (start/restart the backend with the new project configuration)";
  const health = await fetch(`${endpoint}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  requireCheck(health.ok && (await health.json()).status === "ok");

  const connect = (token) =>
    new Promise((resolve, reject) => {
      if (interrupted) return reject(new Error("Interrupted"));
      const socket = io(endpoint, {
        auth: { accessToken: token },
        transports: ["websocket"],
        reconnection: false,
        autoConnect: false,
        timeout: 8000,
        extraHeaders: { Origin: "http://localhost:5173" },
      });
      sockets.push(socket);
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error("Connection timeout"));
      }, 9000);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
      socket.once("connect_error", () => {
        clearTimeout(timer);
        reject(new Error("Connection failed"));
      });
      socket.connect();
    });
  const emit = (socket, event, data) => {
    requireCheck(!interrupted && socket.connected);
    return socket.timeout(8000).emitWithAck(event, data);
  };
  const teacher = async (label) => {
    const email = `grasp-smoke-${label}-${runId}@example.test`;
    const password = randomUUID() + "Aa1!";
    const user = ok(
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: `Smoke ${label}` },
      }),
    ).user;
    fixtures.users.push(user.id);
    const api = client();
    const session = ok(
      await api.auth.signInWithPassword({ email, password }),
    ).session;
    requireCheck(session?.user.is_anonymous === false);
    return { api, id: user.id, socket: await connect(session.access_token) };
  };

  stage =
    "teacher provisioning, password login, and authenticated socket connection";
  const host = await teacher("host");
  host.socket.on("disconnect", () => {
    if (manual) {
      hostConnectionLost = true;
      console.error(
        "Host connection lost during browser testing. Finish this run and retry after checking the backend.",
      );
    }
  });
  const other = await teacher("other");
  console.log("PASS teacher login and authenticated connections");

  stage = "teacher-owned quiz and question creation through RLS";
  const quiz = ok(
    await host.api
      .from("quizzes")
      .insert({
        teacher_id: host.id,
        title: `Grasp smoke ${runId}`,
      })
      .select("id")
      .single(),
  );
  fixtures.quizzes.push({ id: quiz.id, teacherId: host.id });
  ok(
    await host.api
      .from("questions")
      .insert({
        quiz_id: quiz.id,
        position: 0,
        prompt: "Two plus two?",
        choices: ["1", "2", "3", "4"],
        correct_index: 3,
        explanation: "Two plus two is four.",
      }),
  );
  requireCheck(
    ok(await other.api.from("quizzes").select("id").eq("id", quiz.id))
      .length === 0,
  );
  requireCheck(
    (await emit(other.socket, "host_create", { quizId: quiz.id })).error
      ?.code === "FORBIDDEN",
  );
  console.log("PASS quiz creation and teacher ownership isolation");

  stage = "teacher hosting and lobby creation";
  const hosted = await emit(host.socket, "host_create", { quizId: quiz.id });
  requireCheck(hosted.ok === true && /^\d{6}$/.test(hosted.data?.lobby.pin));
  const { pin, sessionId } = hosted.data.lobby;
  let observedLobby;
  host.socket.on("lobby_update", (lobby) => {
    observedLobby = lobby;
    if (manual)
      console.log(`Connected browser players: ${lobby.players.length}`);
  });
  const guests = [];
  for (let i = 0; i < 3; i++) {
    stage = `anonymous sign-in and student join ${i + 1} (check anonymous Auth/CAPTCHA/rate limits)`;
    const api = client();
    const signed = ok(await api.auth.signInAnonymously());
    fixtures.users.push(signed.user.id);
    requireCheck(signed.user.is_anonymous === true);
    const socket = await connect(signed.session.access_token);
    if (i === 1) {
      const duplicate = await emit(socket, "player_join", {
        pin,
        nickname: "Smoke 1",
      });
      requireCheck(duplicate.error?.code === "DUPLICATE_NICKNAME");
    }
    requireCheck(
      (await emit(socket, "host_create", { quizId: quiz.id })).error?.code ===
        "FORBIDDEN",
    );
    const questions = await api
      .from("questions")
      .select("correct_index")
      .eq("quiz_id", quiz.id);
    requireCheck(!questions.error && questions.data.length === 0);
    const joined = await emit(socket, "player_join", {
      pin,
      nickname: `Smoke ${i + 1}`,
    });
    requireCheck(
      joined.ok === true && joined.data?.lobby.players.length === i + 1,
    );
    requireCheck(joined.data.lobby.sessionId === sessionId);
    requireCheck(
      joined.data.lobby.players.every(
        (player) =>
          Object.keys(player).sort().join(",") === "id,nickname,teamId",
      ),
    );
    guests.push({
      socket,
      token: signed.session.access_token,
      playerId: joined.data.playerId,
      teamId: joined.data.lobby.players.find(
        (player) => player.id === joined.data.playerId,
      )?.teamId,
    });
  }
  stage = "live host roster and balanced teams";
  for (let i = 0; i < 40 && observedLobby?.players.length !== 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  requireCheck(observedLobby?.players.length === 3);
  const sizes = observedLobby.teams.map(
    (team) =>
      observedLobby.players.filter((player) => player.teamId === team.id)
        .length,
  );
  requireCheck(Math.max(...sizes) - Math.min(...sizes) <= 1);
  console.log(
    "PASS three guest joins, duplicate rejection, protected answer keys, and live roster",
  );

  stage = "reconnect retains the player and team";
  await emit(guests[0].socket, "player_left", {});
  guests[0].socket.disconnect();
  const resumed = await connect(guests[0].token);
  const rejoined = await emit(resumed, "player_join", {
    pin,
    nickname: "Smoke 1",
  });
  requireCheck(rejoined.ok && rejoined.data.playerId === guests[0].playerId);
  requireCheck(rejoined.data.lobby.players.length === 3);
  requireCheck(
    rejoined.data.lobby.players.find(
      (player) => player.id === guests[0].playerId,
    )?.teamId === guests[0].teamId,
  );
  guests[0].socket = resumed;
  console.log("PASS reconnect preserves player identity and team");

  if (options.hold) {
    stage = "interactive browser testing";
    for (const guest of guests) {
      await emit(guest.socket, "player_left", {});
      guest.socket.disconnect();
    }
    manual = true;
    console.log(`Browser test PIN: ${pin}`);
    console.log(
      "Open http://localhost:5173/join in three separate browser profiles. Keep this terminal open.",
    );
    console.log(
      "Browser-created guest Auth accounts are not deleted by this test.",
    );
    terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    holdController = new AbortController();
    terminal.once("close", () => holdController?.abort());
    const timer = setTimeout(() => holdController.abort(), 20 * 60 * 1000);
    try {
      await terminal.question(
        "Press Enter when finished (20-minute maximum) to remove this test lobby. ",
        { signal: holdController.signal },
      );
    } catch (error) {
      if (error.name !== "AbortError") throw error;
    } finally {
      clearTimeout(timer);
      terminal.close();
      terminal = undefined;
      holdController = undefined;
    }
    if (!interrupted) requireCheck(!hostConnectionLost);
  }
  if (interrupted) process.exitCode = 130;
  else
    console.log(
      "PASS hosted backend smoke checks; teacher signup/email delivery and teacher UI were not tested.",
    );
} catch {
  process.exitCode = 1;
  console.error(
    `FAIL at ${stage}. No credentials or raw server errors were printed.`,
  );
  if (stage === "configuration")
    console.error(
      "Use --project-ref NEW_PROJECT_REF matching server/.env.local; --hold needs an interactive terminal.",
    );
} finally {
  manual = false;
  terminal?.close();
  sockets.forEach((socket) => socket.disconnect());
  if (admin) {
    const failures = await cleanupSmokeFixtures(admin, fixtures);
    if (failures) {
      process.exitCode = 1;
      console.error(
        "Some fixture cleanup failed. Inspect only this run's labelled test records in the new project.",
      );
    } else
      console.log(
        "Tracked test fixtures removed. A timed-out write may require checking this run's fixture label.",
      );
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
