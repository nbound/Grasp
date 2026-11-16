# Grasp frontend

React 19, Vite, Tailwind 4, React Router, Supabase Auth and Socket.IO.
Use `feat/game-creation` for this implementation. See the root
[deployment guide](../docs/deployment.md) for setup, teacher invitations, Auth,
multi-device testing and release configuration.

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run test:e2e
```

Copy `.env.example` to `.env.local` without overwriting an existing environment.
Set the Supabase URL, publishable key and game server URL; restart Vite after
changing them. Secrets belong only on the server.

## Routes

- `/join`: guest sign-in on submission and PIN/nickname validation.
- `/login`, `/signup`, `/auth/callback`, `/auth/recovery`, `/auth/reset`: accounts.
- `/account/link`: preserve a guest identity while attaching email/password.
- `/teacher-enrollment`: confirmed account plus private teacher invitation.
- `/teacher`: quiz dashboard with create, delete/archive, duplicate and host.
- `/teacher/quizzes/:id`: atomic editor, reorder and validation.
- `/teacher/host/:sessionId`: lobby, host controls, distribution and class results.
- `/teacher/sessions`: active/past sessions and teacher CSV.
- `/play/:sessionId`: student lobby, question, feedback, scoreboard, results and own CSV.
- `/study`: history, teacher-written explanations and cosmetic inventory.

One root data router owns all live routes. Teacher guards reject guests and registered
students without a teacher profile; server/database authorization remains decisive.
Auth initialization never signs a user in anonymously. Guest creation occurs only
on Join. Browser storage contains the SDK session and safe last-session/request IDs,
never answer keys or the server secret. Refresh/reconnect rebuilds the current game
from the server with the same verified user ID. Multiple tabs share that identity;
use independent browser contexts for separate players.

The editor warns before leaving unsaved changes, including browser Back/Forward.
Successful saves bypass that warning. Questions on hosted quizzes are read-only;
duplicate them from the dashboard to edit.

## Testing and legacy demo

The Playwright suite runs disposable test services from `server/tests/`, uses real
database migrations, and exercises teacher enrollment, isolation, quiz creation,
three independent mobile-sized student contexts, refresh, results and export.
Auth/Data API transport is a fixture; see the release guide for real Supabase
verification. Axe checks the dashboard and mobile feedback screen. Physical devices
and screen readers still need manual release testing.

The original one-browser lobby fixture remains available in development only with
`VITE_STUDENT_DEMO=true`, PIN `123456`. It does not simulate other players or gameplay.
The old `features/student` provider is used only by that fixture; the live product uses
`features/join`, `features/game`, shared Auth, and the v1 game protocol.
