// Dry run by default. Only old anonymous accounts with NO learning history qualify.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { readConfig } from "../src/config.js";
for (const name of [".env.local", ".env"]) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
const config = readConfig(),
  apply = process.argv.includes("--apply");
const project = new URL(config.supabaseUrl).hostname.split(".")[0];
if (apply && !process.argv.includes(`--project=${project}`))
  throw new Error(
    "Applying cleanup requires --project matching the configured project reference.",
  );
const admin = createClient(config.supabaseUrl, config.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cutoff = Date.now() - 30 * 86400000;
let candidates = 0,
  removed = 0;
for (let page = 1; page <= 100; page++) {
  const { data, error } = await admin.auth.admin.listUsers({
    page,
    perPage: 100,
  });
  if (error) throw new Error("Unable to list Auth users.");
  for (const user of data.users) {
    if (!user.is_anonymous || Date.parse(user.created_at) >= cutoff) continue;
    const checks = await Promise.all(
      ["players", "practice_sets"].map((table) =>
        admin
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ),
    );
    if (checks.some((check) => check.error))
      throw new Error(
        "Unable to verify guest history. No deletion attempted for this account.",
      );
    if (checks.some((check) => check.count > 0)) continue;
    candidates++;
    if (apply) {
      const result = await admin.auth.admin.deleteUser(user.id);
      if (result.error) throw new Error("Guest deletion failed.");
      removed++;
    }
  }
  if (data.users.length < 100) break;
}
console.log(
  JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    eligibleOrphans: candidates,
    removed,
  }),
);
