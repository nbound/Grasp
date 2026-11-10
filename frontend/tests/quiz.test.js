import test from 'node:test'
import assert from 'node:assert/strict'
import { validateQuiz, emptyQuestion } from '../src/features/quizzes/model.js'
const question = () => ({
  ...emptyQuestion(),
  prompt: 'A question?',
  choices: ['A', 'B', 'C', 'D'],
})
test('quiz validation accepts fixed-points untimed and timed questions', () => {
  assert.equal(validateQuiz({ title: 'Quiz' }, [question()]), '')
  assert.equal(
    validateQuiz({ title: 'Quiz' }, [
      { ...question(), time_limit_seconds: null, points: 0 },
    ]),
    '',
  )
})
test('quiz validation rejects invalid answers, missing choices, timer bounds and empty drafts', () => {
  for (const questions of [
    [],
    [{ ...question(), correct_index: 4 }],
    [{ ...question(), choices: ['A', '', 'C', 'D'] }],
    [{ ...question(), time_limit_seconds: 1 }],
    [{ ...question(), points: -1 }],
  ])
    assert.ok(validateQuiz({ title: 'Quiz' }, questions))
})
