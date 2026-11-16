# Sprint 4 summary

Sprint 4 ran from November 7 to November 20, 2026. The tracker's goal was "P1
enhancements: optional timers, AI question drafts, feedback modes, student
accounts". The AI features (GR-39, GR-43, GR-46) were removed on November 8 as a
team decision recorded in [implementation status](implementation-status.md), so
the sprint delivered timers, feedback modes, student accounts, and the
documentation and demo preparation for the final presentation.

Code lives on three branches that are not yet merged: `feat/game-creation`
(Howard Wei, November 9: game loop, scoring, streaks, timers, feedback modes,
reconnect, results, CSV, history and study pages), `frontend-updates` (Nathaniel
Fadrigon and Howard Wei, November 15: animal team identities and colours,
geometric visuals, streamlined gameplay screen, Young Serif type, spacing and
mobile fixes), and `ammar/sprint-1-4` (Ammar Suleyman: verification, tests, load
test and these documents). `main` still contains only the README.

## Tickets

| Ticket                                                           | Backlog owner      | Status                                                         | Implemented by                                                  | Evidence                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GR-38 timer toggle, off by default, never affects score          | Ammar Suleyman     | Done                                                           | Howard Wei; timer scoring tests by Ammar                        | `game_command` in `supabase/migrations/20261106000000_game_creation.sql`; `npm --prefix server run test:timer`; `frontend/e2e/ammar-gameplay.spec.js` (5 s timer closes itself and scores exactly like the untimed run); `supabase/tests/game.test.mjs` |
| GR-39 AI question drafts                                         | Howard Wei         | Removed (team decision, November 8)                            | Not applicable                                                  | [implementation status](implementation-status.md)                                                                                                                                                                                                       |
| GR-40 feedback timing: instant, after each question, end of game | Amrit Santhanam    | Done                                                           | Howard Wei (server and editor), Nathaniel Fadrigon (UI refresh) | `gameView` in `server/src/game/state.js`; `server/tests/game.test.js`; exploratory pass of all three modes                                                                                                                                              |
| GR-41 optional student login and study history                   | Nathaniel Fadrigon | In progress: implemented, real email confirmation not verified | Howard Wei, Nathaniel Fadrigon (UI refresh)                     | `AuthPage` link mode upgrades the guest in place; `/api/study` and `/api/history`; `server/tests/server.test.js` (study routes); local Supabase suites                                                                                                  |
| GR-42 Sprint 4 docs and final demo prep                          | Ammar Suleyman     | In progress: documents done, rehearsal pending                 | Ammar Suleyman                                                  | [ticket audit](ammar-audit.md), [diagrams](sprint-4-diagrams.md), [demo script](demo-script.md), this summary                                                                                                                                           |

Earlier tickets owned by Ammar (GR-05 to GR-08, GR-21 to GR-23, GR-34, GR-35) are
audited one by one in the [ticket audit](ammar-audit.md), with the code
location, proving tests and implementer for each. Full test results, load test
numbers and the bugs found are recorded there too.

## Added on `ammar/sprint-1-4`

- `server/tests/timerScoring.integration.mjs` (`test:timer`): the same quiz played
  untimed and timed with identical answers gives identical points, streaks and
  team totals; a late answer is refused with `ANSWER_CLOSED` and scores 0.
- `server/scripts/loadTest.mjs` (`load:test`): a local game with 40 players by
  default (up to 200), reporting join time, answer acknowledgement latency, burst
  time and a mid-game reconnect, then checking every player and team score.
- `frontend/e2e/ammar-gameplay.spec.js`: browser tests for the timer, untimed
  default, team scoreboard, streaks, reloads in the lobby, mid-question and
  mid-feedback, and lobby errors.
- Documentation: the ticket audit, Sprint 4 diagrams, demo script, this summary,
  and an update to the lobby socket contract (GR-08).

## What went well

- Keeping game rules in one Postgres function made them easy to verify. Scoring,
  streaks and timers each have database, server and browser tests.
- Every existing suite passed on the first run, and the real local Supabase
  suites passed once Docker was running.
- The new load test shows exact scores at 40, 100 and 200 players on one machine.

## What did not go well

- Work stayed on long-lived branches. `main` has only the README and `dev` stops
  at November 5, so nothing has been deployed or reviewed through pull requests.
- The sprint tracker's assignees drifted from the product backlog after tickets
  were swapped.
- Some issues surfaced only in the exploratory pass at the end, such as the host
  page staying on "Reconnecting…" after a rate-limited reconnect.

## Remaining release items

Proposed owners are based on each person's area and still need team confirmation.

- Merge `feat/game-creation` and `frontend-updates` into `dev`, then `main`, then
  this branch (Howard Wei, Nathaniel Fadrigon, Ammar Suleyman).
- Deploy the frontend to Vercel and the server to Render with a production
  Supabase project (Howard Wei, GR-27).
- Verify real email confirmation, password reset, account linking and CAPTCHA
  against hosted Supabase (Howard Wei, Nathaniel Fadrigon).
- Physical phone and screen-reader pass (Amrit Santhanam, GR-36).
- Decide on the issues in the ticket audit, starting with reconnect after a
  refused connection and the host scoreboard in end-of-game mode (whole team).
- Rehearse the [demo script](demo-script.md) end to end (whole team).
