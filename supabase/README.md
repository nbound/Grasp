# Grasp database

The initial migration is `migrations/20261029000000_initial_schema.sql`; the game
creation upgrade is `migrations/20261106000000_game_creation.sql`.
`schema.sql` concatenates all ordered migrations for reference. Apply migrations
in order; never reapply the snapshot to existing tables. `npm run schema:check`
checks the snapshot. Future schema changes should be new migrations.
Keep the timestamp prefixes: tests and snapshot generation sort migrations by
filename, so the initial schema must run before upgrades that depend on it.
The initial migration is transactional and intentionally fails if application
tables already exist; it does not drop or overwrite existing data.

## Local verification

From the repository root:

```sh
npm --prefix supabase ci
npm --prefix supabase test
```

The tests run the actual migration, constraints, triggers, grants, and RLS in
embedded PostgreSQL (PGlite). They provide a minimal Supabase Auth schema and
JWT helper functions exclusively inside the disposable test database. Both
teachers and anonymous students execute queries under the real PostgreSQL
`authenticated` role. Signed-out queries use `anon`; server writes use
`service_role`. SQL errors are checked by SQLSTATE, and each scenario rolls back.
The tests never read application env files or contact a hosted Supabase project.
The Database GitHub Actions workflow runs this same suite for database changes.

The embedded suite validates database authorization, not JWT signature verification,
Auth HTTP flows, PostgREST behavior, or simultaneous connections. PGlite uses one
database connection; its 40-player case verifies capacity and team balance sequentially.

With local Supabase running, verify the real Auth/API and concurrent joins using:

```sh
npm --prefix supabase run test:local
```

This separate opt-in suite obtains local connection settings through the Supabase
CLI and refuses non-local API addresses. It creates temporary users through real
signup, confirms the test teacher emails through the local admin API, logs in,
and calls PostgREST with issued tokens. It verifies teacher isolation, denied
answer writes, joined-session reads, simultaneous last-slot joins, duplicate
nicknames, idempotent concurrent retries, and joining while the host starts.
Its cleanup removes only its own users, quizzes, sessions, and dependent players.
The browser email-confirmation link itself is not exercised.

## Local Supabase

With Docker running and the Supabase CLI installed, run `supabase start` from
the repository root. `config.toml` configures PostgreSQL 17, enables anonymous
sign-ins, and keeps the `private` schema outside the API's exposed schemas.
Email confirmation remains enabled.

`seed.sql` contains two teachers, three anonymous students, and two example
quizzes. These are database-only fixtures with reserved example.test emails,
no passwords, and no Auth identities. They are not browser login accounts.
Create actual test accounts through Supabase Auth when implementing authentication.
Do not load these fixtures into production.

The initial migration backfills existing teachers. The upgrade changes future
registration: only trusted `raw_app_meta_data.grasp_role=teacher` or an existing
teacher record provisions a teacher profile. Guest-to-account conversion stays
a student. Server enrollment requires a confirmed email and private invitation.
User metadata never grants authorization.

## Database contract

| Object                           | Authenticated browser access                              | Trusted server access                                   |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| teachers                         | Read own permanent-user profile; update display_name only | Full                                                    |
| quizzes                          | Own CRUD; owner and timestamps cannot be updated          | Full                                                    |
| questions                        | CRUD only for own, never-hosted quizzes                   | Full, subject to history protection                     |
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
- Questions have 2–6 nonblank string choices, a valid zero-based correct index,
  explanation, nonnegative points, and an optional timer. Null means no timer.
- Once a quiz has a session, its questions cannot be changed or removed. Duplicate
  the quiz for edits. This preserves historical answer meaning until a future
  versioned quiz/snapshot design is introduced. Hosted quiz deletion is rejected;
  application UI should explain this and offer duplication.
- Sessions expire after 24 hours by default and have 2 teams and 40 slots.
  Bounds are 2–8 teams and 1–200 players. Join codes are six digits and globally
  unique, including expired sessions. Generate them with secure randomness and
  retry uniqueness conflicts; future cleanup/code-reuse must preserve history.
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

Future Express code must verify user access tokens, authorize every host/player
operation, and validate current game phase, player membership, question membership,
choice bounds, and deadlines. It must derive correctness, points, and timing on the
server and save the answer plus score changes atomically. The secret key bypasses
RLS; constraints do not replace these server checks. Never expose that key or
send answer keys in student question payloads.

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
