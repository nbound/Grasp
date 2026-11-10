import { PublicError } from "./errors.js";
import { unwrap } from "./game/repository.js";

export function studyStreak(dates, now = new Date()) {
  const days = new Set(
    dates.map((d) => new Date(d).toISOString().slice(0, 10)),
  );
  const day = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  if (!days.has(day.toISOString().slice(0, 10)))
    day.setUTCDate(day.getUTCDate() - 1);
  let streak = 0;
  while (days.has(day.toISOString().slice(0, 10))) {
    streak++;
    day.setUTCDate(day.getUTCDate() - 1);
  }
  // Longest streak makes an earned cosmetic permanent even after a missed day.
  let longest = 0,
    current = 0,
    previous = 0;
  for (const date of [...days].sort()) {
    const next = Date.parse(date);
    current = next - previous === 86400000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = next;
  }
  return { streak, longest };
}
export function studyRepository(admin) {
  return {
    async study(user) {
      const [games, practice, cosmetics, days] = await Promise.all([
        admin
          .from("answers")
          .select(
            "created_at,is_correct,question_id,selected_index,questions(prompt,choices,correct_index,explanation),players!inner(user_id),game_sessions!inner(status)",
          )
          .eq("players.user_id", user.id)
          .eq("game_sessions.status", "finished")
          .order("created_at", { ascending: false })
          .limit(1000),
        // Preserve historical practice totals; generation and practice routes were removed.
        admin
          .from("practice_answers")
          .select("created_at,is_correct,practice_sets!inner(user_id)")
          .eq("practice_sets.user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1000),
        admin
          .from("cosmetics")
          .select("theme,avatar")
          .eq("user_id", user.id)
          .maybeSingle(),
        admin
          .from("study_days")
          .select("day")
          .eq("user_id", user.id)
          .order("day", { ascending: false })
          .limit(10000),
      ]);
      const gameRows = unwrap(games),
        practiceRows = unwrap(practice),
        rows = [...gameRows, ...practiceRows].sort((a, b) =>
          b.created_at.localeCompare(a.created_at),
        );
      const streak = studyStreak(unwrap(days).map((a) => a.day));
      return {
        ...streak,
        theme: unwrap(cosmetics)?.theme || "forest",
        avatar: cosmetics.data?.avatar || "seed",
        inventory: {
          themes: [
            "forest",
            ...(streak.longest >= 3 ? ["ocean"] : []),
            ...(streak.longest >= 7 ? ["sunset"] : []),
          ],
          avatars: [
            "seed",
            ...(streak.longest >= 3 ? ["leaf"] : []),
            ...(streak.longest >= 7 ? ["tree"] : []),
          ],
        },
        answered: rows.length,
        correct: rows.filter((r) => r.is_correct).length,
        mistakes: gameRows
          .filter((a) => !a.is_correct)
          .slice(0, 10)
          .map((a) => ({
            questionId: a.question_id,
            prompt: a.questions.prompt,
            answer: a.questions.choices[a.selected_index],
            correctAnswer: a.questions.choices[a.questions.correct_index],
            explanation: a.questions.explanation,
          })),
      };
    },
    async setCosmetics(user, values) {
      const study = await this.study(user);
      if (
        !study.inventory.themes.includes(values?.theme) ||
        !study.inventory.avatars.includes(values?.avatar)
      )
        throw new PublicError("FORBIDDEN");
      unwrap(
        await admin.from("cosmetics").upsert({
          user_id: user.id,
          theme: values.theme,
          avatar: values.avatar,
        }),
      );
      return {};
    },
  };
}

export function studyRoutes(app, route, repository) {
  app.get(
    "/api/study",
    route(async (_req, res, user) => res.json(await repository.study(user))),
  );
  app.post(
    "/api/study/cosmetics",
    route(async (req, res, user) =>
      res.json(await repository.setCosmetics(user, req.body)),
    ),
  );
}
