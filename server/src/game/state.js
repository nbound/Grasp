import { PublicError } from "../errors.js";

export function gameView(data, userId, presence = new Set()) {
  if (!data) throw new PublicError("NOT_FOUND");
  const { session: s, quiz, questions, players, teams, answers } = data;
  const host = s.host_id === userId;
  const player = players.find((p) => p.user_id === userId);
  if (!host && !player) throw new PublicError("FORBIDDEN");
  const question = questions[s.current_question_index];
  const own = answers.find(
    (a) => a.player_id === player?.id && a.question_id === question?.id,
  );
  const revealed =
    s.phase === "results" ||
    (s.feedback_mode !== "end" && s.phase === "feedback");
  const feedback = revealed || (s.feedback_mode === "instant" && !!own);
  // Hide totals until reveal too: totals themselves disclose correctness.
  const showScores = host || revealed;
  const currentAnswers = answers.filter((a) => a.question_id === question?.id);
  const leaderboard = showScores
    ? players
        .map((p) => ({
          id: p.id,
          nickname: p.nickname,
          teamId: String(p.team_number),
          score: p.score,
        }))
        .sort(
          (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname),
        )
    : [];
  const ranked = (rows) =>
    rows.map((p, i) => ({
      ...p,
      rank: rows.findIndex((x) => x.score === p.score) + 1,
      order: i,
    }));
  const teamScores = showScores
    ? teams
        .map((t) => ({
          id: String(t.team_number),
          name: t.name,
          score: players
            .filter((p) => p.team_number === t.team_number)
            .reduce((sum, p) => sum + p.score, 0),
        }))
        .sort((a, b) => b.score - a.score)
    : [];
  return {
    version: 1,
    sessionId: s.id,
    pin: s.join_code,
    title: quiz.title,
    phase: s.phase,
    revision: s.revision,
    mode: s.game_mode,
    feedbackMode: s.feedback_mode,
    expiresAt: s.expires_at,
    questionIndex: s.current_question_index,
    questionCount: questions.length,
    serverNow: new Date().toISOString(),
    deadline: s.deadline,
    isHost: host,
    playerId: player?.id,
    teamId: player ? String(player.team_number) : null,
    players: players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      teamId: String(p.team_number),
      connected: presence.has(p.id),
    })),
    teams: teams.map((t) => ({ id: String(t.team_number), name: t.name })),
    question:
      question && s.phase !== "lobby"
        ? {
            id: question.id,
            prompt: question.prompt,
            choices: question.choices,
            points: question.points,
          }
        : null,
    submitted: !!own,
    selectedIndex: own?.selected_index,
    feedback:
      feedback && question
        ? {
            correctIndex: question.correct_index,
            explanation: question.explanation,
            correct: own?.is_correct ?? false,
            points: own?.points_awarded ?? 0,
            streak: player?.streak ?? 0,
          }
        : null,
    answerCount: host ? currentAnswers.length : undefined,
    distribution:
      host && s.phase !== "question" && question
        ? question.choices.map(
            (_, i) =>
              currentAnswers.filter((a) => a.selected_index === i).length,
          )
        : undefined,
    leaderboard: ranked(leaderboard),
    teamScores: ranked(teamScores),
    results:
      s.phase === "results" ? resultRows(data, host ? null : player.id) : [],
  };
}

export function resultRows({ players, questions, answers }, playerId = null) {
  return players
    .filter((p) => !playerId || p.id === playerId)
    .flatMap((p) =>
      questions.map((q) => {
        const a = answers.find(
          (a) => a.player_id === p.id && a.question_id === q.id,
        );
        return {
          playerId: p.id,
          name: p.nickname,
          team: p.team_number,
          questionId: q.id,
          question: q.prompt,
          answer: a ? q.choices[a.selected_index] : "",
          correctAnswer: q.choices[q.correct_index],
          explanation: q.explanation,
          correct: a?.is_correct ?? false,
          attempts: a?.attempts ?? 0,
          responseMs: a?.response_ms ?? null,
          points: a?.points_awarded ?? 0,
        };
      }),
    );
}

export function csv(rows) {
  const columns = [
    "name",
    "team",
    "question",
    "answer",
    "correctAnswer",
    "explanation",
    "correct",
    "attempts",
    "responseMs",
    "points",
  ];
  const cell = (value) => {
    let text = String(value ?? "");
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))
      text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    "\ufeff" +
    [columns, ...rows.map((row) => columns.map((c) => row[c]))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
