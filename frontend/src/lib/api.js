import { getSupabase } from './supabase.js'
export const serverUrl =
  import.meta.env.VITE_GAME_SERVER_URL || 'http://localhost:3001'
export const errorMessages = {
  FORBIDDEN:
    'This action is not available for your account. Check your teacher invitation or session access.',
  UNAUTHORIZED: 'Please sign in again.',
  VERIFY_EMAIL: 'Confirm your email address before enrolling as a teacher.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
  STALE_VERSION: 'The game changed. Review the latest state and try again.',
  ANSWER_CLOSED: 'Answers are now locked.',
  ALREADY_ANSWERED: 'Your first answer has already been saved.',
  WRONG_QUESTION: 'The game moved to another question.',
  NEED_PLAYERS: 'Join at least one player; a duel needs exactly two.',
  EMPTY_QUIZ: 'Add a question before starting.',
  SESSION_CLOSED: 'This game has expired.',
  BAD_PIN: 'No game found with that PIN.',
  DUPLICATE_NICKNAME: 'That nickname is taken.',
  SESSION_FULL: 'This game is full.',
}
export function readable(error) {
  return (
    errorMessages[error?.code || error?.message] ||
    error?.message ||
    'Something went wrong. Please try again.'
  )
}
export async function api(path, body, { download = false } = {}) {
  const { data, error } = await getSupabase().auth.getSession()
  if (error || !data.session) throw new Error('Please sign in first.')
  const response = await fetch(`${serverUrl}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  if (!response.ok) {
    const failure = await response.json()
    throw new Error(readable(failure.error))
  }
  return download ? response.blob() : response.json()
}
export async function downloadResults(id) {
  const blob = await api(`/sessions/${id}/results.csv`, undefined, {
    download: true,
  })
  const url = URL.createObjectURL(blob),
    link = document.createElement('a')
  link.href = url
  link.download = `grasp-${id}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
