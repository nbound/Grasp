import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { PublicError } from "./errors.js";
import {
  SessionManager,
  validateHost,
  validateJoin,
  validateSessionId,
} from "./sessionManager.js";

export function createApp({ config, repository }) {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: config.origins, methods: ["GET", "POST"] },
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin || config.origins.includes(req.headers.origin),
      ),
    maxHttpBufferSize: 16384,
    serveClient: false,
  });
  const manager = new SessionManager(repository);
  const room = (id) => `session:${id}`;
  const broadcasts = new Map();
  // Bound retry pressure per verified identity, across tabs and reconnections.
  const budgets = new Map();
  function consume(id) {
    const now = Date.now();
    for (const [key, entry] of budgets)
      if (entry.until <= now) budgets.delete(key);
    let entry = budgets.get(id);
    if (!entry) {
      if (budgets.size >= 10000) throw new PublicError("SERVER_BUSY");
      entry = { until: now + 60000, count: 0 };
      budgets.set(id, entry);
    }
    if (++entry.count > 30) throw new PublicError("RATE_LIMITED");
  }
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.accessToken;
      socket.data.user = await repository.authenticate(token);
      socket.data.token = token;
      consume(socket.data.user.id);
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });
  function broadcast(sessionId) {
    // Serialize snapshots per room so a slow earlier query cannot overwrite a newer roster.
    const pending = (broadcasts.get(sessionId) || Promise.resolve())
      .then(async () => {
        try {
          io.to(room(sessionId)).emit(
            "lobby_update",
            await manager.snapshot(sessionId),
          );
        } catch {
          /* A closed/unavailable session must not leak database errors. */
        }
      })
      .finally(() => {
        if (broadcasts.get(sessionId) === pending) broadcasts.delete(sessionId);
      });
    broadcasts.set(sessionId, pending);
    return pending;
  }
  io.on("connection", (socket) => {
    let busy = false;
    // Revalidate idle subscribers too; tokens/revocations cannot keep a room open indefinitely.
    const recheck = setInterval(async () => {
      try {
        await repository.authenticate(socket.data.token);
      } catch {
        socket.disconnect(true);
      }
    }, 60000);
    recheck.unref();
    async function move(membership) {
      const old = manager.detach(socket.id);
      if (old) await socket.leave(room(old.sessionId));
      if (!socket.connected) return;
      manager.attach(socket.id, membership);
      await socket.join(room(membership.sessionId));
      if (!socket.connected) manager.detach(socket.id);
      if (old && old.sessionId !== membership.sessionId)
        await broadcast(old.sessionId);
    }
    function handle(event, operation) {
      socket.on(event, async (payload, ack) => {
        // Leaves from the existing frontend have no acknowledgement.
        if (event !== "player_left" && typeof ack !== "function") return;
        const reply = typeof ack === "function" ? ack : () => {};
        if (busy) return reply({ ok: false, error: { code: "SERVER_BUSY" } });
        busy = true;
        try {
          consume(socket.data.user.id);
          const user = await repository.authenticate(socket.data.token);
          if (user.id !== socket.data.user.id)
            throw new PublicError("UNAUTHORIZED");
          const data = await operation(payload, user);
          if (socket.connected) reply({ ok: true, data });
          const membership = manager.memberships.get(socket.id);
          if (membership) void broadcast(membership.sessionId);
        } catch (error) {
          reply({
            ok: false,
            error: {
              code: error instanceof PublicError ? error.code : "SERVER_ERROR",
            },
          });
        } finally {
          busy = false;
        }
      });
    }
    handle("host_create", async (payload, user) => {
      const values = validateHost(payload);
      if (user.is_anonymous !== false) throw new PublicError("FORBIDDEN");
      const current = manager.memberships.get(socket.id);
      const sessionId =
        current?.hostQuizId === values.quizId
          ? current.sessionId
          : await repository.host(user, socket.data.token, values);
      if (!socket.connected) return;
      await move({ sessionId, hostQuizId: values.quizId });
      const lobby = await manager.snapshot(sessionId);
      return { lobby };
    });
    handle("host_join", async (payload, user) => {
      const sessionId = await repository.resumeHost(
        user,
        socket.data.token,
        validateSessionId(payload?.sessionId),
      );
      if (!socket.connected) return;
      await move({ sessionId });
      return { lobby: await manager.snapshot(sessionId) };
    });
    handle("player_join", async (payload, user) => {
      const membership = await repository.join(
        user,
        socket.data.token,
        validateJoin(payload),
      );
      if (!socket.connected) return;
      await move(membership);
      const lobby = await manager.snapshot(membership.sessionId);
      return { playerId: membership.playerId, lobby };
    });
    handle("player_left", async () => {
      const previous = manager.detach(socket.id);
      if (previous) {
        await socket.leave(room(previous.sessionId));
        await broadcast(previous.sessionId);
      }
      return {};
    });
    socket.on("disconnect", () => {
      clearInterval(recheck);
      const previous = manager.detach(socket.id);
      if (previous) void broadcast(previous.sessionId);
    });
  });
  return {
    app,
    io,
    httpServer,
    manager,
    close: () => new Promise((resolve) => io.close(resolve)),
  };
}
