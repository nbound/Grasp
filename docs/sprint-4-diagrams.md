# Sprint 4 diagrams

Sprint 4 covers GR-38 (per-quiz timer, off by default, never affects score), GR-39
(AI drafting, removed), GR-40 (feedback modes), GR-41 (student account linking and
history) and GR-42 (docs and demo). Each diagram below is drawn from the code, and
each note names the file and function or RPC it follows. Diagram 5 is the reconnect
half of the state machine in diagram 4, kept separate so both stay legible.

## 1. Timed question flow (GR-38)

`public.game_command` in `supabase/migrations/20261106000000_game_creation.sql` sets
`question_started_at` on every `start` and `next`, and sets `deadline` only when the
session's `timer_enabled` is true, using `time_limit_seconds` (5 to 600, enforced by
the `questions` check constraint and `validateQuiz`) or 30 seconds when it is null.
The `answer` branch awards the question's fixed points and stores `response_ms` for
reports only, and `Countdown` in `frontend/src/features/game/GamePage.jsx` renders for
host and students whenever `deadline` is set. The 1-second `expiry` interval in
`createApp` (`server/src/app.js`) and `gameData()` in
`server/src/game/repository.js` both call `game_command(..., 'expire')`, so an overdue
question closes even after a server restart; the host can still close it early with
Lock Answers & Reveal.

```mermaid
sequenceDiagram
    autonumber
    participant H as Host browser
    participant P as Student browser
    participant S as Server (app.js)
    participant D as Postgres
    H->>S: game_start or game_next<br/>{sessionId, revision}
    S->>D: game_command('start' or 'next')
    alt timer_enabled
        Note over D: question_started_at = now<br/>deadline = now + limit<br/>(30 s if limit is null)
    else timer off (default)
        Note over D: deadline = null
    end
    S-->>P: game_update<br/>{question, deadline, serverNow}
    S-->>H: game_update (same deadline)
    Note over H,P: Countdown shown if deadline set<br/>offset = serverNow - Date.now()<br/>redrawn every 500 ms
    P->>S: game_answer<br/>{questionId, choice, requestId}
    S->>D: game_command('answer')
    alt before the deadline
        Note over D: insert answer<br/>points = correct ? points : 0<br/>response_ms is not scored
        S-->>P: ack {accepted: true}
    else deadline passed
        D-->>S: ANSWER_CLOSED
        S-->>P: ack {ok: false,<br/>code: ANSWER_CLOSED}
    end
    loop every 1 s (expiry interval)
        S->>D: repository.expire()
        opt this deadline has passed
            S->>D: game_command('expire')
            Note over D: phase = feedback<br/>deadline = null<br/>streak = 0 if no answer
        end
    end
    S-->>P: game_update {feedback}
    S-->>H: game_update<br/>{feedback, distribution}
    Note over S,D: Every broadcast, game_sync and CSV<br/>reads through gameData(), which runs<br/>expire first: restart recovery
```

## 2. Feedback-mode release (GR-40)

`gameView` in `server/src/game/state.js` builds each socket's state: `revealed` is
true in `results`, or in `feedback` unless the mode is `end`; a student also gets
`feedback` in `instant` mode once they have an answer; scores go to the host always
and to students only when revealed. `GamePage.jsx` renders the feedback card, the
"Scores will appear when feedback is released." placeholder and the results table
from those fields, and the payloads arrive through both `game_update` and the
`game_sync` reply. Because the host view always includes scores, a projected host
screen shows team totals after each lock even in end-of-game mode.

```mermaid
sequenceDiagram
    autonumber
    participant P as Student browser
    participant S as Server (gameView)
    participant H as Host browser
    Note over S: feedback_mode is copied from<br/>the quiz when the game is hosted
    P->>S: game_answer (phase = question)
    alt instant
        S-->>P: feedback {correctIndex,<br/>explanation, correct, points, streak}
        Note over P: Feedback card right away<br/>(no scoreboard yet)
    else after_question or end
        S-->>P: submitted: true, feedback: null
        Note over P: "Answer saved. Feedback<br/>will appear ..."
    end
    H->>S: Lock Answers & Reveal<br/>(game_reveal)
    Note over S: phase = feedback (timer expire too)<br/>revealed = feedback_mode != end
    alt instant or after_question
        S-->>P: feedback + team scores<br/>or leaderboard
    else end
        S-->>P: feedback: null, scores: []
        Note over P: "Scores will appear when<br/>feedback is released."
    end
    S-->>H: distribution and scores in every<br/>mode, answer card if revealed
    H->>S: Finish Game or End Game
    Note over S: phase = results:<br/>revealed in every mode
    S-->>P: own result rows (answer, correct<br/>answer, explanation) + scores
    S-->>H: rows for every player<br/>+ scores
```

## 3. Student account linking and study history (GR-41)

`JoinGame.jsx` creates the guest with `signInAnonymously()`, then `AuthPage` mode
`link` (`frontend/src/features/auth/AuthPage.jsx`) calls `updateUser({ email })` with
a redirect to `/auth/reset`, where mode `reset` sets the password; both calls update
the signed-in guest, so the user ID never changes. `/api/study`
(`studyRepository.study` in `server/src/study.js`) and `/api/history` (`history` in
`server/src/game/repository.js`) both select by `players.user_id`, which is why
earlier games appear without a copy step. `frontend/src/lib/studentAuth.js` also signs
in guests, but only for the older `StudentApp` lobby client, which `App.jsx` mounts
only in demo mode.

```mermaid
sequenceDiagram
    autonumber
    participant B as Student browser
    participant A as Supabase Auth
    participant S as Server (app.js)
    participant D as Postgres
    B->>A: JoinGame: signInAnonymously()<br/>(only when there is no session)
    A-->>B: guest user U<br/>(is_anonymous: true)
    B->>S: player_join {pin, nickname}<br/>with U's token
    S->>D: join_game RPC as U
    D-->>S: players row, user_id = U
    Note over B,D: Answers reference that player row. Linking never copies or moves rows.
    Note over B: Study Space: "Keep Your Progress"<br/>while anonymous. /signup is<br/>refused for a guest session.
    B->>A: /account/link: updateUser({email},<br/>redirect to /auth/reset)
    A-->>B: ok, confirmation email sent
    B->>A: student opens the link
    A-->>B: /auth/reset, still user U
    B->>A: /auth/reset: updateUser({password})
    Note over A: Same user ID U,<br/>now email + password
    Note over B: AuthProvider: no teachers row,<br/>so the account stays a student
    B->>S: GET /api/study (Bearer token)
    S->>A: getUser(token) = U
    S->>D: answers in finished games<br/>for players.user_id = U, old<br/>practice, cosmetics, study_days
    S-->>B: streak, rewards, answered, correct,<br/>last 10 mistakes + explanations
    B->>S: GET /api/history
    S->>D: players where user_id = U<br/>+ session, quiz title (100 max)
    S-->>B: Your Games: Results or<br/>Resume, CSV when finished
```

## 4. Game phase state machine (GR-21, GR-38)

Every host transition runs inside `public.game_command`, which locks the session row
first; the guards in the box run in that order before any phase change. `start` and
`next` share the player and next-question checks, and both `reveal` and `expire`
reset the streak of players who did not answer the current question. `end` is
accepted in any phase except `results`, and `expire` also finishes an unfinished
session once `expires_at` (24 hours after creation) has passed.

```mermaid
flowchart TD
    G["<b>Checked first on start, reveal, next, end</b><br/>caller is not the host teacher: FORBIDDEN<br/>revision differs: STALE_VERSION<br/>expires_at passed: SESSION_CLOSED<br/>action not valid in this phase: INVALID_PHASE"]
    LOBBY([lobby])
    CHK{"players ok?"}
    NX{"next question<br/>exists?"}
    TM{"timer_enabled?"}
    QT(["question<br/>deadline = now + limit<br/>(30 s if null)"])
    QU(["question<br/>deadline = null"])
    FB(["feedback<br/>(answers locked)"])
    RES([results])
    NP[["NEED_PLAYERS"]]
    EQ[["EMPTY_QUIZ"]]
    ANY["any phase<br/>except results"]
    G ~~~ LOBBY
    LOBBY -- start --> CHK
    CHK -- "no: 0 players,<br/>or duel without 2" --> NP
    CHK -- yes --> NX
    NX -- "no, in lobby" --> EQ
    NX -- yes --> TM
    TM -- yes --> QT
    TM -- "no (default)" --> QU
    QT -- "reveal (host), or expire:<br/>deadline passed" --> FB
    QU -- "reveal (host)" --> FB
    FB -- next --> CHK
    NX -- "no, in feedback" --> RES
    ANY -- "end (host), or expire:<br/>expires_at passed (24 h)" --> RES
```

## 5. Reconnect path (GR-34)

`GamePage.jsx` sends `game_sync` on every socket `connect` and every 15 seconds. The
`game_sync` handler in `server/src/app.js` calls `repository.state()`, which runs
`expire` first, then `resumePlayer()` finds the existing `players` row for the
verified user, so a refreshed phone keeps its player ID, team and saved answer.
Socket.IO presence (`SessionManager.memberships`) is the only in-memory state, and
disconnects never delete players or answers.

```mermaid
flowchart TD
    R0["Refresh or network drop<br/>GamePage: 'Reconnecting…', buttons disabled"]
    R1["Socket connects again with the<br/>current Supabase access token"]
    R2["game_sync {sessionId}<br/>(also sent every 15 s while connected)"]
    R3["repository.state():<br/>gameData() runs expire first"]
    R4{"host or player<br/>of this session?"}
    F[["FORBIDDEN"]]
    R5["resumePlayer(): same player ID<br/>and team from the players row"]
    R6["move(): join room session:id"]
    R7["ack {state}, then<br/>game_update to the room"]
    R8["GamePage keeps it when its revision<br/>is at least the current one"]
    R0 --> R1 --> R2 --> R3 --> R4
    R4 -- neither --> F
    R4 -- player --> R5 --> R6
    R4 -- host --> R6
    R6 --> R7 --> R8
```
