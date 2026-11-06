import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSmokeTarget,
  cleanupSmokeFixtures,
  parseSmokeOptions,
} from "../scripts/hostedSmokeSupport.js";

const ref = "abcdefghijklmnopqrst";
test("hosted smoke requires an explicit matching project before making requests", () => {
  assert.deepEqual(parseSmokeOptions(["--project-ref", ref, "--hold"]), {
    projectRef: ref,
    hold: true,
  });
  for (const args of [
    [],
    ["--hold"],
    ["--project-ref"],
    ["--project-ref", "sb_secret_test"],
    ["--project-ref", ref, "--unknown"],
  ])
    assert.throws(() => parseSmokeOptions(args));
  assert.doesNotThrow(() =>
    assertSmokeTarget({ supabaseUrl: `https://${ref}.supabase.co` }, ref),
  );
  for (const url of [
    "http://localhost:54321",
    `http://${ref}.supabase.co`,
    "https://differentprojecttest.supabase.co",
    `https://${ref}.supabase.co.evil.test`,
  ]) {
    assert.throws(() => assertSmokeTarget({ supabaseUrl: url }, ref));
  }
});

test("cleanup uses only this run's quiz, owner, and user IDs, in dependency order", async () => {
  const calls = [];
  const admin = {
    from(table) {
      const filters = [];
      const query = {
        delete() {
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        then(resolve) {
          calls.push({ table, filters });
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return query;
    },
    auth: {
      admin: {
        async deleteUser(id) {
          calls.push({ user: id });
          return { error: null };
        },
      },
    },
  };
  assert.equal(
    await cleanupSmokeFixtures(admin, { quizzes: [], users: [] }),
    0,
  );
  assert.deepEqual(calls, []);
  assert.equal(
    await cleanupSmokeFixtures(admin, {
      quizzes: [{ id: "owned-quiz", teacherId: "owned-host" }],
      users: ["owned-host", "owned-guest"],
    }),
    0,
  );
  assert.deepEqual(calls, [
    {
      table: "game_sessions",
      filters: [
        ["quiz_id", "owned-quiz"],
        ["host_id", "owned-host"],
      ],
    },
    {
      table: "quizzes",
      filters: [
        ["id", "owned-quiz"],
        ["teacher_id", "owned-host"],
      ],
    },
    { user: "owned-host" },
    { user: "owned-guest" },
  ]);
});

test("cleanup reports returned and thrown failures instead of claiming success", async () => {
  let calls = 0;
  const admin = {
    auth: {
      admin: {
        async deleteUser() {
          calls++;
          if (calls === 1) throw new Error("private SDK detail");
          return { error: { message: "private SDK detail" } };
        },
      },
    },
  };
  assert.equal(
    await cleanupSmokeFixtures(admin, { quizzes: [], users: ["one", "two"] }),
    2,
  );
  assert.equal(calls, 2);
});
