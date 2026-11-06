import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { io } from "socket.io-client";
import { createRepository } from "../src/repository.js";
import { createApp } from "../src/app.js";

// Opt-in, local-only. Never loads application .env files or uses hosted credentials.
test(
  "real Auth -> teacher quiz -> socket host -> three guests -> reconnect",
  { timeout: 60000 },
  async () => {
    let stage = "local Supabase status (start Docker and supabase start first)";
    const users = [],
      sessions = [],
      quizzes = [],
      sockets = [];
    let server, admin;
    try {
      const command = process.platform === "win32" ? "cmd.exe" : "npx";
      const args =
        process.platform === "win32"
          ? ["/d", "/s", "/c", "npx --no-install supabase status -o json"]
          : ["--no-install", "supabase", "status", "-o", "json"];
      const status = JSON.parse(
        execFileSync(command, args, {
          cwd: fileURLToPath(new URL("../../", import.meta.url)),
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15000,
        }),
      );
      const base = new URL(status.API_URL);
      assert.ok(
        ["localhost", "127.0.0.1"].includes(base.hostname) &&
          base.port === "54321",
      );
      const config = {
        supabaseUrl: base.origin,
        publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY,
        secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
        origins: ["http://localhost:5173"],
      };
      const options = {
        auth: { persistSession: false, autoRefreshToken: false },
      };
      admin = createClient(config.supabaseUrl, config.secretKey, options);
      const teacherClient = createClient(
        config.supabaseUrl,
        config.publishableKey,
        options,
      );
      const ok = (response) => {
        if (response.error) throw new Error("Supabase operation failed");
        return response.data;
      };
      stage = "teacher signup and login";
      const email = `grasp-socket-${randomUUID()}@example.test`;
      const password = randomUUID() + "Aa1!";
      const teacher = ok(
        await teacherClient.auth.signUp({ email, password }),
      ).user;
      users.push(teacher.id);
      ok(
        await admin.auth.admin.updateUserById(teacher.id, {
          email_confirm: true,
        }),
      );
      const teacherSession = ok(
        await teacherClient.auth.signInWithPassword({ email, password }),
      ).session;
      stage = "RLS quiz creation";
      const quiz = ok(
        await teacherClient
          .from("quizzes")
          .insert({
            teacher_id: teacher.id,
            title: "Socket integration fixture",
          })
          .select("id")
          .single(),
      );
      quizzes.push(quiz.id);
      ok(
        await teacherClient
          .from("questions")
          .insert({
            quiz_id: quiz.id,
            position: 0,
            prompt: "Two plus two?",
            choices: ["1", "2", "3", "4"],
            correct_index: 3,
          }),
      );
      server = createApp({ config, repository: createRepository(config) });
      server.httpServer.listen(0, "127.0.0.1");
      await once(server.httpServer, "listening");
      const endpoint = `http://127.0.0.1:${server.httpServer.address().port}`;
      const connect = async (token) => {
        const socket = io(endpoint, {
          auth: { accessToken: token },
          transports: ["websocket"],
          reconnection: false,
          autoConnect: false,
        });
        sockets.push(socket);
        await new Promise((resolve, reject) => {
          socket.once("connect", resolve);
          socket.once("connect_error", () =>
            reject(new Error("Connection failed")),
          );
          socket.connect();
        });
        return socket;
      };
      const emit = (socket, event, data) =>
        socket.timeout(8000).emitWithAck(event, data);
      stage = "teacher hosting";
      const host = await connect(teacherSession.access_token);
      const created = await emit(host, "host_create", { quizId: quiz.id });
      assert.equal(created.ok, true);
      const { sessionId, pin } = created.data.lobby;
      sessions.push(sessionId);
      stage = "three anonymous joins and sanitized roster";
      const guests = [];
      for (let i = 0; i < 3; i++) {
        const client = createClient(
          config.supabaseUrl,
          config.publishableKey,
          options,
        );
        const guest = ok(await client.auth.signInAnonymously());
        users.push(guest.user.id);
        const socket = await connect(guest.session.access_token);
        const joined = await emit(socket, "player_join", {
          pin,
          nickname: `Guest ${i}`,
        });
        assert.equal(joined.ok, true);
        assert.equal(joined.data.lobby.players.length, i + 1);
        assert.deepEqual(Object.keys(joined.data.lobby.players[0]).sort(), [
          "id",
          "nickname",
          "teamId",
        ]);
        assert.equal(
          (await emit(socket, "host_create", { quizId: quiz.id })).error.code,
          "FORBIDDEN",
        );
        guests.push({
          socket,
          token: guest.session.access_token,
          playerId: joined.data.playerId,
        });
      }
      stage = "rejoin keeps database identity";
      await emit(guests[0].socket, "player_left", {});
      const reconnected = await connect(guests[0].token);
      const joined = await emit(reconnected, "player_join", {
        pin,
        nickname: "Guest 0",
      });
      assert.equal(joined.data.playerId, guests[0].playerId);
      assert.equal(joined.data.lobby.players.length, 3);
    } catch {
      // CLI and SDK errors can contain credentials. Only the test stage is reported.
      throw new Error(`Local integration failed at: ${stage}`);
    } finally {
      sockets.forEach((socket) => socket.disconnect());
      if (server) await server.close();
      if (admin) {
        for (const id of sessions)
          await admin.from("game_sessions").delete().eq("id", id);
        for (const id of quizzes)
          await admin.from("quizzes").delete().eq("id", id);
        for (const id of users) await admin.auth.admin.deleteUser(id);
      }
    }
  },
);
