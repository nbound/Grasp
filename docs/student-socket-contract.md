# Student socket boundary (draft for GR-08)

Only the event names `player_join`, `player_left`, and `lobby_update` come from
the supplied backlog. **The payloads below are proposed by this frontend branch;
they are not an existing server API.** Ammar owns GR-08 and should reconcile them
with his server implementation before integration. No server code was present
in the inspected branches.

## Lobby flow implemented by this frontend

Client emits `player_join` with `{ pin: "012345", nickname: "Nate" }`, using
Socket.io's acknowledgement callback and an 8-second timeout. PINs are strings
to preserve leading zeros. Nicknames are trimmed and accept 2–24 Unicode code
points with no control characters; the server must validate independently and
decide case-insensitive duplicate handling.

Success acknowledgement:

```json
{
  "ok": true,
  "data": {
    "playerId": "player-1",
    "lobby": {
      "sessionId": "session-1",
      "pin": "012345",
      "status": "lobby",
      "teams": [{ "id": "fern", "name": "Team Fern" }],
      "players": [{ "id": "player-1", "nickname": "Nate", "teamId": "fern" }]
    }
  }
}
```

Failure acknowledgement:

```json
{ "ok": false, "error": { "code": "DUPLICATE_NICKNAME" } }
```

Recognized errors: `BAD_PIN`, `DUPLICATE_NICKNAME`, `SESSION_CLOSED`,
`SESSION_FULL`. Unknown errors get a generic message; raw server errors are
not displayed. A timeout leaves the user on the join page. The server should
make repeat joins on the same socket idempotent, since a lost acknowledgement
may follow a successful server-side join.

Server broadcasts `lobby_update` with the complete `lobby` object above to the
session room after joins/leaves. The client derives player count and team
membership from that snapshot. It rejects malformed membership and ignores
unrelated sessions. If its own player disappears, it returns to `/join`.

Client emits `player_left` with `{}` when leaving. This direction is also a
proposal: if the server uses `player_left` only as a notification, adapt this
one wrapper to the agreed leave request. The server must identify the player
from the socket's membership, remove it on disconnect, and broadcast a fresh
snapshot. Client-supplied player IDs must not authorize removal of others.

`connect`, `disconnect`, and `connect_error` update connection status. The client
does not queue joins while disconnected. On disconnect it clears membership and
requires an explicit rejoin after connection recovery. Reconnect persistence
and resume tokens remain GR-34. Subscriptions remove only their own listeners,
and the provider connects/disconnects its socket on mount/unmount.

## Future gameplay boundary: planning only

GR-19/20/30/31 will need server-issued question IDs and four public options,
answer acknowledgement with correctness/correct answer/explanation,
server-derived progress and visual streak, team scoreboard, and authorized
end-of-game results. Agree event names and ordering with GR-21–23 before
implementing those handlers. Do not send answer keys before feedback, derive
scores in the browser, or include speed/streak multipliers. Howard's answer
persistence should supply attempts and time data for exports.

Teacher hosting, quiz ownership, Supabase table names/RLS, and optional student
auth have no implemented contract in this branch. They remain separate server,
teacher UI, and database responsibilities.
