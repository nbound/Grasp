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

| Ticket | Acceptance criteria                                                                                | Implementation                                                                                                                                                                                                                                                                                                                                                                                                      | Proving tests                                                                                                                                                                                                                                                                                                                    | Status                                 | Implemented by                                              |
| ------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| GR-05  | Node + Express + Socket.IO server, env config, `/health`                                           | `server/src/index.js`, `server/src/config.js`, `server/src/app.js:18`                                                                                                                                                                                                                                                                                                                                               | `server/tests/server.test.js:160` (health is public)                                                                                                                                                                                                                                                                             | Done                                   | Howard Wei                                                  |
| GR-06  | Session with unique 6-digit PIN, store, automatic teams                                            | `server/src/repository.js:65-92` (`crypto.randomInt`, zero padded, up to 10 inserts retried on `23505`, then `SERVER_BUSY`); `join_code ... unique check (^[0-9]{6}$)` in `20261029000000_initial_schema.sql:65`; `private.join_game` assigns the team with the fewest players (`:341-344`); `SessionManager` keeps presence in memory (`server/src/sessionManager.js:46-73`)                                       | `server/tests/repository.test.js:87` (collision retried); `supabase/tests/database.test.mjs:206`, `:356` (balanced teams, 20/20 at 40 players, 41st rejected); `server/tests/game.integration.mjs:93`                                                                                                                            | Done                                   | Howard Wei                                                  |
| GR-07  | `host_create`, `player_join`, `player_left`, `lobby_update`; bad PIN and duplicate nickname errors | `server/src/app.js:156-198, 236-243, 60-106`; `validateJoin` returns `BAD_PIN` (`sessionManager.js:31-44`); `joinError` maps `23505` to `DUPLICATE_NICKNAME` (`server/src/errors.js:8-15`); `repository.join` returns `BAD_PIN` for an unknown PIN (`repository.js:115`)                                                                                                                                            | `server/tests/server.test.js:126, 226, 278`; `supabase/tests/database.test.mjs:231` (case-insensitive duplicates); `frontend/tests/student.test.js:113`; browser: `frontend/e2e/ammar-gameplay.spec.js:432` (wrong PIN alert; `Ada`, `ada`, `ADA` and `  aDa  ` refused)                                                         | Done                                   | Howard Wei                                                  |
| GR-08  | Socket contract documented in the repo                                                             | `docs/student-socket-contract.md` (lobby), `docs/game-contract.md` (gameplay)                                                                                                                                                                                                                                                                                                                                       | Review; stale lines fixed on this branch (`fcc1710`)                                                                                                                                                                                                                                                                             | Done                                   | Nathaniel Fadrigon, Howard Wei; doc fix by Ammar            |
| GR-21  | Start, send question, validate answers, score without speed bonus, reveal                          | `public.game_command` in `20261106000000_game_creation.sql:99-165`: points are `case when v_correct then q.points else 0` (`:132`); `response_ms` is stored but never used in scoring; answers require `phase='question'` and an open deadline (`:124`); one answer per player and question (`unique (player_id, question_id)`, `attempts=1`, retry with a different choice returns `ALREADY_ANSWERED`, `:119-123`) | `supabase/tests/game.test.mjs:141, 197`; `server/tests/game.integration.mjs`                                                                                                                                                                                                                                                     | Done                                   | Howard Wei                                                  |
| GR-22  | Team scoring and team scoreboard between questions                                                 | `gameView` in `server/src/game/state.js:38-48`: team score is the sum of member `score`; `showScores = host \|\| revealed` (`:18`), so students only see it in feedback (or at results for end-of-game feedback)                                                                                                                                                                                                    | `server/tests/game.test.js:46` (hidden before release); new `server/tests/timerScoring.integration.mjs` asserts host `teamScores` equal the sum of member points; browser: `ammar-gameplay.spec.js:500` (Team Scoreboard totals after every question, hidden while a question is open)                                           | Done                                   | Howard Wei                                                  |
| GR-23  | Server streak, visual only                                                                         | `game_command`: correct answer `streak+1`, wrong answer `0` (`:136`); reveal and expire reset the streak for players who missed the question (`:111, :148`); `score` only changes by fixed points (`:135`)                                                                                                                                                                                                          | `supabase/tests/game.test.mjs:197, 260`; new timer test asserts score equals the sum of `points_awarded` with streaks of 3, 2, 1 and 0; browser: `ammar-gameplay.spec.js:500` (streak 1, 2, then 0, points unaffected)                                                                                                           | Done                                   | Howard Wei                                                  |
| GR-34  | A refreshed student rejoins as the same player and team                                            | `GamePage.jsx:84-104` calls `game_sync` with the `/play/:sessionId` URL on every connect; `app.js:199-211` loads state and `resumePlayer` (`game/repository.js:81-92`) looks the player up by verified Auth user ID, then rejoins the room                                                                                                                                                                          | `server/tests/game.integration.mjs:137-144` (server restart restores player ID and team); `server/tests/server.test.js:278`; `frontend/e2e/game.spec.js:196-200` (browser reload mid-question); `ammar-gameplay.spec.js:432, 588` (reload in the lobby, mid-question and mid-feedback keeps nickname, team, answer and feedback) | Done                                   | Howard Wei (server), Nathaniel Fadrigon and Howard Wei (UI) |
| GR-35  | Load test with 40 simulated players                                                                | `server/tests/game.integration.mjs`: 40 real Socket.IO clients join concurrently, answer in one burst, duplicate tab, server restart, final results; `server/scripts/loadTest.mjs` (`npm --prefix server run load:test`)                                                                                                                                                                                            | `npm run test:game` (1/1, burst 494 ms); `load:test` at 40, 100 and 200 players with every score exact (see Load test)                                                                                                                                                                                                           | Done                                   | Howard Wei (test); Ammar (script)                           |
| GR-38  | Per-quiz timer toggle, off by default, never affects score                                         | `quizzes.timer_enabled` and `game_sessions.timer_enabled` default `false` (`game_creation.sql:22, 64`); copied at host time (`:83`); `deadline` only set when enabled (`:160`, 5 to 600 s, default 30); late answers raise `ANSWER_CLOSED` (`:124`); the 1 s `expire` interval (`app.js:327-334`) and `gameData` (`game/repository.js:53-64`) close overdue questions                                               | `supabase/tests/game.test.mjs:260`; new `npm --prefix server run test:timer` (3/3 runs pass, about 1 s each); browser: `ammar-gameplay.spec.js:500` (5 s timer closes the question without the host; scores identical to the untimed run)                                                                                        | Done                                   | Howard Wei; scoring test by Ammar                           |
| GR-42  | Sprint 4 docs and final demo prep                                                                  | This audit, `docs/sprint-4-diagrams.md`, `docs/demo-script.md`, `docs/sprint-4-summary.md`                                                                                                                                                                                                                                                                                                                          | Not applicable                                                                                                                                                                                                                                                                                                                   | Documents done; demo rehearsal pending | Ammar                                                       |

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

## Load test (GR-35)

`npm --prefix server run load:test -- --players N` plays a full 3-question game on
127.0.0.1. A child process runs the real app on embedded PGlite with the real
migrations and fixture auth; the script drives socket.io-client players, answers
in bursts (about two thirds correct, a few skipped), reconnects about 10% of
players after question 1, and checks every player score and team total against
the database and the host scoreboard. Laptop numbers, not hosted Postgres.

| Players      | Join max      | Answer burst (slowest of 3) | Reconnect                | Scores           | Shutdown     | Total |
| ------------ | ------------- | --------------------------- | ------------------------ | ---------------- | ------------ | ----- |
| 40 (3 runs)  | 236 to 246 ms | 408 to 435 ms               | 4/4 same player and team | 40/40, 2/2 teams | 0.2 s        | 2.4 s |
| 100          | 698 ms        | 2.1 s                       | 10/10                    | 100/100, 2/2     | clean        | 8.5 s |
| 200 (2 runs) | 2.2 s         | 9.0 to 9.1 s                | 20/20                    | 200/200, 2/2     | 5.3 to 5.4 s | 33 s  |

All runs exit 0. Invalid flags exit 2. The first version ran server and clients
in one process; at 200 players a few client websockets then received corrupted
frames and dropped (the server had already committed their answers). That
reproduced on Node 22.12 and 24 and with plain `node:net` in one process, and
disappeared with the server in its own process, so it is a harness artefact, not
a Grasp bug.

## Browser tests (new)

`frontend/e2e/ammar-gameplay.spec.js` uses teacher B and teachers it enrolls
itself, so it never touches teacher A's sessions that `game.spec.js` asserts on.
Every page fails the test on any page or console error; none are allowlisted.

| Test                                    | Proves                                                                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:407` wrong PIN (marked `test.fail()`) | Expects "No game found with that PIN." The fixture repository calls `join_game` without looking up the PIN, so the fixture shows "This game has expired." Production looks the PIN up first (`server/src/repository.js:107-115`). Remove the marker if `server/tests/fixtureRepository.mjs` is aligned. |
| `:432` lobby                            | Wrong PIN alert; four case and spacing variants of a taken nickname refused; a lobby reload keeps nickname and team                                                                                                                                                                                     |
| `:500` timer, scoreboard, streak        | A 5 s timed quiz closes each question without the host; a student who did not answer sees no answer, +0 points and streak 0; the untimed default shows no countdown and stays open for 7 s until reveal; Team Scoreboard, per-student points and the results table are identical across both runs       |
| `:588` reconnect                        | Reload mid-question keeps the saved answer or allows answering; reload mid-feedback shows the same feedback, points, streak, team and scoreboard                                                                                                                                                        |

`npm run test:browser`: 6 passed in 55.3 s, 56.3 s (subagent runs) and 56.6 s
(mine), with the expected failure counted as passing. The single spec passed 4
times in a row. Earlier runs on this machine sometimes stopped with truncated
JSON inside Playwright's Chromium pipe, not in the app.

## Bugs and UX issues found (logged for the team, not fixed here)

1. Medium, frontend: after a refused socket connection the game page never
   retries. Reproduce: a host clicks through an untimed quiz fast enough to pass
   30 operations in a minute (about 7 questions; each click is a command plus a
   `game_sync`, plus a resync every 15 s), sees "Too many requests", then reloads.
   The handshake is refused (`server/src/app.js:48-59`, reported as
   `UNAUTHORIZED` by design, see `server/tests/server.test.js:318`) and
   `GamePage.jsx:100-102` shows "Reconnecting…" forever, even after the limit
   resets. Suggested fix in the UI: retry `socket.connect()` with a delay after
   `connect_error`, or show a retry button. The team may also want a higher host
   budget.
2. Low, server view: in end-of-game mode the host's state includes team scores
   after every lock (`server/src/game/state.js:18`) but no answer key
   (`:13-16`). A projected host screen shows totals before results, and the
   "Lock Answers & Reveal" button reveals nothing to the host. Needs a team
   decision on what the host view should show.
3. Low, frontend: the results page keeps the last answer's red or green tint and
   the streak line (`GamePage.jsx:173, 297-299`); the scoreboard heading renders
   above the results heading (`:393-398`).
4. Low, copy: "1 seconds remaining" (`GamePage.jsx:25`); "1 answers" (`:330`);
   timed games still say feedback appears "when your teacher reveals the answer"
   (`:362-369`); the Session History status column says "Results", like the
   button next to it (`History.jsx:69`).
5. Low, frontend: Study Space hides game history when `/api/study` fails, though
   history comes from a separate endpoint (`StudyPage.jsx:72-126`).
6. Low: the CSV team column is a number rather than the team name
   (`state.js:120`), and class and personal CSVs share the file name
   `grasp-<id>.csv` (`frontend/src/lib/api.js:53`).
7. Low, phone layout: a student never sees their own total in team mode, the
   results Points column and the Study history Status and Review columns are off
   screen at 390 px, and the correct choice is not highlighted on the answer
   buttons during feedback.

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
4. Broadcast cost grows with the square of the class size. Every answer triggers
   `broadcast()` twice (`app.js:232` and `:143`; the second call usually adds
   one more pass), and each pass sends every member a full `gameView` that
   includes the whole roster (`state.js:66-71`). At 200 players one pass is about
   4 MB. `ranked()` (`state.js:32-37`) is also O(N²) per view. Fine at 40;
   worth profiling before large classes.

## Stale documentation not changed on this branch

- `docs/student-socket-contract.md` still says `host_create` across reconnects
  is not idempotent; the optional `requestId` now deduplicates it
  (`server/src/repository.js:46-56`, `docs/game-contract.md`).
- `docs/implementation-status.md` says "Changes are local and uncommitted" and
  points to `output/pdf/grasp-implementation-report.pdf`, which is not in the
  repository. It also says AI features were removed "at the user's request".
- `docs/hosted-smoke-test.md:3` and `:75` say there is no teacher dashboard or
  Host screen and that automatic resume is not implemented.
- `docs/sprint-report.md:107-109` says teachers see their own answer keys;
  in end-of-game mode the host view shows no key until results (bug 2).
- AI features (GR-39, GR-43, GR-46) were removed on November 8, 2026 as a team
  decision recorded in `docs/implementation-status.md`.
