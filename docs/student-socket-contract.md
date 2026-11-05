# Lobby socket contract (GR-08)

Implemented by `server/src/app.js`. Use Socket.IO 4.x with
`auth: { accessToken }`: a current Supabase user token, never a project API key.
Authentication failure produces `connect_error` with `UNAUTHORIZED`.

## Requests

All requests except `player_left` require acknowledgement callbacks. The student
client uses an 8-second timeout. Success: `{ ok: true, data: ... }`.
Failure: `{ ok: false, error: { code: ... } }`.

| Event | Payload | Success data | Authorization |
| --- | --- | --- | --- |
| `host_create` | `{ quizId, maxPlayers?: 40, teamCount?: 2 }` | `{ lobby }` | Permanent teacher, owns quiz |
| `host_join` | `{ sessionId }` | `{ lobby }` | Permanent teacher, owns session |
| `player_join` | `{ pin: "012345", nickname: "Nate" }` | `{ playerId, lobby }` | Verified Supabase user |
| `player_left` | `{}` | `{}` (ack optional) | Current socket membership |

Quiz/session IDs are UUIDs. Capacity is 1-200; team count is 2-8. PINs are
six-digit strings, preserving leading zeros. Trimmed nicknames accept 2-24
Unicode code points without controls and are unique case-insensitively per game.

Repeat joins preserve the original player ID, nickname, and team while the
session remains a lobby, including after refresh with the same Auth identity.
Same-socket host_create retries reuse its last session for that quiz. Save the
session ID and use host_join after reconnect; host_create across reconnects is
not idempotent.

Errors: `BAD_PIN`, `INVALID_INPUT`, `DUPLICATE_NICKNAME`, `SESSION_CLOSED`,
`SESSION_FULL`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `SERVER_BUSY`,
`SERVER_ERROR`. Unknown errors should display a generic retry message.

## Lobby snapshot

```json
{
  "sessionId": "session-uuid",
  "pin": "012345",
  "status": "lobby",
  "teams": [{ "id": "1", "name": "Team 1" }],
  "players": [{ "id": "player-uuid", "nickname": "Nate", "teamId": "1" }]
}
```

Team IDs are stringified database team numbers, scoped to the session.
`lobby_update` broadcasts this complete object to authorized room members after
presence changes. Snapshots are serialized per room. The frontend rejects
malformed snapshots and ignores unrelated session IDs.

The roster represents connected players, deduplicated across their tabs. Leave
and disconnect remove presence, never database player records. A player stays
visible while any of their sockets remains joined. Offline records preserve
team/nickname and reserve capacity. Rejoin uses the persisted Auth identity.

The frontend clears displayed membership on disconnect and asks for the PIN
again. Automatic active-game resume remains GR-34. Transport loss reconnects
automatically; explicit auth failure requires refresh or a session change.
Tokens are verified at connect and every operation, plus once per minute for
idle subscribers. Browser token refresh reconnects with a fresh token.

A supplied user/player ID never grants room access: student membership derives
from the authenticated RPC result. No emails, auth IDs, tokens, answer keys,
scores, or privileged database fields are broadcast.

## Future gameplay

Game start, questions, answer submission, scoring, reveal, and exports are not
implemented in this foundation. GR-19-26 must define their server-authorized
contract before adding handlers. Never trust browser scores, correctness,
timing, or player IDs. Do not expose answer keys before feedback.
