import { PublicError } from "./errors.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateHost(value) {
  if (!value || typeof value.quizId !== "string" || !uuid.test(value.quizId))
    throw new PublicError("INVALID_INPUT");
  const maxPlayers = value.maxPlayers ?? 40;
  const teamCount = value.teamCount ?? 2;
  if (
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 1 ||
    maxPlayers > 200 ||
    !Number.isInteger(teamCount) ||
    teamCount < 2 ||
    teamCount > 8
  )
    throw new PublicError("INVALID_INPUT");
  return { quizId: value.quizId, maxPlayers, teamCount };
}
export function validateSessionId(value) {
  if (typeof value !== "string" || !uuid.test(value))
    throw new PublicError("INVALID_INPUT");
  return value;
}
export function validateJoin(value) {
  if (!value || typeof value.pin !== "string" || !/^\d{6}$/.test(value.pin))
    throw new PublicError("BAD_PIN");
  const nickname =
    typeof value.nickname === "string" ? value.nickname.trim() : "";
  if (
    [...nickname].length < 2 ||
    [...nickname].length > 24 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(nickname)
  ) {
    throw new PublicError("INVALID_INPUT");
  }
  return { pin: value.pin, nickname };
}

export class SessionManager {
  // Only connection presence is ephemeral. Membership, PIN uniqueness, capacity,
  // and atomic team assignment remain authoritative in Postgres.
  memberships = new Map();
  constructor(repository) {
    this.repository = repository;
  }
  attach(socketId, membership) {
    this.memberships.set(socketId, membership);
  }
  detach(socketId) {
    const previous = this.memberships.get(socketId);
    this.memberships.delete(socketId);
    return previous;
  }
  async snapshot(sessionId) {
    const lobby = await this.repository.lobby(sessionId);
    const present = new Set(
      [...this.memberships.values()]
        .filter((m) => m.sessionId === sessionId && m.playerId)
        .map((m) => m.playerId),
    );
    return {
      ...lobby,
      players: lobby.players.filter((player) => present.has(player.id)),
    };
  }
}
