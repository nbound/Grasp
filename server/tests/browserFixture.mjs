// Local-only test Auth/Data API facade. Never imported by production entry points.
// Product UI, Supabase browser SDK, sockets and PostgreSQL migrations run normally.
import express from "express";
import {
  database,
  teacherA,
  teacherB,
} from "../../supabase/tests/game-fixture.mjs";
import { fixtureRepository } from "./fixtureRepository.mjs";
import { createApp } from "../src/app.js";

const f = await database(),
  repo = fixtureRepository(f);
await repo.addUser(teacherA, "teacher@example.test", true);
await repo.addUser(teacherB, "other@example.test", true);
const session = (user) => ({
  access_token: repo.tokenFor(user),
  refresh_token: `refresh-${user.id}`,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
});
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4173");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/auth/v1/token", async (req, res) => {
  const user =
    req.query.grant_type === "refresh_token"
      ? repo.users.get(req.body.refresh_token?.replace("refresh-", ""))
      : [...repo.users.values()].find((u) => u.email === req.body.email);
  if (
    !user ||
    (req.query.grant_type !== "refresh_token" &&
      req.body.password !== "fixture-password")
  )
    return res.status(400).json({ msg: "Invalid login credentials" });
  res.json(session(user));
});
app.post("/auth/v1/signup", async (req, res) => {
  const user = await repo.addUser(undefined, req.body.email || null, false);
  res.json(session(user));
});
app.post("/auth/v1/logout", (_req, res) => res.json({}));
app.get("/auth/v1/user", async (req, res) => {
  try {
    res.json(await repo.authenticate(req.headers.authorization?.slice(7)));
  } catch {
    res.sendStatus(401);
  }
});
app.put("/auth/v1/user", async (req, res) => {
  try {
    const old = await repo.authenticate(req.headers.authorization?.slice(7));
    const user = await repo.addUser(old.id, req.body.email || old.email, false);
    res.json(user);
  } catch {
    res.sendStatus(401);
  }
});
app.use("/rest/v1", async (req, res) => {
  try {
    const user = await repo.authenticate(req.headers.authorization?.slice(7));
    const as = (sql, args = []) =>
      f.as(user.id, sql, args, "authenticated", user.is_anonymous);
    const id = req.query.id?.replace("eq.", "");
    let rows;
    if (req.path === "/teachers")
      rows = await as("select id from public.teachers");
    else if (req.path === "/rpc/save_quiz")
      return res.json(
        await f.scalar(
          as("select public.save_quiz($1,$2,$3,$4)", [
            req.body.p_id,
            req.body.p_revision,
            JSON.stringify(req.body.p_quiz),
            JSON.stringify(req.body.p_questions),
          ]),
        ),
      );
    else if (req.path === "/quizzes" && req.method === "GET") {
      rows = await as(
        "select q.*,jsonb_build_array(jsonb_build_object('count',(select count(*) from public.questions x where x.quiz_id=q.id))) questions,jsonb_build_array(jsonb_build_object('count',(select count(*) from public.game_sessions s where s.quiz_id=q.id))) game_sessions from public.quizzes q where ($1::uuid is null or q.id=$1) and not archived order by created_at desc",
        [id || null],
      );
    } else if (req.path === "/questions")
      rows = await as(
        "select * from public.questions where quiz_id=$1 order by position",
        [req.query.quiz_id?.replace("eq.", "")],
      );
    else if (req.path === "/quizzes" && req.method === "DELETE")
      rows = await as("delete from public.quizzes where id=$1 returning id", [
        id,
      ]);
    else if (req.path === "/quizzes" && req.method === "PATCH")
      rows = await as(
        "update public.quizzes set archived=$2 where id=$1 returning id",
        [id, req.body.archived],
      );
    else return res.status(404).json({ message: "Unsupported test query" });
    if (req.headers.accept?.includes("application/vnd.pgrst.object+json"))
      return rows.length
        ? res.json(rows[0])
        : res
            .status(406)
            .json({
              code: "PGRST116",
              details: "The result contains 0 rows",
              message: "No rows",
            });
    res.json(rows);
  } catch (error) {
    res.status(400).json({ message: error.message, code: error.code });
  }
});
const authServer = app.listen(54329, "127.0.0.1");
const game = createApp({
  config: {
    origins: ["http://127.0.0.1:4173"],
    teacherSignupCode: "fixture-invitation",
  },
  repository: repo,
});
game.httpServer.listen(3009, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await game.close();
    authServer.close();
    await f.close();
    process.exit(0);
  });
console.log(
  "Disposable browser fixture ready. No hosted credentials are used.",
);
