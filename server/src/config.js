function url(value, name, production) {
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (production && parsed.protocol !== "https:")
    )
      throw new Error();
    return parsed;
  } catch {
    throw new Error(
      `${name} must be a valid ${production ? "HTTPS" : "HTTP(S)"} URL`,
    );
  }
}

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT is invalid");
  const supabaseUrl = url(env.SUPABASE_URL, "SUPABASE_URL", production);
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (
    !publishableKey ||
    !secretKey ||
    publishableKey === secretKey ||
    publishableKey.startsWith("sb_secret_")
  ) {
    throw new Error(
      "Set distinct SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY values",
    );
  }
  const origins = (
    env.CLIENT_ORIGINS || (production ? "" : "http://localhost:5173")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const parsed = url(value, "CLIENT_ORIGINS", production);
      if (parsed.pathname !== "/")
        throw new Error("CLIENT_ORIGINS must contain origins without paths");
      return parsed.origin;
    });
  if (!origins.length) throw new Error("CLIENT_ORIGINS is required");
  return {
    port,
    supabaseUrl: supabaseUrl.origin,
    publishableKey,
    secretKey,
    origins,
    teacherSignupCode: env.TEACHER_SIGNUP_CODE,
  };
}
