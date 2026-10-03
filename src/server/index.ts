import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { assertAuthMode, config } from "../config.js";
import { recoverInterruptedScans } from "../pipeline/orchestrator.js";
import { registerApiRoutes } from "./routes.js";

const app = Fastify({ logger: { level: "info" } });

// Fail-loud startup guards (PLAN.md §8, §12).
assertAuthMode();
recoverInterruptedScans();

const webDist = join(config.root, "web", "dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      void reply.code(404).send({ error: "not found" });
    } else {
      void reply.sendFile("index.html"); // SPA fallback
    }
  });
} else {
  app.get("/", async () => ({
    status: "UI not built — run `npm run build:web` (or `npm run dev`, which builds it first).",
  }));
}

await app.register(fastifyStatic, {
  root: join(config.dataDir, "images"),
  prefix: "/images/",
  decorateReply: false,
});

await registerApiRoutes(app);

// Localhost only (PLAN.md §12) — WSL2 forwards localhost to Windows Chrome.
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Deployer Intelligence Platform → http://localhost:${config.port}`);
