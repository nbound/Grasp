# Game creation implementation

Branch: `feat/game-creation`. Source: the supplied implementation plan and 46-story product backlog.

## Decisions

- New questions have four choices. Existing 2–6-choice quizzes remain readable.
- One accepted answer is one attempt. Retries do not change answers or scores.
- Points depend only on correctness; time, streaks, cosmetics, and mode never multiply scores.
- Existing teacher records are retained. New accounts are students until explicitly enrolled using a server-configured teacher invitation. Editable user metadata never grants roles.
- Hosted quiz questions are immutable. Duplicate to edit; archive to hide from the dashboard.
- PostgreSQL owns game phases, deadlines, answers, and scores. Socket.IO owns connection presence only.
- A single Render instance is the initial deployment target.
- AI assistance was removed at the user's request on November 8, 2026: quiz/slide generation, tutoring, adaptive practice, provider configuration and dependencies. Existing practice data is retained for historical totals and rewards; no practice endpoints remain.
- P2 implementation owner: repository maintainers. Acceptance: cosmetics use study-day streaks; team/duel/free-for-all modes preserve fixed scoring and ties.

## Verification ledger

The branch implements the repository work in the supplied plan except the AI
features subsequently removed at the user's request (GR-39, GR-43 and GR-46). The accompanying [sprint report](sprint-report.md), [deployment guide](deployment.md)
and [event contract](game-contract.md) record architecture, acceptance and release steps.

| Coverage           | Status and evidence                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| GR-01-09           | Existing foundation retained; new versioned upgrade and schema-snapshot check                                                      |
| GR-10-15           | Auth, invitation enrollment, RLS, atomic quiz editor/dashboard and host UI; local browser flow covered                             |
| GR-16-18           | Current diagrams and consolidated report supplied; external collaborator/course-report evidence is not independently verified      |
| GR-19-26, GR-28-30 | Durable gameplay, fixed scoring, streaks, feedback/sound, controls and progress; database/server tests                             |
| GR-27              | Vercel/Render configuration and release guide prepared; no hosted deployment performed                                             |
| GR-31-35           | Results, CSV, history, automatic resume and concurrent 40-player/restart test                                                      |
| GR-36-37           | Responsive UI, accessibility checks and sprint documentation; physical-device/screen-reader release pass remains                   |
| GR-38-42           | Timers, feedback modes, student linking/history and demo guide; GR-39 AI drafting removed by request; real Auth/mail checks remain |
| GR-43-46           | Persistent cosmetics and competitive modes implemented; GR-43 tutor/adaptive difficulty and GR-46 generated practice removed by request |

Verified locally: 19 frontend tests, 17 server tests, 38 database tests, lint, production
build, schema snapshot, 40-player burst/restart test, and two browser enrollment/game
flows. Browser checks include axe accessibility on the dashboard and mobile feedback.
Tests use disposable fixtures and do not change hosted data.

Open release dependencies: start Docker for real Supabase Auth/API tests; select and
configure staging/production hosting; verify real email confirmation/reset/linking,
CAPTCHA, physical devices and screen readers. Confirm team
access and integrate the report with the separate course submission. Existing local
environment files and the supplied spreadsheet were left unchanged.

The six-page PDF is `output/pdf/grasp-implementation-report.pdf`. Regenerate it
with `python docs/export-report.py` in a Python environment containing ReportLab.
All six rendered pages were visually checked. Changes are local and uncommitted.
