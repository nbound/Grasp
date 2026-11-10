# Gameplay protocol v1

All sockets authenticate with `auth: { accessToken }`. The server verifies the token
using Supabase Auth for the handshake, every operation, and idle revalidation.
Never send a user ID, player ID, score, correctness, team assignment or response time
as authority. Existing lobby events are documented in `student-socket-contract.md`.

Every request below requires an acknowledgement. Success is `{ ok: true, data }`;
failure is `{ ok: false, error: { code } }`. Do not buffer operations while offline.
On reconnect or uncertain delivery, request `game_sync` before retrying.

| Event         | Request                                                               | Success data                                                      |
| ------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `host_create` | `quizId`, optional `maxPlayers`, `teamCount`, stable UUID `requestId` | `sessionId`, `lobby` (or recovered `state`)                       |
| `game_sync`   | `sessionId`                                                           | `state`; also subscribes the verified host/player to that session |
| `game_start`  | `sessionId`, current `revision`                                       | `{}`                                                              |
| `game_reveal` | `sessionId`, current `revision`                                       | `{}`                                                              |
| `game_next`   | `sessionId`, current `revision`                                       | `{}`                                                              |
| `game_end`    | `sessionId`, current `revision`                                       | `{}`                                                              |
| `game_answer` | `sessionId`, `questionId`, zero-based `choice`, UUID `requestId`      | `accepted: true`, `duplicate: boolean`                            |

`game_update` pushes the complete audience-filtered state. It includes protocol
`version: 1`, session ID, revision, phase, roster/presence, own player/team IDs,
current public question, own submission status, deadline/server clock, and only
the currently releasable feedback, scoreboard and result rows. Clients discard
older revisions. Equal revisions may carry updated connection presence.

Phases: `lobby -> question -> feedback -> question ... -> results`. The feedback
transition locks answers atomically. A timer closes the question at the database
deadline even if the interval scheduler was interrupted; sync recovers overdue state.
Ending early includes unanswered questions in reports with zero attempts/points.

Host operations use revision checks to prevent repeated transitions. A stale request
returns `STALE_VERSION`; sync and review before retrying. Answer identity is the
durable `(player_id, question_id)` uniqueness constraint. A same-choice retry succeeds
without rescoring even after the phase advances; a different choice returns
`ALREADY_ANSWERED`. Accepted answers commit before acknowledgements. Attempt count is
one; missing answers are zero. Client-supplied time and score fields are ignored.

Correct answers award the question's fixed points. Wrong/missing answers award zero.
Consecutive correct answers create a visual streak; a wrong or missed question resets
it. Team totals are sums of member points. Duel requires exactly two players; free for
all ranks individuals. Ties share rank. No speed/streak/cosmetic multiplier exists.

Instant feedback discloses only the submitting player's outcome while the question
is open. After-question feedback is released at lock. End-of-game feedback keeps keys,
outcomes and scoreboards hidden until results. Raw player scores and answers are not
available to students through PostgREST. Teachers may read their own answer keys.

Errors include `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_INPUT`, `BAD_PIN`,
`DUPLICATE_NICKNAME`, `SESSION_FULL`, `SESSION_CLOSED`, `SERVER_BUSY`, `RATE_LIMITED`,
`STALE_VERSION`, `INVALID_PHASE`, `EMPTY_QUIZ`, `NEED_PLAYERS`, `WRONG_QUESTION`,
`ANSWER_CLOSED`, `ALREADY_ANSWERED`, `NOT_FOUND`, and `SERVER_ERROR`.
Database/provider details and credentials are never returned in socket errors.

## HTTP

All `/api/*` endpoints require a Bearer access token. Exact frontend origins only;
responses use `Cache-Control: no-store`. Validation failures use a JSON `error.code`.

- `POST /api/teacher/enroll { code }`: confirmed permanent account + administrator invitation.
- `GET /api/history?role=teacher`: owned sessions, up to 100. Omit role for own player history.
- `GET /api/sessions/:id/results.csv`: finished session, host gets class rows; player gets only own rows.
- `GET /api/study`: own completed-game mistakes, recent accuracy, persistent study-day rewards.
- `POST /api/study/cosmetics { theme, avatar }`: select only earned inventory.

AI drafting, slide extraction, tutoring and generated-practice routes have been removed.
Historical practice records remain in the database and continue to count toward own
study totals; the application cannot create or answer new practice sets.
