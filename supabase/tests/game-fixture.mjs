import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export const teacherA = "10000000-0000-0000-0000-000000000001";
export const teacherB = "10000000-0000-0000-0000-000000000002";
export const studentA = "20000000-0000-0000-0000-000000000001";
export const studentB = "20000000-0000-0000-0000-000000000002";
export const quizA = "30000000-0000-0000-0000-000000000001";
export const questionA = "40000000-0000-0000-0000-000000000001";
export const question = (prompt = "Question one", correct_index = 1) => ({
  prompt,
  choices: ["One", "Two", "Three", "Four"],
  correct_index,
  explanation: "Because two is correct.",
  points: 1000,
  time_limit_seconds: 5,
});
export async function database() {
  const db = new PGlite(),
    root = new URL("../", import.meta.url);
  const read = (p) => readFile(new URL(p, root), "utf8");
  await db.exec(await read("tests/auth-shim.sql"));
  for (const file of (await readdir(new URL("migrations/", root)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(await read("migrations/" + file));
  await db.exec(await read("seed.sql"));
  let queue = Promise.resolve();
  const as = (
    id,
    sql,
    args = [],
    role = "authenticated",
    anonymous = id?.startsWith("2000"),
  ) => {
    const next = queue.then(async () => {
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: id, is_anonymous: !!anonymous, role }),
        ]);
        if (role !== "admin") await db.exec(`set local role ${role}`);
        const result = await db.query(sql, args);
        await db.exec("commit");
        return result.rows;
      } catch (e) {
        await db.exec("rollback");
        throw e;
      }
    });
    queue = next.catch(() => {});
    return next;
  };
  const admin = (sql, args = []) => as(null, sql, args, "admin");
  const scalar = async (promise) => Object.values((await promise)[0])[0];
  const command = (user, session, action, payload = {}) =>
    scalar(
      as(
        null,
        "select public.game_command($1,$2,$3,$4)",
        [user, session, action, JSON.stringify(payload)],
        "service_role",
      ),
    );
  const data = (id) =>
    scalar(as(null, "select public.game_data($1)", [id], "service_role"));
  const host = () =>
    scalar(
      as(
        teacherA,
        "insert into public.game_sessions(quiz_id,host_id,join_code) values($1,$2,'123456') returning id",
        [quizA, teacherA],
      ),
    );
  const join = (user = studentA, name = "Student") =>
    scalar(as(user, "select public.join_game($1,$2)", ["123456", name]));
  return {
    db,
    as,
    admin,
    scalar,
    command,
    data,
    host,
    join,
    close: () => db.close(),
  };
}
