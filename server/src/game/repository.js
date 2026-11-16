import { PublicError } from "../errors.js";
import { gameView } from "./state.js";

const codes = new Set([
  "NOT_FOUND",
  "STALE_VERSION",
  "FORBIDDEN",
  "INVALID_INPUT",
  "EMPTY_QUIZ",
  "NEED_PLAYERS",
  "INVALID_PHASE",
  "ANSWER_CLOSED",
  "WRONG_QUESTION",
  "ALREADY_ANSWERED",
  "SESSION_CLOSED",
]);
export function unwrap({ data, error }) {
  if (error)
    throw new PublicError(
      codes.has(error.message)
        ? error.message
        : error.code === "42501"
          ? "FORBIDDEN"
          : "SERVER_ERROR",
    );
  return data;
}

export function gameRepository(admin) {
  return {
    async teacher(user) {
      if (user.is_anonymous !== false) throw new PublicError("FORBIDDEN");
      const row = unwrap(
        await admin
          .from("teachers")
          .select("id")
          .eq("id", user.id)
          .maybeSingle(),
      );
      if (!row) throw new PublicError("FORBIDDEN");
      return row;
    },
    async enroll(user) {
      if (user.is_anonymous !== false || !user.email_confirmed_at)
        throw new PublicError("VERIFY_EMAIL");
      unwrap(
        await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { ...user.app_metadata, grasp_role: "teacher" },
        }),
      );
      return { role: "teacher" };
    },
    async gameData(sessionId) {
      // Recover timed-out phases after restarts, even before the scheduler catches up.
      unwrap(
        await admin.rpc("game_command", {
          p_user: null,
          p_session: sessionId,
          p_action: "expire",
          p_payload: {},
        }),
      );
      return unwrap(await admin.rpc("game_data", { p_session: sessionId }));
    },
    async state(user, sessionId, presence) {
      const data = await this.gameData(sessionId);
      if (data?.session.host_id === user.id) await this.teacher(user);
      return gameView(data, user.id, presence);
    },
    async command(user, sessionId, action, payload) {
      if (action !== "answer") await this.teacher(user);
      return unwrap(
        await admin.rpc("game_command", {
          p_user: user.id,
          p_session: sessionId,
          p_action: action,
          p_payload: payload,
        }),
      );
    },
    async resumePlayer(user, sessionId) {
      const player = unwrap(
        await admin
          .from("players")
          .select("id")
          .eq("session_id", sessionId)
          .eq("user_id", user.id)
          .maybeSingle(),
      );
      if (!player) throw new PublicError("FORBIDDEN");
      return { sessionId, playerId: player.id };
    },
    async expire() {
      const sessions = unwrap(
        await admin
          .from("game_sessions")
          .select("id")
          .neq("status", "finished")
          .or(
            `deadline.lte.${new Date().toISOString()},expires_at.lte.${new Date().toISOString()}`,
          )
          .limit(200),
      );
      for (const s of sessions)
        unwrap(
          await admin.rpc("game_command", {
            p_user: null,
            p_session: s.id,
            p_action: "expire",
            p_payload: {},
          }),
        );
      return sessions.map((s) => s.id);
    },
    async history(user, teacher = false) {
      if (teacher) {
        await this.teacher(user);
        return unwrap(
          await admin
            .from("game_sessions")
            .select(
              "id,join_code,status,phase,created_at,finished_at,game_mode,quizzes(title),players(count)",
            )
            .eq("host_id", user.id)
            .order("created_at", { ascending: false })
            .limit(100),
        );
      }
      return unwrap(
        await admin
          .from("players")
          .select(
            "id,nickname,session_id,game_sessions(id,status,phase,created_at,finished_at,game_mode,quizzes(title))",
          )
          .eq("user_id", user.id)
          .order("joined_at", { ascending: false })
          .limit(100),
      );
    },
  };
}
