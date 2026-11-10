import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { PublicError } from "./errors.js";
import { gameView, csv } from "./game/state.js";
import { timingSafeEqual } from "node:crypto";
import { studyRoutes } from "./study.js";
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
  const dirty = new Set();
  // Bound retry pressure per verified identity, across tabs and reconnections.
  const budgets = new Map();
  function consume(id, limit = 30) {
    const now = Date.now();
    for (const [key, entry] of budgets)
      if (entry.until <= now) budgets.delete(key);
    let entry = budgets.get(id);
    if (!entry) {
      if (budgets.size >= 10000) throw new PublicError("SERVER_BUSY");
      entry = { until: now + 60000, count: 0 };
      budgets.set(id, entry);
    }
    if (++entry.count > limit) throw new PublicError("RATE_LIMITED");
  }
  io.use(async (socket, next) => {
    try {
      consume(`ip:${socket.handshake.address}`, 1200);
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
    dirty.add(sessionId);
    if (broadcasts.has(sessionId)) return broadcasts.get(sessionId);
    // Serialize snapshots per room so a slow earlier query cannot overwrite a newer roster.
    const pending = (broadcasts.get(sessionId) || Promise.resolve())
      .then(async () => {
        do {
          dirty.delete(sessionId);
          try {
            io.to(room(sessionId)).emit(
              "lobby_update",
              await manager.snapshot(sessionId),
            );
          } catch {
            /* A closed/unavailable session must not leak database errors. */
          }
          if (repository.gameData) {
            try {
              const data = await repository.gameData(sessionId);
              const members = [...manager.memberships.entries()].filter(
                ([, m]) => m.sessionId === sessionId,
              );
              const presence = new Set(
                members.map(([, m]) => m.playerId).filter(Boolean),
              );
              for (const [id, m] of members) {
                try {
                  io.to(id).emit(
                    "game_update",
                    gameView(data, m.userId, presence),
                  );
                } catch {
                  /* Membership revoked. */
                }
              }
            } catch {
              /* Next sync retries from durable state. */
            }
          }
        } while (dirty.has(sessionId));
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
      manager.attach(socket.id, { ...membership, userId: socket.data.user.id });
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
      try {
        return { sessionId, lobby: await manager.snapshot(sessionId) };
      } catch (error) {
        if (
          error instanceof PublicError &&
          error.code === "SESSION_CLOSED" &&
          repository.state
        )
          return { sessionId, state: await repository.state(user, sessionId) };
        throw error;
      }
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
    handle("game_sync", async (payload, user) => {
      const sessionId = validateSessionId(payload?.sessionId);
      const state = await repository.state(
        user,
        sessionId,
        new Set([...manager.memberships.values()].map((m) => m.playerId)),
      );
      const membership = state.isHost
        ? { sessionId }
        : await repository.resumePlayer(user, sessionId);
      await move(membership);
      return { state };
    });
    for (const action of ["start", "reveal", "next", "end", "answer"]) {
      handle(`game_${action}`, async (payload, user) => {
        const sessionId = validateSessionId(payload?.sessionId);
        if (action === "answer") {
          validateSessionId(payload?.questionId);
          validateSessionId(payload?.requestId);
          if (
            !Number.isInteger(payload.choice) ||
            payload.choice < 0 ||
            payload.choice > 5
          )
            throw new PublicError("INVALID_INPUT");
        } else if (!Number.isInteger(payload?.revision))
          throw new PublicError("INVALID_INPUT");
        const result = await repository.command(
          user,
          sessionId,
          action,
          payload,
        );
        void broadcast(sessionId);
        return result;
      });
    }
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
  // HTTP uses the same verified identities and ownership rules as sockets.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin))
      return res.status(403).json({ error: { code: "FORBIDDEN" } });
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type",
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const route = (handler) => async (req, res) => {
    try {
      consume(`ip:${req.socket.remoteAddress}`, 1200);
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      const user = await repository.authenticate(token);
      consume(user.id);
      await handler(req, res, user, token);
    } catch (error) {
      const code = error instanceof PublicError ? error.code : "SERVER_ERROR";
      res
        .status(
          code === "UNAUTHORIZED"
            ? 401
            : code === "FORBIDDEN"
              ? 403
              : code === "RATE_LIMITED"
                ? 429
                : 400,
        )
        .json({ error: { code } });
    }
  };
  app.post(
    "/api/teacher/enroll",
    route(async (req, res, user) => {
      const supplied = Buffer.from(String(req.body?.code || ""));
      const expected = Buffer.from(config.teacherSignupCode || "");
      if (
        !expected.length ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected)
      )
        throw new PublicError("FORBIDDEN");
      res.json(await repository.enroll(user));
    }),
  );
  app.get(
    "/api/history",
    route(async (req, res, user) =>
      res.json(await repository.history(user, req.query.role === "teacher")),
    ),
  );
  app.get(
    "/api/sessions/:id/results.csv",
    route(async (req, res, user) => {
      const state = await repository.state(
        user,
        validateSessionId(req.params.id),
      );
      if (state.phase !== "results") throw new PublicError("RESULTS_NOT_READY");
      res
        .type("text/csv")
        .attachment(`grasp-${state.sessionId}.csv`)
        .send(csv(state.results));
    }),
  );
  studyRoutes(app, route, repository);
  const expiry = setInterval(async () => {
    try {
      for (const id of (await repository.expire?.()) || []) void broadcast(id);
    } catch {
      /* Retry next tick. */
    }
  }, 1000);
  expiry.unref();
  app.use((error, _req, res, _next) =>
    res
      .status(error.type === "entity.too.large" ? 413 : 400)
      .json({ error: { code: "INVALID_INPUT" } }),
  );
  return {
    app,
    io,
    httpServer,
    manager,
    close: () => {
      clearInterval(expiry);
      return new Promise((resolve) => io.close(resolve));
    },
  };
}
