# Grasp backend

Backend foundation (GR-05–08): Express health endpoint, authenticated Socket.IO,
teacher hosting, guest joins, automatic teams, and live rosters. It connects the
existing student frontend to Supabase. Teacher screens, game start/scoring,
answer persistence, and active-game resume remain separate backlog work.

## Local setup

Use Node 22.12+ (validated with Node 24). In `server/`, run `npm ci`. Copy
`.env.example` to `.env.local` only if you do not already have one. Set
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` for the
same project as the frontend. Keep the secret exclusively on the server.
The server reads `.env.local`, then `.env`; existing process variables win.
Never place tokens or keys in logs, chat, screenshots, URLs, or tracked files.

Apply the existing migrations following [database setup](../supabase/README.md)
if the project is not already provisioned. Enable anonymous Auth sign-ins.

```sh
npm run dev
```

`GET http://localhost:3001/health` returns `{ "status": "ok" }`. This is process
liveness, not evidence of database connectivity. In `frontend/.env.local`, set
the same Supabase URL and **publishable** key, plus:

```dotenv
VITE_GAME_SERVER_URL=http://localhost:3001
VITE_STUDENT_DEMO=false
```

Run `npm run dev` in `frontend/`. The browser persists an anonymous Supabase
session and supplies the current user token in each socket handshake. An
existing teacher session is reused, never replaced by a guest.

## Security and lifecycle

- See the [implemented socket contract](../docs/student-socket-contract.md).
  `host_create` checks permanent-user status and quiz ownership, then inserts
  through the user's RLS client. Cryptographically random six-digit PINs use
  database uniqueness and bounded collision retries.
- `player_join` calls `join_game` with the verified user's JWT (not the service
  key). The transactional RPC owns capacity, nickname uniqueness, idempotence,
  and balanced teams. The server verifies the returned player's ownership.
- The service client verifies tokens and reads lobby data. Broadcasts explicitly
  allow only session ID/PIN/status, team ID/name, and player ID/nickname/team ID.
  No emails, auth IDs, tokens, questions, or answer keys leave this boundary.
- Tokens are verified at connection and every operation, plus every minute for
  idle subscribers. Failed idle verification disconnects the socket. Browser
  token refresh reconnects with a fresh token; students explicitly rejoin.
- Exact allowed browser origins apply to polling and WebSocket handshakes.
  Native clients without Origin still require authentication. Payloads are
  capped at 16 KiB; each identity gets 30 connection/operation attempts per
  minute across tabs/reconnects. Raw SDK/SQL errors are never sent or logged.

Postgres owns durable membership; the in-memory SessionManager owns presence.
Leave/disconnect removes **presence only**, preserving identity, team, and
future answer history. Offline records reserve capacity/nicknames until expiry.
Multiple tabs sharing one Auth session represent one player. Use separate
browser profiles/private contexts for independent students.

Run one server instance. Multiple replicas require shared presence, a Socket.IO
adapter, and coordinated rate limiting. After restart, clients explicitly rejoin
the lobby. Active-game resume and durable host-create request IDs are not yet
implemented. Same-socket host_create retries reuse the last session for that
quiz; after reconnect use host_join with the saved session ID.

## Verification

Run `npm run check:connection` in `server/` to check the configured project
read-only. It verifies required lobby columns and the anonymous Auth setting,
without creating users or fetching application rows. It does not prove RLS/RPC
behavior. It exits unsuccessfully when prerequisites are missing.

For a new hosted Supabase project, apply the repository's initial migration
once to its empty application schema and enable anonymous sign-ins in Supabase
Auth. Update both local environment files to use that project's URL and public
key, and update the server-only secret key. Restart the frontend and backend,
then run this check and the full integration flow. The readiness check reports
the currently configured project's state without changing its data or settings.

In `server/`, run `npm test`. Tests use real localhost HTTP/WebSocket transports
with fixture identities and repositories. They cover auth, origin rejection,
ownership, room isolation, retries, presence, rate limits, PIN collisions, and
Supabase SDK user-token versus service-key requests. They never load app env files.

To verify your new **hosted** project with the running local backend, follow
the [hosted smoke-test guide](../docs/hosted-smoke-test.md). Its explicit
`npm run smoke:hosted -- --project-ref YOUR_NEW_PROJECT_REF` command creates
temporary test fixtures and checks hosting plus three student joins. Add
`--hold` to keep its lobby open for student browser testing. This opt-in runner
is not part of normal tests or CI and does not test teacher signup/email delivery.

For the real Auth/PostgREST/socket smoke test, start Docker and run
`npx supabase start` at the repository root, then in `server/`:

```sh
npm run test:local
```

The CLI must be available to `npx --no-install`. This test refuses non-local
Supabase URLs. It creates a teacher/quiz, hosts, joins three anonymous users,
verifies rejoin identity, and cleans up only its fixtures. It never reads app
env files. Run `npm test` in `supabase/`, plus `npm test`, `npm run lint`, and
`npm run build` in `frontend/`. Mock transport and embedded RLS tests alone do
not prove hosted operation.

## Other devices and deployment

For LAN testing, start Vite with `npm run dev -- --host 0.0.0.0`. Set the frontend
game-server URL to your computer's LAN address on port 3001 and add the exact LAN
frontend origin (e.g. `http://192.168.1.20:5173`) to `CLIENT_ORIGINS`. Restart both
processes. The phone must also reach Supabase; localhost on a phone is the phone.
Allow local firewall access as appropriate for your network.

For Render: root `server`, build `npm ci`, start `npm start`, health `/health`,
`NODE_ENV=production`, and the required Supabase variables. Set `CLIENT_ORIGINS`
to exact HTTPS frontend origins, comma-separated. Render supplies `PORT`; the
server binds `0.0.0.0`. Use one instance initially. For Vercel: root `frontend`,
public env variables, HTTPS server URL, and SPA rewrites. Register approved
frontend URLs in Supabase Auth. Before public release configure anonymous Auth
abuse controls/rate limits; a CAPTCHA challenge UI is not included here.
Normal tests do not change hosted data. The explicitly invoked hosted smoke
runner creates and removes only its test fixtures as described above.

References: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser),
[anonymous Auth](https://supabase.com/docs/guides/auth/auth-anonymous),
[Socket.IO origin checks](https://socket.io/docs/v4/handling-cors/).
