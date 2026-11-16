import test from "node:test";
import assert from "node:assert/strict";
import { studyStreak } from "../src/study.js";

test("study streak preserves earned rewards after a missed day", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05"];
  assert.deepEqual(studyStreak(days, new Date("2026-11-06T15:00:00Z")), {
    streak: 1,
    longest: 3,
  });
});
