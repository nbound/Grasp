# Run and release Grasp

## Local setup

Use Node 24 (minimum 22.12). From the repository root:

```sh
npm run setup
```

Copy `frontend/.env.example` to `frontend/.env.local` and `server/.env.example` to
`server/.env.local`. Configure the same Supabase project URL and publishable key in
both; place the secret key only in `server/`. Never expose a secret through `VITE_*`.

Apply ordered migrations with the Supabase CLI. For an empty disposable local stack,
start Docker, run `supabase start`, then `supabase db reset`. The reset command deletes
local data: do not use it on a database whose contents must be retained. Existing
hosted projects receive only unapplied migrations with `supabase db push` after
reviewing the migration diff and confirming the target project. `schema.sql` is an
assembled reference, not a script to reapply over existing tables.

In two terminals:

```sh
npm run dev:server
npm run dev:frontend
```

Open `http://localhost:5173`. Enable anonymous Auth, email confirmation, and the
callback/reset redirect URLs in Supabase. Existing teacher profiles remain valid.
New registrations are students. To create a teacher, set a long random
`TEACHER_SIGNUP_CODE` on the server, create an account through the UI, confirm its
email, sign in, and use Teacher enrollment with that invitation. Keep the code private
and rotate it after distributing invitations. An empty value disables enrollment.
User-editable metadata never assigns teacher roles.

Guest history linking uses the existing guest identity: choose Keep guest history,
enter an email, confirm its link, then choose a password. Signing into a different
existing account does not merge guest history; do not sign out first if it must be kept.

Quiz questions and explanations are written by teachers. AI assistance, slide uploads
and generated practice are removed; no AI provider configuration is used.

## Different devices

Use the development machine's LAN address for the frontend and game server, not
`localhost`, on phones. Set `VITE_GAME_SERVER_URL=http://<LAN-IP>:3001`, add the exact
`http://<LAN-IP>:5173` to `CLIENT_ORIGINS`, and allow the local ports through the local
firewall if needed. Add LAN callback/reset URLs to the local Supabase Auth configuration.
Use independent browser contexts/devices: tabs share Supabase storage and normally
represent the same player. Multiple tabs never create extra scores or team members.

## Hosting

1. Apply the new migration to an explicitly selected staging Supabase project. Back
   up existing data first. Enable Auth anonymous sign-in and email confirmations.
2. Create the Render web service from `render.yaml`. It uses `server/`, Node 24,
   `/health`, and a single instance. Supply the server environment variables and exact
   production frontend origin.
3. Create a Vercel project rooted at `frontend/`. Supply the browser URL/publishable
   key and Render HTTPS URL. `frontend/vercel.json` handles SPA deep links. Never set
   `VITE_STUDENT_DEMO=true` for release; it is ignored in production builds anyway.
4. Register production `/auth/callback` and `/auth/reset` URLs in Supabase. Use exact
   preview origins explicitly if testing previews; no wildcard credentialed CORS.
5. Configure Supabase CAPTCHA (Turnstile) and its matching
   `VITE_TURNSTILE_SITE_KEY`. Configure Supabase's Auth rate limits and an appropriate
   SMTP provider. Verify real confirmation/recovery delivery. Set provider spend limits.
6. Complete the release checklist below before sending classroom invitations.

Do not horizontally scale this build: presence/broadcasts and rate budgets are local
to one server. PostgreSQL state survives restarts, but multiple instances need a shared
Socket.IO adapter, shared rate budgets, and load-balancer configuration. Durable state
does not rely on Socket.IO connection recovery. If the host disconnects, the game stays
at its current phase until they reconnect; enabled timers still close questions. Sessions
expire after 24 hours and the server moves them to results.

## Verification

```sh
npm run check
npm run test:game
npx --prefix frontend playwright install chromium
npm run test:browser
```

The browser suite uses a loopback-only fake Auth/Data API facade with the real
PostgreSQL migrations and product sockets. It does not validate Supabase mail, GoTrue,
PostgREST relationship inference, hosted TLS, Render or Vercel. The opt-in real-stack
suites are `npm --prefix supabase run test:local` and `npm --prefix server run test:local`
after starting local Supabase. The hosted lobby smoke tool in `server/README.md`
requires an explicit matching project reference and disposable test users.

Release checklist (manual evidence must be recorded):

- Real teacher signup/confirmation/login/recovery and student guest-to-account linking.
- Two teachers isolated through UI and direct APIs; student enrollment requires an invitation.
- Teacher creates/reorders/saves a quiz and hosts three independent browser/device clients.
- Complete games in all feedback/mode combinations, with timers both off and on.
- Refresh before/after an answer; change networks; restart the server mid-question.
- Confirm own CSV versus teacher CSV; try an unrelated student's and teacher's URLs.
- Vercel deep-link refresh; exact Render CORS; secrets absent from built assets.
- Desktop, iOS Safari, Android Chrome; keyboard, screen reader, reduced motion and touch targets.

## Retention and operations

No automatic deletion of student learning history is enabled. `node
server/scripts/cleanupGuests.js` is a dry run for anonymous accounts older than 30 days
with no player or legacy practice records. Review its count; apply only with `--apply
--project=<configured-project-ref>`. This intentionally preserves accounts with history
because deleting them cascades records. Agree on a separate retention policy before
removing completed-session data. Do not revoke legacy API keys until every deployment
has switched to publishable/secret keys and a real smoke test has passed.

Health currently verifies the running process; gameplay errors reveal database outages
to users as retryable failures. Accepted answers are never acknowledged before commit.
Monitor Auth/database errors, health, and restarts without logging credentials or answer keys.
