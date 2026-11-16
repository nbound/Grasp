# Final demo script (GR-42)

A 6 to 7 minute live demo of Grasp, based on the "Reproducible demonstration" steps
in `docs/sprint-report.md`. Button and screen names in quotes are the exact UI text.
Use disposable demo data only. This file holds no URLs, keys or passwords for hosted
services.

## Roles

The roles matter more than the names; swap people freely.

| Role                 | Person             | Device                      | Job during the demo                                                   |
| -------------------- | ------------------ | --------------------------- | --------------------------------------------------------------------- |
| Teacher and narrator | Ammar Suleyman     | Laptop on the projector     | Hosts both games and narrates                                         |
| Student 1            | Nathaniel Fadrigon | Phone                       | Answers correctly, refreshes mid-question, downloads own CSV          |
| Student 2            | Amrit Santhanam    | Phone                       | Answers question 1 wrong, then shows Study Space and account linking  |
| Student 3            | Howard Wei         | Phone, plus a second laptop | Turns on airplane mode in Run 2; runs the fallback commands if needed |

Phone holders hold their screen up when their step comes and say the line marked
for them.

## Before the demo

### Option A: hosted (preferred)

Deploy and configure as described in `docs/deployment.md` ("Hosting", or "Different
devices" for a LAN setup). Then check:

- The phones' network reaches the frontend and the game server. Supabase has
  anonymous sign-ins, email confirmation and the `/auth/callback` and `/auth/reset`
  redirect URLs enabled.
- A teacher account exists: "Create Account", confirm the email, sign in, then
  "Teacher Enrollment" with the invitation set as the server's `TEACHER_SIGNUP_CODE`.
  Sign in on the laptop before the demo starts.
- Student 2 can open a mailbox on the phone (only for the optional confirmation in
  step 9).
- Two quizzes exist, made with "Create Quiz +". A hosted quiz becomes read-only, so
  after a rehearsal use "Duplicate" to get fresh copies.
  - Demo Run 1: "Feedback Timing" set to "After Each Question", "Game Mode" set to
    "Teams", "Enable Question Timers (never changes points)" unchecked, two questions,
    each with an "Explanation". Example: "Which HTTP status code means Not Found?"
    (200, 301, 404, 500) and "Which data structure is first in, first out?" (Stack,
    Queue, Heap, Tree).
  - Demo Run 2: "End of Game" feedback, "Teams", timers checked, one question with
    "Time Limit (Seconds)" set to 15.
- A terminal on the laptop shows a fresh `npm --prefix server run load:test` run for
  step 10. It is fully local and safe to run during setup.
- Leave game sound at "Sound Off" (the default).

### Option B: local fixture stack (no network, also the fallback)

This runs the real migrations in embedded PostgreSQL (PGlite), the real Socket.IO
server, and a local stand-in for Supabase Auth and the Data API. From the
repository root:

```sh
# once
npm run setup

# terminal 1, from the repository root
node server/tests/browserFixture.mjs

# terminal 2
cd frontend
VITE_SUPABASE_URL=http://127.0.0.1:54329 \
VITE_SUPABASE_PUBLISHABLE_KEY=fixture-public \
VITE_GAME_SERVER_URL=http://127.0.0.1:3009 \
VITE_STUDENT_DEMO=false \
VITE_TURNSTILE_SITE_KEY= \
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Wait for "Disposable browser fixture ready. No hosted credentials are used." in
terminal 1, then open exactly `http://127.0.0.1:4173`. Both fixture servers allow
only that origin, so `localhost:4173` fails.

- Teacher: `/login?role=teacher` with `teacher@example.test` and `fixture-password`.
  The dashboard already has the seeded quiz "Sample arithmetic" (one question, after
  each question, timers off).
- `fixture-invitation` is the teacher invitation, needed only to show "Teacher
  Enrollment" for a newly created account.
- Students: three separate browser profiles or browsers on the laptop. Tabs in one
  profile share one guest identity and count as one player.

Limits of Option B:

- Phones cannot join: everything listens on 127.0.0.1.
- Data is in memory. Stopping terminal 1 erases all quizzes and games, so create the
  demo quizzes after each start.
- No email is sent. Submitting the "Keep Your Study History" form upgrades the guest
  immediately.
- The fixture does not implement `/api/study`, so Study Space shows an error below the
  "Keep Your Progress" card. Teacher session history works.
- `npm run test:browser` starts its own copy on the same ports, so stop both
  terminals before running it.

## Script

Times are cumulative targets (about 6.5 minutes).

### 1. Opening (0:00 to 0:20)

- Show: the teacher dashboard, "Your Quizzes".
- Say: "Grasp is a team quiz game for reviewing class material. Correct answers earn
  fixed points; speed never does. The browser signs in with Supabase, live play runs
  through our Express and Socket.IO server, and every phase, answer and score is
  stored in Postgres, so a refresh or a server restart loses nothing."

### 2. Quiz settings (0:20 to 0:45)

- Do: on the Demo Run 1 card click "Edit" ("View" if it was hosted in rehearsal).
  Point at "Feedback Timing" ("Instant, After Submitting", "After Each Question",
  "End of Game"), "Game Mode", the unchecked "Enable Question Timers (never changes
  points)", "Explanation" and "Points for a Correct Answer". Click "Back to Quizzes".
- Say: "Teachers write every question and explanation. Timers are off by default,
  and when on they only close the question. Feedback timing is chosen per quiz."
- Tickets: GR-13, GR-14, GR-38, GR-40.

### 3. Host and join (0:45 to 1:30)

- Do (laptop): click "Host" on Demo Run 1. The lobby shows "Help Your Students Find
  Their Spark.", the join address, the six-digit PIN and the Foxes and Owls team
  cards.
- Do (phones): open the join address, fill in "Game PIN" and "Your Nickname", tap
  "Join Your Team →". Each phone shows "You’re In. Play for Your Team." and its team.
- Show: the laptop reads "3 connected · 3 joined".
- Say: "Students need no account. Joining signs them in as anonymous Supabase users,
  the server verifies that token on every socket event, and the database puts each
  new player on the smallest team."
- Tickets: GR-05 to GR-08 (server, sessions, `host_create`, `player_join`,
  `lobby_update` and the event contract), GR-02, GR-03, GR-15.

### 4. Question 1 and a refresh (1:30 to 2:30)

- Do: click "Start Game". Student 1 taps the correct answer, Student 2 a wrong one.
  Their phones show "Answer saved. Feedback will appear when your teacher reveals the
  answer." The laptop shows "2 of 3 answered".
- Do: Student 1 refreshes the browser. The phone shows "Reconnecting… Your saved
  answers are safe." and then the same question with the choice marked "✓ Selected"
  and every button locked.
- Do: Student 3 answers correctly. The laptop shows "3 of 3 answered".
- Say (Student 1): "I refreshed and came back as the same player on the same team.
  The server matched my sign-in to my existing player row, and my answer was saved in
  Postgres before my phone got its acknowledgement."
- Tickets: GR-19, GR-21, GR-26, GR-34.

### 5. Reveal (2:30 to 3:05)

- Do: click "Lock Answers & Reveal".
- Show: Students 1 and 3 see "✓ Correct! Points for Your Team.", "+1000 points" (the
  default point value) and "✦ 1 answer streak". Student 2 sees "↗ Learn It. Win the
  Next One." with the correct answer and the explanation. The laptop shows "Answer
  Revealed", the answer count for each choice and the "Team Scoreboard".
- Say: "Points come only from correctness. A team's score is the sum of its members'
  points. The streak is visual and never multiplies a score, and equal scores share
  a rank."
- Tickets: GR-20, GR-21, GR-22, GR-23, GR-24, GR-25, GR-30.

### 6. Question 2 and finish (3:05 to 3:25)

- Do: click "Next Question", everyone answers, click "Lock Answers & Reveal", then
  "Finish Game".
- Tickets: GR-24.

### 7. Results and exports (3:25 to 4:00)

- Show: the laptop shows "Look What Your Students Figured Out." with a row per
  student and question, including "Attempts" and "Time". The phones show "Knowledge
  Played. Points Earned." with only their own rows.
- Do: click "Download Class CSV". Student 1 taps "Download My CSV". On the laptop
  click "Continue to Session History →": "Your Sessions" lists the game with
  "Results" and "CSV".
- Say: "The class CSV has every student and question; a student's CSV has only their
  own rows. Attempts is 1 for an answer and 0 for a missed question. Time is recorded
  but never scored."
- Tickets: GR-31, GR-32, GR-33.

### 8. Run 2: timer and end-of-game feedback (4:00 to 5:15)

- Do (laptop): "My Quizzes", then "Host" on Demo Run 2.
- Do (phones): "Menu", "Join a Game", the new PIN and a nickname, "Join Your Team →".
  Each phone keeps its guest identity.
- Do: click "Start Game". Every screen shows "N seconds remaining".
- Do: Student 1 answers and sees "Answer saved. Feedback will appear at the end of
  the game." Student 3 turns on airplane mode and sees "Reconnecting… Your saved
  answers are safe." Student 2 does not answer.
- Do: nothing on the laptop. When the countdown reaches 0, the server closes the
  question within about a second.
- Show: the phones show "Scores will appear when feedback is released." and no
  correct answer.
- Do: Student 3 turns airplane mode off. The phone reconnects to the same screen.
- Do: click "Finish Game". Results now show every answer, correct answer and
  explanation. Student 2's row reads "Not answered" with 0 attempts.
- Say: "The deadline is stored in Postgres. A one-second server check closes the
  question, and every read runs the same check, so it closes on time even across a
  server restart. An answer after the deadline is rejected with ANSWER_CLOSED. In
  end-of-game mode students see no outcomes or scores until results."
- Presenter note: the teacher view still shows the "Team Scoreboard" after the
  question closes, so the projector shows totals even in end-of-game mode.
- Tickets: GR-38, GR-40, GR-34.

### 9. Study Space and account linking (5:15 to 6:10)

- Do (Student 2): "Menu", "Study Space".
- Show: the "Keep Your Progress" card, "N Day Study Streak", "N recent answers · N
  correct", "Your Games" with both games, and under "Train for Your Next Team
  Challenge" the missed question with "Your answer", "Correct answer" and the
  teacher's explanation. The Theme and Avatar menus are the study-streak cosmetics
  (GR-44), and "Cosmetics never affect points."
- Do: tap "Keep Guest History →", enter the email, tap "Continue". The page shows
  "Check your email. Confirm the address, then choose a password to keep this same
  player and history."
- Optional, if time allows: open the email, follow the link to "Choose a Password",
  enter a password of at least 12 characters, tap "Continue". Study Space opens
  without the guest card and lists the same games.
- Say (Student 2): "Linking adds an email and password to this same guest user
  instead of creating a new account, so the games I played as a guest stay mine on
  any device."
- Tickets: GR-41.

### 10. Close (6:10 to 6:35)

- Show: the terminal with the `npm --prefix server run load:test` output.
- Say: "This plays a full game with 40 simulated players against the real server and
  SQL. It reports join time, answer acknowledgement p50, p95 and max, reconnects a
  tenth of the players mid-game, and checks every player and team score exactly.
  These are local numbers, not hosted latency."
- Say: "AI question drafting, tutoring and generated practice (GR-39, GR-43, GR-46)
  were removed by team decision, recorded in `docs/implementation-status.md`.
  Questions and explanations are written by teachers."
- Tickets: GR-35, GR-39, GR-42.

If running long: in step 6, click "End Game" and confirm "End this game and show
final results?" instead of playing question 2 (unplayed questions appear in results
with 0 attempts), and skip the optional email confirmation in step 9.

## Fallback if Wi-Fi or hosted services fail

1. Start Option B on the laptop. Re-create Demo Run 2. If there is no time to
   re-create Demo Run 1, use the seeded "Sample arithmetic" quiz for steps 3 to 7
   and skip step 6 (with one question, the button after the reveal is "Finish
   Game").
2. Students become three browser profiles side by side on the laptop. A refresh is a
   reload of one student window. For the airplane-mode step, open DevTools in one
   student window, set Network to Offline, then set it back.
3. In step 9, show the "Keep Your Progress" card and the "Keep Your Study History"
   form only, and say that the real flow needs Supabase email confirmation.
4. If the browser demo cannot run at all, show the automated evidence instead. From
   the repository root:

```sh
npm --prefix server run load:test
npm run test:game
npm --prefix server run test:timer
npm run test:browser
```

- `load:test` (GR-35): everything stays on 127.0.0.1. A child process runs the real
  server on embedded PGlite with the real migrations, and the script drives the
  players. For connect, join, each question's answers and the mid-game reconnect it
  prints ok counts, p50, p95, max and wall time in milliseconds, then a scores line
  with exact player and team counts and team sizes, and finally PASS or FAIL.
  `--players N` (1 to 200) and `--questions N` (1 to 6) change the size.
- `test:game` (GR-21, GR-26, GR-31, GR-34, GR-35): 40 Socket.IO clients answer in one
  burst (it prints "40-answer burst acknowledged in N ms") and the totals are
  checked. An unrelated teacher is refused, a duplicate tab adds no points, the
  server restarts mid-game, a player resumes with the same ID and team, and the CSV
  is own-rows-only for a student and refused for another teacher.
- `test:timer` (GR-38): plays the same three-question quiz with four players untimed,
  then timed. Answers that took 45 seconds still earn full points, an answer after the
  deadline gets ANSWER_CLOSED, `game_sync` closes the overdue question without the
  host, and per-player points, streaks and team totals are identical in both runs.
- `test:browser` (GR-12, GR-31, GR-34, GR-36): Playwright starts its own fixture
  stack on ports 54329, 3009 and 4173, so stop Option B first, and run
  `npx --prefix frontend playwright install chromium` once beforehand. It covers
  signup and invitation enrollment, quiz creation, three students in separate
  mobile-sized browsers, a refresh after answering, reveal, results, CSV download,
  the linking and password pages, and axe accessibility checks.
