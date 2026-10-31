// Draft frontend boundary. Ammar owns the final server contract (GR-08).
export function parseLobby(value) {
  if (
    !value ||
    typeof value.sessionId !== 'string' ||
    typeof value.pin !== 'string' ||
    !/^\d{6}$/.test(value.pin) ||
    value.status !== 'lobby' ||
    !Array.isArray(value.players) ||
    !Array.isArray(value.teams)
  ) {
    throw new Error('Invalid lobby snapshot')
  }
  const teamIds = new Set(value.teams.map((team) => team.id))
  if (
    teamIds.size !== value.teams.length ||
    value.teams.some(
      (team) => typeof team.id !== 'string' || typeof team.name !== 'string',
    )
  )
    throw new Error('Invalid teams')
  const playerIds = new Set(value.players.map((player) => player.id))
  if (
    playerIds.size !== value.players.length ||
    value.players.some(
      (player) =>
        typeof player.id !== 'string' ||
        typeof player.nickname !== 'string' ||
        !teamIds.has(player.teamId),
    )
  ) {
    throw new Error('Invalid players')
  }
  // Return only public lobby fields, never server credentials or answer keys.
  return {
    sessionId: value.sessionId,
    pin: value.pin,
    status: 'lobby',
    teams: value.teams.map(({ id, name }) => ({ id, name })),
    players: value.players.map(({ id, nickname, teamId }) => ({
      id,
      nickname,
      teamId,
    })),
  }
}

export function applyLobby(session, lobby) {
  if (
    !session ||
    session.lobby.sessionId !== lobby.sessionId ||
    session.lobby.pin !== lobby.pin
  )
    return session
  return lobby.players.some((player) => player.id === session.playerId)
    ? { ...session, lobby }
    : null
}
