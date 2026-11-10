import { readFile, writeFile, readdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const files = (await readdir(new URL("migrations/", root)))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const snapshot =
  "-- Generated from ordered migrations. Apply migrations to existing databases.\n" +
  (
    await Promise.all(
      files.map((f) => readFile(new URL("migrations/" + f, root), "utf8")),
    )
  )
    .map((s) => s.replaceAll("\r\n", "\n").trim())
    .join("\n\n") +
  "\n";
if (process.argv.includes("--write"))
  await writeFile(new URL("schema.sql", root), snapshot);
else if (
  (await readFile(new URL("schema.sql", root), "utf8")).replaceAll(
    "\r\n",
    "\n",
  ) !== snapshot
)
  throw new Error(
    "Schema snapshot is stale. Run npm run schema:write in supabase/.",
  );
else console.log("Schema snapshot matches all ordered migrations.");
