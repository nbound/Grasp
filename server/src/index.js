import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readConfig } from "./config.js";
import { createRepository } from "./repository.js";
import { createApp } from "./app.js";

// Paths are relative to server/, independent of the launch working directory.
// Deployment environment variables take precedence over local files.
for (const name of [".env.local", ".env"]) {
  const path = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}
try {
  const config = readConfig();
  const server = createApp({ config, repository: createRepository(config) });
  server.httpServer.on("error", () => {
    console.error("Unable to listen on the configured port.");
    process.exitCode = 1;
  });
  server.httpServer.listen(config.port, "0.0.0.0", () =>
    console.info(`Grasp server listening on port ${config.port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      const force = setTimeout(() => process.exit(1), 10000);
      force.unref();
      await server.close();
      clearTimeout(force);
    });
} catch {
  // Never print SDK errors, configuration objects, or environment values.
  console.error(
    "Server configuration is invalid. Check server/.env.example and required variables.",
  );
  process.exitCode = 1;
}
