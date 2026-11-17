# Grasp database

Use Node 22.12 or newer (CI uses Node 24) and npm. Run the commands below from
the repository root, including in Windows PowerShell or a macOS/Linux terminal.
For frontend/backend configuration and release steps, see the
[deployment guide](../docs/deployment.md).

## Local verification

### Embedded database tests

These tests do not require Docker or a running Supabase instance:

```sh
npm --prefix supabase ci
npm --prefix supabase test
npm --prefix supabase run schema:check
```

The tests run migrations, constraints, triggers, grants, and RLS in embedded
PostgreSQL (PGlite). `tests/database.test.mjs` checks the initial migration;
`tests/game.test.mjs` applies the full migration chain and checks teacher roles,
quiz saves, gameplay, and scoring. They provide a minimal Supabase Auth schema
and JWT helper functions exclusively inside disposable test databases. Both
teachers and anonymous students execute queries under the real PostgreSQL
`authenticated` role. Signed-out queries use `anon`; server writes use
`service_role`. The initial-migration suite rolls back each scenario; the game
suite retains changes between its subtests and closes its database afterward.
The tests never read application env files or contact a hosted Supabase project.
The Database GitHub Actions workflow runs both test files for database changes.
`schema:check` separately verifies that the schema snapshot matches the migrations.

The embedded suite validates database authorization, not JWT signature verification,
Auth HTTP flows, PostgREST behavior, or simultaneous connections. PGlite uses one
database connection; its 40-player case verifies capacity and team balance sequentially.

### Local Supabase integration test

Start Docker, then start the local stack before running the real Auth/API and
concurrent-join test:

```sh
npx supabase start
npm --prefix supabase run test:local
```

`npx` runs the Supabase CLI and can download it if needed; a global CLI install
is not required. Keep Docker running for the test. The same npm command works
on Windows and macOS/Linux; the test handles the platform-specific CLI launch.
If the CLI reports `No such container: supabase_db_grasp`, run
`npx supabase start` from the repository root and wait for startup to succeed.

`config.toml` configures PostgreSQL 17 and the local API on port 54321, enables
anonymous sign-ins, and keeps the `private` schema outside the API's exposed
schemas. Email confirmation remains enabled. Use a local database with all
ordered migrations applied; see [Migrations and schema snapshot](#migrations-and-schema-snapshot).

This separate opt-in suite obtains local connection settings through the Supabase
CLI, never reads application env files, and accepts only `localhost` or
`127.0.0.1` on port 54321. It creates temporary users through real
signup, confirms the test teacher emails through the local admin API, logs in,
and calls PostgREST with issued tokens. It verifies teacher isolation, denied
answer writes, joined-session reads, simultaneous last-slot joins, duplicate
nicknames, idempotent concurrent retries, and joining while the host starts.
Its cleanup removes only its own users, quizzes, sessions, and dependent players.
The browser email-confirmation link itself is not exercised.

## Fixtures and teacher accounts

`seed.sql` contains two teachers, three anonymous students, and two example
quizzes. It inserts rows into `auth.users`; teacher emails use the reserved
example.test domain, and anonymous student emails are null. It creates no
passwords or `auth.identities` records, so these fixtures are not browser login
accounts. The local stack's seed configuration loads them during database
initialization. Create actual browser test accounts through Supabase Auth.
Do not load the fixtures into production.

The initial migration backfills existing teachers. The upgrade changes future
registration: only trusted `raw_app_meta_data.grasp_role=teacher` or an existing
teacher record provisions a teacher profile. Guest-to-account conversion stays
a student. Server enrollment requires a confirmed email and private invitation.
User metadata never grants authorization.

For browser testing, follow the [teacher enrollment setup](../docs/deployment.md#local-setup):
configure `TEACHER_SIGNUP_CODE` on the server, sign up, confirm the email, then
use Teacher enrollment with that invitation. The local integration test assigns
its temporary teachers through the admin API and does not exercise this UI flow.

## Migrations and schema snapshot

The initial migration is `migrations/20261029000000_initial_schema.sql`; the game
creation upgrade is `migrations/20261106000000_game_creation.sql`. Apply migrations
in order, including the upgrade. The initial migration is transactional and
intentionally fails if application tables already exist; it does not drop or
overwrite existing data. See the [deployment guide](../docs/deployment.md#local-setup)
for applying migrations to local and hosted databases.

`schema.sql` concatenates all ordered migrations for reference; never reapply the
snapshot to existing tables. Future schema changes should be new migrations.
Keep the timestamp prefixes: tests and snapshot generation sort migrations by
filename, so the initial schema must run before upgrades that depend on it.
After adding a migration, regenerate and check the snapshot:

```sh
npm --prefix supabase run schema:write
npm --prefix supabase run schema:check
```

## Database contract

| Object                           | Authenticated browser access                              | Trusted server access                                   |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| teachers                         | Read own permanent-user profile; update display_name only | Full                                                    |
| quizzes                          | Own CRUD; owner and timestamps cannot be updated          | Full                                                    |
| questions                        | Read own; writes only for own, never-hosted quizzes       | Full, subject to history protection                     |
| game_sessions                    | Host creates own quiz session; host/member reads          | State transitions and lifecycle                         |
| teams                            | Host/member reads                                         | Writes; initial teams created by trigger                |
| players                          | Host reads; join through RPC only                         | Score/membership management; filtered student snapshots |
| answers                          | Host reads; no browser writes                             | Atomic scoring; phase-filtered student feedback         |
| practice_sets / practice_answers | None directly                                             | Legacy records retained for history                        |
| study_days / cosmetics           | None directly                                             | Earned inventory and owned selections                   |

Signed-out callers have no table privileges or join RPC access. RLS additionally
requires a non-anonymous JWT and an actual permanent Auth user with a teacher
profile for teacher operations. Teacher ownership helpers live in `private`,
return only booleans about the current user, and avoid recursive RLS.

- `game_sessions.host_id` is the canonical host field. `quizzes.teacher_id`
  remains the quiz owner. A composite foreign key requires these owners to match.
- `questions.position` is zero-based and unique within a quiz. Its deferrable
  constraint supports reordering in one database transaction. Separate browser
  update requests are not an atomic reorder; the editor uses `save_quiz` to replace
  unhosted questions atomically with optimistic revision checks.
- The table permits 2–6 nonblank string choices; the editor's `save_quiz` RPC
  requires exactly 4 choices per question and 1–100 questions per quiz. Questions
  also have a valid zero-based correct index, explanation, and nonnegative points.
- The quiz's `timer_enabled` setting is copied into each session and defaults to
  false. When enabled, each question uses `time_limit_seconds`, or 30 seconds if
  that field is null. When disabled, the question has no deadline.
- Once a quiz has a session, its questions cannot be changed or removed. Duplicate
  the quiz for edits. This preserves historical answer meaning until a future
  versioned quiz/snapshot design is introduced. Hosted quiz deletion is rejected;
  application UI should explain this and offer duplication.
- Sessions expire after 24 hours by default and have 2 teams and 40 slots.
  Bounds are 2–8 teams and 1–200 players; duel mode forces 2 teams and 2 slots.
  Join codes are six digits and globally unique, including expired sessions.
  Generate them with secure randomness and retry uniqueness conflicts; future
  cleanup/code-reuse must preserve history.
- Teams use the composite identity `(session_id, team_number)`. Team totals can
  be derived from player scores; clients do not maintain a second score total.
- Answers include `session_id`, `quiz_id`, `player_id`, and `question_id`.
  Composite foreign keys prohibit mixing players, quizzes, and sessions.
  One answer per player/question is enforced in the database.

## Joining

After obtaining a valid Supabase user session, call:

```js
supabase.rpc("join_game", { p_code: "123456", p_nickname: "Alice" });
```

The public function is a security-invoker wrapper around a private, privileged
implementation. It derives identity from `auth.uid()`, validates code and nickname,
locks the session row, checks lobby status/expiration/capacity, and assigns the
least-populated team. Case-insensitive nicknames are unique within a session.
The same user joining the same open lobby returns their existing player UUID
without renaming or reassigning them, including when capacity has been reached.

Late joins are rejected. After game start, reconnect by the authenticated user's
existing player membership and server state; do not call join_game again.
A permanent teacher identity may join for preview without becoming anonymous.
The session lock serializes concurrent joins and host updates; the local integration
suite exercises those races through concurrent HTTP requests.

Expected SQLSTATE errors: `42501` for missing authorization, `22023` for invalid
input, `23505` for a duplicate nickname, and `P0001` for an unavailable/full game.
The frontend should map these to user-facing messages.

## Server boundary and deployment checks

The Express/Socket.IO server verifies user access tokens and authorizes host/player
operations. Its service-role-only `game_command` RPC validates game phase,
membership, question, choice bounds, and deadlines, and derives correctness,
points, and timing in PostgreSQL. Answers and score changes commit atomically.
The server filters `game_data` into audience-specific snapshots, releasing student
feedback according to the configured feedback mode. The secret key bypasses RLS;
constraints do not replace server authorization. Keep that key server-only and
answer keys out of student question payloads. See the
[gameplay protocol](../docs/game-contract.md) and [backend README](../server/README.md).

Before hosted rollout:

1. Test real teacher A/B and anonymous tokens through the Data API, including
   `insert(...).select()`, question counts, and join RPC calls.
2. Race multiple joins for the last slot and for the same nickname/user.
   Exactly one new membership may consume the last slot; retries must return
   the original player. Also race joining with host start/close.
3. Confirm `private` is not an exposed API schema. Inspect grants and Security
   Advisor findings; grant no additional browser write access to answers/players.
4. Configure CAPTCHA and request limits for anonymous signup/join at the service
   boundary. They are not database rate limits.
5. Decide retention before deleting anonymous Auth users: the foreign keys
   intentionally cascade to their players and answers. Archive/anonymize retained
   reports first if needed. Teacher/account deletion likewise requires an explicit
   history-retention workflow.

Function hardening follows [Supabase database function guidance](https://supabase.com/docs/guides/database/functions);
the anonymous-user distinction follows [Supabase anonymous Auth guidance](https://supabase.com/docs/guides/auth/auth-anonymous).
