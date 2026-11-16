// TEST ONLY. Embedded PostgreSQL uses the real migrations; Auth is a local fixture.
import { randomUUID } from "node:crypto";
import { gameView } from "../src/game/state.js";
import { PublicError, joinError } from "../src/errors.js";
export function fixtureRepository(f) {
  const users = new Map();
  const tokenFor = (user) =>
    `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.parse(user.created_at) / 1000) + 3600 })).toString("base64url")}.dGVzdA`;
  return {
    users,
    tokenFor,
    async addUser(id = randomUUID(), email = null, teacher = false) {
      const user = {
        id,
        email,
        is_anonymous: !email,
        email_confirmed_at: email ? new Date().toISOString() : undefined,
        app_metadata: teacher ? { grasp_role: "teacher" } : {},
        user_metadata: {},
        aud: "authenticated",
        created_at: users.get(id)?.created_at || new Date().toISOString(),
      };
      await f.admin(
        "insert into auth.users(id,email,is_anonymous,raw_app_meta_data) values($1,$2,$3,$4) on conflict(id) do update set email=excluded.email,is_anonymous=excluded.is_anonymous,raw_app_meta_data=excluded.raw_app_meta_data",
        [id, email, !email, JSON.stringify(user.app_metadata)],
      );
      users.set(id, user);
      return user;
    },
    async authenticate(token) {
      let id;
      try {
        id = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sub;
      } catch {
        throw new PublicError("UNAUTHORIZED");
      }
      const user = users.get(id);
      if (!user || token !== tokenFor(user))
        throw new PublicError("UNAUTHORIZED");
      return user;
    },
    async teacher(user) {
      if (
        user.is_anonymous ||
        !(await f.as(user.id, "select id from public.teachers")).length
      )
        throw new PublicError("FORBIDDEN");
    },
    async enroll(user) {
      await this.addUser(user.id, user.email, true);
      return { role: "teacher" };
    },
    async host(user, _token, values) {
      await this.teacher(user);
      if (values.requestId) {
        const existing = await f.as(
          user.id,
          "select id from public.game_sessions where request_id=$1",
          [values.requestId],
        );
        if (existing.length) return existing[0].id;
      }
      return f.scalar(
        f.as(
          user.id,
          "insert into public.game_sessions(quiz_id,host_id,join_code,max_players,team_count,request_id) values($1,$2,$3,$4,$5,$6) returning id",
          [
            values.quizId,
            user.id,
            String(Math.floor(Math.random() * 1000000)).padStart(6, "0"),
            values.maxPlayers || 40,
            values.teamCount || 2,
            values.requestId || null,
          ],
        ),
      );
    },
    async resumeHost(user, _token, id) {
      await this.teacher(user);
      if (
        !(
          await f.as(
            user.id,
            "select id from public.game_sessions where id=$1 and host_id=$2",
            [id, user.id],
          )
        ).length
      )
        throw new PublicError("FORBIDDEN");
      return id;
    },
    async join(user, _token, { pin, nickname }) {
      let id;
      try {
        id = await f.scalar(
          f.as(
            user.id,
            "select public.join_game($1,$2)",
            [pin, nickname],
            "authenticated",
            user.is_anonymous,
          ),
        );
      } catch (e) {
        throw joinError(e);
      }
      const [p] = await f.admin("select * from public.players where id=$1", [
        id,
      ]);
      return { playerId: p.id, sessionId: p.session_id };
    },
    async lobby(id) {
      const d = await f.data(id);
      if (!d || d.session.phase !== "lobby")
        throw new PublicError("SESSION_CLOSED");
      return {
        sessionId: id,
        pin: d.session.join_code,
        status: "lobby",
        teams: d.teams.map((t) => ({
          id: String(t.team_number),
          name: t.name,
        })),
        players: d.players.map((p) => ({
          id: p.id,
          nickname: p.nickname,
          teamId: String(p.team_number),
        })),
      };
    },
    async gameData(id) {
      await f.command(null, id, "expire");
      return f.data(id);
    },
    async state(user, id, presence) {
      return gameView(await this.gameData(id), user.id, presence);
    },
    async command(user, id, action, payload) {
      try {
        return await f.command(user.id, id, action, payload);
      } catch (e) {
        throw new PublicError(e.code === "42501" ? "FORBIDDEN" : e.message);
      }
    },
    async resumePlayer(user, id) {
      const [p] = await f.admin(
        "select id from public.players where session_id=$1 and user_id=$2",
        [id, user.id],
      );
      if (!p) throw new PublicError("FORBIDDEN");
      return { sessionId: id, playerId: p.id };
    },
    async expire() {
      const rows = await f.admin(
        "select id from public.game_sessions where status<>'finished' and (deadline<=now() or expires_at<=now())",
      );
      for (const s of rows) await f.command(null, s.id, "expire");
      return rows.map((s) => s.id);
    },
    async history(user, teacher) {
      if (teacher) {
        await this.teacher(user);
        const rows = await f.as(
          user.id,
          "select s.*,jsonb_build_object('title',q.title) quizzes,(select jsonb_build_array(jsonb_build_object('count',count(*))) from public.players p where p.session_id=s.id) players from public.game_sessions s join public.quizzes q on q.id=s.quiz_id where s.host_id=$1 order by s.created_at desc",
          [user.id],
        );
        return rows;
      }
      return f.admin(
        "select p.id,p.nickname,p.session_id,to_jsonb(s)||jsonb_build_object('quizzes',jsonb_build_object('title',q.title)) game_sessions from public.players p join public.game_sessions s on s.id=p.session_id join public.quizzes q on q.id=s.quiz_id where p.user_id=$1",
        [user.id],
      );
    },
  };
}
