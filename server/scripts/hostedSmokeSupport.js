export function parseSmokeOptions(args) {
  let projectRef;
  let hold = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project-ref" && !projectRef) projectRef = args[++i];
    else if (args[i] === "--hold") hold = true;
    else
      throw new Error(
        "Use --project-ref NEW_PROJECT_REF and optionally --hold.",
      );
  }
  if (!/^[a-z]{20}$/.test(projectRef || "")) {
    throw new Error(
      "Provide the new project reference with --project-ref (not an API key).",
    );
  }
  return { projectRef, hold };
}

export function assertSmokeTarget(config, projectRef) {
  if (config.supabaseUrl !== `https://${projectRef}.supabase.co`) {
    throw new Error(
      "Project reference does not match server configuration; no test data was created.",
    );
  }
}

// Only test-owned quiz/user IDs are accepted by callers. Session lookup by the
// test quiz also handles a host_create whose acknowledgement was lost.
export async function cleanupSmokeFixtures(admin, fixtures) {
  let failures = 0;
  const attempt = async (operation) => {
    try {
      if ((await operation()).error) failures++;
    } catch {
      failures++;
    }
  };
  for (const { id, teacherId } of fixtures.quizzes) {
    await attempt(() =>
      admin
        .from("game_sessions")
        .delete()
        .eq("quiz_id", id)
        .eq("host_id", teacherId),
    );
    await attempt(() =>
      admin.from("quizzes").delete().eq("id", id).eq("teacher_id", teacherId),
    );
  }
  for (const id of fixtures.users)
    await attempt(() => admin.auth.admin.deleteUser(id));
  return failures;
}
