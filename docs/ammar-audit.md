# Ammar's ticket audit (Sprints 1 to 4)

Branch `ammar/sprint-1-4`, based on `origin/frontend-updates` at `ec3d308`
(Nov 16 UTC). Audited on 2026-11-15 by Ammar Suleyman. Implementation credit
comes from `git log --format='%an' -- <file>`: every server, SQL and server test
file listed below was written by Howard Wei (HowardWei123) on
`feat/backend-setup` (PR #6, Nov 5) and `feat/game-creation` (Nov 9). Nathaniel
Fadrigon and Howard Wei wrote the UI. My work on this branch is verification,
new tests, the load test script and documentation.

## Baseline (before any change on this branch)

| Command                | Result                                                                      | Time   |
| ---------------------- | --------------------------------------------------------------------------- | ------ |
| `npm run setup`        | `npm ci` in frontend, server, supabase; 0 vulnerabilities                   | 2.7 s  |
| `npm run check`        | 19 frontend, lint, build, 17 server, 38 database, schema snapshot: all pass | 5.4 s  |
| `npm run test:game`    | 1/1 pass; 40-answer burst acknowledged in 494 ms                            | 2.0 s  |
| `npm run test:browser` | 2/2 Playwright specs pass                                                   | 17.3 s |

No pre-existing failures. The build prints Vite's chunk-size warning only.

## Tickets

| Ticket | Acceptance criteria                                                                                | Implementation                                                                                                                                                                                                                                                                                                                                                                                                      | Proving tests                                                                                                                                                                                         | Status                                                            | Implemented by                                              |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------- |
| GR-05  | Node + Express + Socket.IO server, env config, `/health`                                           | `server/src/index.js`, `server/src/config.js`, `server/src/app.js:18`                                                                                                                                                                                                                                                                                                                                               | `server/tests/server.test.js:160` (health is public)                                                                                                                                                  | Done                                                              | Howard Wei                                                  |
| GR-06  | Session with unique 6-digit PIN, store, automatic teams                                            | `server/src/repository.js:65-92` (`crypto.randomInt`, zero padded, up to 10 inserts retried on `23505`, then `SERVER_BUSY`); `join_code ... unique check (^[0-9]{6}$)` in `20261029000000_initial_schema.sql:65`; `private.join_game` assigns the team with the fewest players (`:341-344`); `SessionManager` keeps presence in memory (`server/src/sessionManager.js:46-73`)                                       | `server/tests/repository.test.js:87` (collision retried); `supabase/tests/database.test.mjs:206`, `:356` (balanced teams, 20/20 at 40 players, 41st rejected); `server/tests/game.integration.mjs:93` | Done                                                              | Howard Wei                                                  |
| GR-07  | `host_create`, `player_join`, `player_left`, `lobby_update`; bad PIN and duplicate nickname errors | `server/src/app.js:156-198, 236-243, 60-106`; `validateJoin` returns `BAD_PIN` (`sessionManager.js:31-44`); `joinError` maps `23505` to `DUPLICATE_NICKNAME` (`server/src/errors.js:8-15`); `repository.join` returns `BAD_PIN` for an unknown PIN (`repository.js:115`)                                                                                                                                            | `server/tests/server.test.js:126, 226, 278`; `supabase/tests/database.test.mjs:231` (case-insensitive duplicates); `frontend/tests/student.test.js:113`                                               | Done                                                              | Howard Wei                                                  |
| GR-08  | Socket contract documented in the repo                                                             | `docs/student-socket-contract.md` (lobby), `docs/game-contract.md` (gameplay)                                                                                                                                                                                                                                                                                                                                       | Review; stale lines fixed on this branch (`fcc1710`)                                                                                                                                                  | Done                                                              | Nathaniel Fadrigon, Howard Wei; doc fix by Ammar            |
| GR-21  | Start, send question, validate answers, score without speed bonus, reveal                          | `public.game_command` in `20261106000000_game_creation.sql:99-165`: points are `case when v_correct then q.points else 0` (`:132`); `response_ms` is stored but never used in scoring; answers require `phase='question'` and an open deadline (`:124`); one answer per player and question (`unique (player_id, question_id)`, `attempts=1`, retry with a different choice returns `ALREADY_ANSWERED`, `:119-123`) | `supabase/tests/game.test.mjs:141, 197`; `server/tests/game.integration.mjs`                                                                                                                          | Done                                                              | Howard Wei                                                  |
| GR-22  | Team scoring and team scoreboard between questions                                                 | `gameView` in `server/src/game/state.js:38-48`: team score is the sum of member `score`; `showScores = host \|\| revealed` (`:18`), so students only see it in feedback (or at results for end-of-game feedback)                                                                                                                                                                                                    | `server/tests/game.test.js:46` (hidden before release); new `server/tests/timerScoring.integration.mjs` asserts host `teamScores` equal the sum of member points                                      | Done                                                              | Howard Wei                                                  |
| GR-23  | Server streak, visual only                                                                         | `game_command`: correct answer `streak+1`, wrong answer `0` (`:136`); reveal and expire reset the streak for players who missed the question (`:111, :148`); `score` only changes by fixed points (`:135`)                                                                                                                                                                                                          | `supabase/tests/game.test.mjs:197, 260`; new timer test asserts score equals the sum of `points_awarded` with streaks of 3, 2, 1 and 0                                                                | Done                                                              | Howard Wei                                                  |
| GR-34  | A refreshed student rejoins as the same player and team                                            | `GamePage.jsx:84-104` calls `game_sync` with the `/play/:sessionId` URL on every connect; `app.js:199-211` loads state and `resumePlayer` (`game/repository.js:81-92`) looks the player up by verified Auth user ID, then rejoins the room                                                                                                                                                                          | `server/tests/game.integration.mjs:137-144` (server restart restores player ID and team); `server/tests/server.test.js:278`; `frontend/e2e/game.spec.js:196-200` (browser reload mid-question)        | Done                                                              | Howard Wei (server), Nathaniel Fadrigon and Howard Wei (UI) |
| GR-35  | Load test with 40 simulated players                                                                | `server/tests/game.integration.mjs`: 40 real Socket.IO clients join concurrently, answer in one burst, duplicate tab, server restart, final results                                                                                                                                                                                                                                                                 | `npm run test:game` (1/1, burst 494 ms)                                                                                                                                                               | Done; standalone script with latency numbers added on this branch | Howard Wei (test); Ammar (script)                           |
| GR-38  | Per-quiz timer toggle, off by default, never affects score                                         | `quizzes.timer_enabled` and `game_sessions.timer_enabled` default `false` (`game_creation.sql:22, 64`); copied at host time (`:83`); `deadline` only set when enabled (`:160`, 5 to 600 s, default 30); late answers raise `ANSWER_CLOSED` (`:124`); the 1 s `expire` interval (`app.js:327-334`) and `gameData` (`game/repository.js:53-64`) close overdue questions                                               | `supabase/tests/game.test.mjs:260`; new `npm --prefix server run test:timer` (3/3 runs pass, about 1 s each)                                                                                          | Done                                                              | Howard Wei; scoring test by Ammar                           |
| GR-42  | Sprint 4 docs and final demo prep                                                                  | This audit, `docs/sprint-4-diagrams.md`, `docs/demo-script.md`, `docs/sprint-4-summary.md`                                                                                                                                                                                                                                                                                                                          | Not applicable                                                                                                                                                                                        | In progress                                                       | Ammar                                                       |

## Specific checks

- GR-06: `randomInt(0, 1000000)` is cryptographically random. Uniqueness is the
  database constraint, not an in-memory check. The ticket's "in-memory store"
  became Postgres for sessions and membership; only connection presence is in
  memory (documented in `server/README.md`).
- GR-07: `lobby_update` is broadcast after every successful operation and on
  disconnect (`app.js:143, 247`); it carries only allowlisted fields
  (`repository.js:163-177`).
- GR-21: no time factor appears anywhere in `game_command` scoring.
- GR-22: team totals are computed from current member scores on every
  snapshot; there is no separate stored team total that could drift.
- GR-38: the new timer test plays the same three questions untimed and timed
  with identical answers. In the timed run every answer to Q2 arrives about
  45 s after the question opened, and Q3 closes on its deadline with one late
  answer rejected (`ANSWER_CLOSED`) and recorded as 0 points and 0 attempts.
  Per-question points, totals, streaks and team totals are identical.

## Observations (not proven bugs, no server change proposed)

1. Each socket handles one operation at a time and rejects a second one with
   `SERVER_BUSY` (`app.js:133`). `GamePage.jsx:105-107` resyncs every 15 s on the
   same socket, so an answer click that lands during a resync fails once with a
   generic message and must be clicked again. Low severity; not reproduced.
2. `join_code` is unique across all sessions forever, including finished ones
   (`initial_schema.sql:65`). The 10-retry PIN loop starts failing only after a
   large share of the 1,000,000 codes is used, so this is not a class-scale
   issue.
3. Rate limits are 30 operations per user per minute and 1,200 handshakes per
   IP per minute (`app.js:36-50`). Behind a proxy or a school NAT all students
   may share one IP; confirm `socket.handshake.address` on Render (GR-27).

## Stale documentation not changed on this branch

- `docs/student-socket-contract.md` still says `host_create` across reconnects
  is not idempotent; the optional `requestId` now deduplicates it
  (`server/src/repository.js:46-56`, `docs/game-contract.md`).
- `docs/implementation-status.md` says "Changes are local and uncommitted" and
  points to `output/pdf/grasp-implementation-report.pdf`, which is not in the
  repository.
- AI features (GR-39, GR-43, GR-46) were removed on November 8, 2026 as a team
  decision recorded in `docs/implementation-status.md`.
