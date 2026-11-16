import { createClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { PublicError, joinError } from "./errors.js";
import { gameRepository } from "./game/repository.js";
import { studyRepository } from "./study.js";

const auth = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};
const transport = {
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(6000) }),
};
function result({ data, error }) {
  if (error) throw new PublicError("SERVER_ERROR");
  return data;
}

export function createRepository(config) {
  // This client never leaves the server. User operations below use a separate RLS client.
  const admin = createClient(config.supabaseUrl, config.secretKey, {
    auth,
    global: transport,
  });
  const asUser = (token) =>
    createClient(config.supabaseUrl, config.publishableKey, {
      auth,
      global: transport,
      accessToken: async () => token,
    });
  return {
    ...gameRepository(admin),
    ...studyRepository(admin),
    async authenticate(token) {
      if (typeof token !== "string" || token.length > 8192 || !token)
        throw new PublicError("UNAUTHORIZED");
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data?.user) throw new PublicError("UNAUTHORIZED");
      return data.user;
    },
    async host(user, token, { quizId, maxPlayers, teamCount, requestId }) {
      if (user.is_anonymous !== false) throw new PublicError("FORBIDDEN");
      const client = asUser(token);
      if (requestId) {
        const existing = result(
          await client
            .from("game_sessions")
            .select("id")
            .eq("host_id", user.id)
            .eq("request_id", requestId)
            .maybeSingle(),
        );
        if (existing) return existing.id;
      }
      const quiz = result(
        await client
          .from("quizzes")
          .select("id")
          .eq("id", quizId)
          .maybeSingle(),
      );
      if (!quiz) throw new PublicError("FORBIDDEN");
      for (let attempt = 0; attempt < 10; attempt++) {
        const { data, error } = await client
          .from("game_sessions")
          .insert({
            quiz_id: quizId,
            host_id: user.id,
            join_code: String(randomInt(0, 1000000)).padStart(6, "0"),
            max_players: maxPlayers,
            team_count: teamCount,
            ...(requestId ? { request_id: requestId } : {}),
          })
          .select("id")
          .single();
        if (!error) return data.id;
        if (requestId && error.code === "23505") {
          const existing = result(
            await client
              .from("game_sessions")
              .select("id")
              .eq("host_id", user.id)
              .eq("request_id", requestId)
              .maybeSingle(),
          );
          if (existing) return existing.id;
        }
        if (error.code !== "23505") throw new PublicError("SERVER_ERROR");
      }
      throw new PublicError("SERVER_BUSY");
    },
    async resumeHost(user, token, sessionId) {
      if (user.is_anonymous !== false) throw new PublicError("FORBIDDEN");
      const session = result(
        await asUser(token)
          .from("game_sessions")
          .select("id,host_id")
          .eq("id", sessionId)
          .maybeSingle(),
      );
      if (!session || session.host_id !== user.id)
        throw new PublicError("FORBIDDEN");
      return session.id;
    },
    async join(user, token, { pin, nickname }) {
      const session = result(
        await admin
          .from("game_sessions")
          .select("id,status,expires_at")
          .eq("join_code", pin)
          .maybeSingle(),
      );
      if (!session) throw new PublicError("BAD_PIN");
      if (
        session.status !== "lobby" ||
        Date.parse(session.expires_at) <= Date.now()
      )
        throw new PublicError("SESSION_CLOSED");
      // join_game requires auth.uid(): never call it with the service key.
      const { data: playerId, error } = await asUser(token).rpc("join_game", {
        p_code: pin,
        p_nickname: nickname,
      });
      if (error) throw joinError(error);
      const player = result(
        await admin
          .from("players")
          .select("id,session_id,user_id")
          .eq("id", playerId)
          .single(),
      );
      if (player.user_id !== user.id || player.session_id !== session.id)
        throw new PublicError("FORBIDDEN");
      return { playerId, sessionId: session.id };
    },
    async lobby(sessionId) {
      const session = result(
        await admin
          .from("game_sessions")
          .select("id,join_code,status,expires_at")
          .eq("id", sessionId)
          .single(),
      );
      if (
        session.status !== "lobby" ||
        Date.parse(session.expires_at) <= Date.now()
      )
        throw new PublicError("SESSION_CLOSED");
      const [teams, players] = await Promise.all([
        admin
          .from("teams")
          .select("team_number,name")
          .eq("session_id", sessionId)
          .order("team_number"),
        admin
          .from("players")
          .select("id,nickname,team_number")
          .eq("session_id", sessionId)
          .order("joined_at"),
      ]);
      // Explicit allowlist: no auth IDs, emails, tokens, question data, or answer keys.
      return {
        sessionId: session.id,
        pin: session.join_code,
        status: "lobby",
        teams: result(teams).map((t) => ({
          id: String(t.team_number),
          name: t.name,
        })),
        players: result(players).map((p) => ({
          id: p.id,
          nickname: p.nickname,
          teamId: String(p.team_number),
        })),
      };
    },
  };
}
