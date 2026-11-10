# Grasp

A live, team-based quiz game for reviewing class material without the time pressure of Kahoot-style games.

Run, configure, and deploy: [deployment guide](docs/deployment.md).
Feature coverage and verification: [implementation status](docs/implementation-status.md).
Gameplay payloads and security: [protocol v1](docs/game-contract.md).

Student framework setup: [frontend/README.md](frontend/README.md).
Nathaniel's backlog-based [implementation plan and branch review](docs/nathaniel-implementation-plan.md)
describes the original frontend work. The implemented [socket contract](docs/student-socket-contract.md)
defines `host_create`, `host_join`, `player_join`, `player_left`, and `lobby_update`.

Backend setup, security boundaries, multi-device configuration, and smoke tests:
[server/README.md](server/README.md). The server now connects the student lobby
to Supabase Auth and Postgres. The app includes teacher auth/enrollment, quiz creation,
live hosting/play, reconnect, results/CSV, student history, timers/feedback modes,
competitive modes, and study history with teacher-written explanations.

Database setup, migrations, security boundaries, and tests are documented in
[supabase/README.md](supabase/README.md).
