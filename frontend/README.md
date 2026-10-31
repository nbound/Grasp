# Grasp student frontend

This branch starts Nathaniel Fadrigon's backlog assignments. It reuses the
React/Vite/Tailwind/React Router configuration from `dev` at `017afc7` and adds
student feature modules, a small shared UI kit, and a Socket.io client adapter.

Use Node 22.12+ (Node 24 was used for validation).

To get this branch on another computer:

```sh
git clone https://github.com/nbound/Grasp.git
cd Grasp
git switch feat/nathaniel-student-frontend
```

If you already have a clone, run `git fetch origin` and
`git switch feat/nathaniel-student-frontend` from its repository root instead.
Then install the frontend dependencies:

```sh
cd frontend
npm ci
```

Copy the example file from inside `frontend`:

```sh
# macOS / Linux / Git Bash
cp .env.example .env.local
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

You can also create `.env.local` in your editor and copy the contents of
`.env.example` into it. Place it beside `frontend/package.json`, and make sure
the filename is not `.env.local.txt`. The example enables demo mode by default;
no Supabase keys or backend are needed.

```sh
npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`. For the local,
single-browser fixture, keep `VITE_STUDENT_DEMO=true` in `.env.local`. Join with PIN
`123456` and a nickname with 2–24 characters. The fixture never contacts a
server, simulates other players, or runs gameplay. Demo mode is disabled in
production builds.

Try submitting an empty form, entering a different PIN, joining with `123456`,
checking your nickname/Team Fern/one-player count, and leaving the lobby.
Opening `/lobby` before joining should redirect to `/join`. Other browser tabs
will not appear in the demo roster.

Restart Vite after changing environment files: press Ctrl+C, then run
`npm run dev` again. `.env.local` is ignored by Git and should stay on your
computer. Commit safe shared defaults and explanations in `.env.example`
instead. Never add secret keys to frontend environment files.

For a live server, change `VITE_STUDENT_DEMO=false` and set `VITE_GAME_SERVER_URL` to
the Node server origin (local default `http://localhost:3001`). Configure its
Socket.io CORS origin to match Vite (`http://localhost:5173` by default).
The server must implement the [draft contract](../docs/student-socket-contract.md).
Vite environment values are public; server secret keys belong only on the server.

```sh
npm test
npm run lint
npm run format:check
npm run build
```

`/join` renders the guest form; `/lobby` requires current membership. Refreshing
or losing the socket connection clears membership in this Sprint 1 framework.
Stable reconnect identity belongs to Ammar's GR-34; it is not implemented here.
No game state or student identity is persisted to browser storage yet.

Code locations:

- `src/components/ui/`: Button, TextInput, Card, scoped color/type/layout tokens.
- `src/features/student/pages/`: join form and server-derived lobby.
- `src/features/student/model/`: validation, public snapshots, membership updates.
- `src/features/student/services/`: injectable demo and Socket.io clients.
- `src/features/student/StudentProvider.jsx`: membership, request and socket lifecycle.
- `tests/student.test.js`: boundary, acknowledgement, error, and subscription checks.

The student routes are currently the app shell. When teacher routes arrive,
compose both route sets under a single `BrowserRouter`; narrow the student
fallback redirect to student paths so it does not capture teacher routes. Shared
UI uses `.grasp-app` CSS variables; wrap teacher pages with that class to reuse
the tokens. Full sprint and merge guidance is in
[the implementation plan](../docs/nathaniel-implementation-plan.md).
