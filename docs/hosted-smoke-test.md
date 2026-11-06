# Test the new hosted Supabase project

The current app has student screens but no teacher signup/dashboard/Host screen.
Use the opt-in runner below to exercise real teacher login, RLS quiz creation,
hosting, anonymous joins, live rosters, and reconnects against the new project.
It connects to your already-running local backend; Docker is not required.

## Configure and start

Apply the initial migration once to the new empty project's application schema.
Enable anonymous Auth sign-ins. In `frontend/.env.local`, set the new
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus
`VITE_GAME_SERVER_URL=http://localhost:3001` and `VITE_STUDENT_DEMO=false`.
In `server/.env.local`, set that project's `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`. Never put the secret key
in frontend variables, command arguments, or chat. Restart both running
processes after changes; a backend still using the old project will reject the
new project's user tokens.

In a terminal opened in `server/`, run `npm run check:connection`. Every schema
check must pass and anonymous Auth must report enabled. This is a prerequisite,
not the end-to-end test.

## Automated hosted check

In `server/`:

```powershell
npm run smoke:hosted -- --project-ref YOUR_NEW_PROJECT_REF
```

Use the 20-letter project reference from the new project's dashboard, not an
API key. The runner refuses to proceed unless it exactly matches the configured
Supabase URL. It uses the backend on localhost at the configured PORT (3001 by
default) and sends the frontend Origin `http://localhost:5173`.

This command creates temporary test data: two confirmed teacher accounts, one
quiz/question/session, and three anonymous students. It checks password login,
teacher ownership isolation, anonymous hosting denial, duplicate nickname
rejection, student answer-key isolation, balanced teams, a live host roster,
and rejoining as the same player/team. It removes only its tracked test fixtures
on completion. Credentials, tokens, and raw SDK errors are not printed.
Cleanup errors produce a failing exit code. A timed-out write or forcibly killed
process may leave a fixture; the printed `Grasp smoke` run label identifies it.

Teacher accounts are provisioned through the server-only admin API with email
confirmation already set. This tests login and hosting, not teacher signup,
email delivery, or a teacher UI. CAPTCHA/rate-limit failures need the appropriate
supported auth flow; this runner does not bypass anonymous Auth protection.

## Student browser check

Run the same command with `--hold` in an interactive terminal:

```powershell
npm run smoke:hosted -- --project-ref YOUR_NEW_PROJECT_REF --hold
```

After automated checks pass, the simulated students leave and the runner prints
a test PIN. The host remains connected for up to 20 minutes. Keep that terminal
open while you test the existing UI:

1. Open `http://localhost:5173/join` in three independent browser contexts, for
   example a normal Chrome profile, Chrome Incognito, and an Edge profile.
   Three ordinary tabs, or multiple Incognito windows in one browser session,
   can share one Supabase identity and count as a single student.
2. Join using the printed PIN and three different nicknames. Each lobby should
   show all three players, team assignments, and player count 3. The terminal
   also reports the connected roster count without printing student nicknames.
3. Leave one browser: the other rosters should decrease to 2. Rejoin with the
   same browser session/PIN: its player/team should be preserved and the count
   should return to 3.
4. Refresh one browser and explicitly enter the PIN again when asked. It should
   rejoin without creating a duplicate player. Automatic active-game resume is
   not implemented yet.
5. Before a fresh guest joins, try another guest's nickname: a duplicate error
   should appear. Then use a unique nickname. An already joined identity's retry
   keeps its original nickname instead of attempting a rename.
6. In the new project's Supabase Table Editor, inspect the quiz labelled
   `Grasp smoke <run label>`, its game session, and the associated players/teams.
   These rows must be in the new project. Then close the student tabs and press
   Enter in the runner terminal to finish.

Browser-created anonymous Auth accounts are not owned/deleted by the runner.
Their test-session player records disappear when that test session is removed.
Fixture writes use the project matched by `--project-ref`. Leave the old project
available until these checks and your own review are complete.

Passing this verifies the hosted lobby integration only. Gameplay, answer
scoring, teacher screens, signup/email confirmation UX, and deployment have
separate backlog work and are not certified by this test.

References: [Supabase admin createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
and [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
