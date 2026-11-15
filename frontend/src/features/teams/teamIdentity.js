const animals = [
  { name: 'Foxes', symbol: '🦊' },
  { name: 'Owls', symbol: '🦉' },
  { name: 'Wolves', symbol: '🐺' },
  { name: 'Dolphins', symbol: '🐬' },
  { name: 'Tigers', symbol: '🐯' },
  { name: 'Eagles', symbol: '🦅' },
  { name: 'Bears', symbol: '🐻' },
  { name: 'Sharks', symbol: '🦈' },
]

// Give the server's numbered teams a consistent identity, even in existing games.
// Keep custom names intact and use the stable team ID, never scoreboard order.
export function teamIdentity(team) {
  const number = Number(team?.id)
  const index = Number.isInteger(number) && number > 0 ? number - 1 : 0
  const animal = animals[index % animals.length]
  const cycle = Math.floor(index / animals.length)
  return {
    name: /^Team \d+$/.test(team?.name || '')
      ? `${animal.name}${cycle ? ` ${cycle + 1}` : ''}`
      : team?.name || animal.name,
    symbol: animal.symbol,
    color: index % animals.length,
  }
}
