import test from "node:test";
import assert from "node:assert/strict";
import { gameView, csv } from "../src/game/state.js";
const fixture = () => ({
  session: {
    id: "s",
    host_id: "h",
    phase: "question",
    feedback_mode: "end",
    current_question_index: 0,
    game_mode: "team",
  },
  quiz: { title: "Quiz" },
  questions: [
    {
      id: "q",
      prompt: "Question",
      choices: ["A", "B"],
      correct_index: 1,
      explanation: "Because B",
    },
  ],
  players: [
    {
      id: "p",
      user_id: "u",
      nickname: "Student",
      team_number: 1,
      score: 1000,
      streak: 1,
    },
  ],
  teams: [{ team_number: 1, name: "Team 1" }],
  answers: [
    {
      player_id: "p",
      question_id: "q",
      selected_index: 1,
      is_correct: true,
      points_awarded: 1000,
      attempts: 1,
      response_ms: 50,
    },
  ],
});
test("delayed feedback hides keys, outcomes, scores and raw identities from students", () => {
  const d = fixture(),
    s = gameView(d, "u");
  assert.equal(s.feedback, null);
  assert.deepEqual(s.leaderboard, []);
  assert.deepEqual(s.teamScores, []);
  assert.deepEqual(s.results, []);
  assert.equal(s.question.correct_index, undefined);
  assert.equal(s.players[0].user_id, undefined);
  assert.equal(s.answerCount, undefined);
  assert.throws(() => gameView(d, "outsider"), { code: "FORBIDDEN" });
  d.session.phase = "feedback";
  assert.equal(gameView(d, "u").feedback, null);
  d.session.phase = "results";
  assert.equal(gameView(d, "u").results.length, 1);
  assert.equal(gameView(d, "u").feedback.correct, true);
});
test("instant feedback is personal and distributions only appear after locking", () => {
  const d = fixture();
  d.session.feedback_mode = "instant";
  assert.equal(gameView(d, "u").feedback.correct, true);
  assert.equal(gameView(d, "h").distribution, undefined);
  d.players.push({
    id: "p2",
    user_id: "u2",
    nickname: "Other",
    score: 0,
    team_number: 1,
  });
  assert.equal(gameView(d, "u2").feedback, null);
  d.session.phase = "feedback";
  assert.deepEqual(gameView(d, "h").distribution, [0, 1]);
});
test("CSV quotes multiline content and neutralizes spreadsheet formula injection", () => {
  const result = csv([
    {
      name: ' =HYPERLINK("evil")',
      question: 'a,b\n"c"',
      answer: "@SUM(1)",
      points: 1000,
    },
  ]);
  assert.ok(result.startsWith("\ufeff"));
  assert.ok(result.includes('"\' =HYPERLINK(""evil"")"'));
  assert.ok(result.includes('"a,b\n""c"""'));
  assert.ok(result.includes('"\'@SUM(1)"'));
});
