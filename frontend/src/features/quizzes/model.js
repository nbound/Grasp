export const emptyQuestion = () => ({
  prompt: '',
  choices: ['', '', '', ''],
  correct_index: 0,
  explanation: '',
  points: 1000,
  time_limit_seconds: 30,
})
export function validateQuiz(quiz, questions) {
  if (!quiz.title.trim() || quiz.title.length > 200)
    return 'Give your quiz a title of 1–200 characters.'
  if (!questions.length || questions.length > 100)
    return 'Include 1–100 questions.'
  for (const [i, q] of questions.entries()) {
    const prefix = `Question ${i + 1}: `
    if (!q.prompt.trim() || q.prompt.length > 5000)
      return prefix + 'enter a prompt of 1–5000 characters.'
    if (
      q.choices.length !== 4 ||
      q.choices.some((c) => !c.trim() || c.length > 1000)
    )
      return (
        prefix + 'provide four nonempty choices (up to 1000 characters each).'
      )
    if (
      !Number.isInteger(q.correct_index) ||
      q.correct_index < 0 ||
      q.correct_index > 3
    )
      return prefix + 'choose the correct answer.'
    if (q.explanation.length > 5000)
      return prefix + 'shorten the explanation to 5000 characters.'
    if (!Number.isInteger(q.points) || q.points < 0 || q.points > 10000)
      return prefix + 'points must be 0–10000.'
    if (
      q.time_limit_seconds !== null &&
      (!Number.isInteger(q.time_limit_seconds) ||
        q.time_limit_seconds < 5 ||
        q.time_limit_seconds > 600)
    )
      return prefix + 'timer must be 5–600 seconds.'
  }
  return ''
}
