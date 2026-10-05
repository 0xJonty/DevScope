import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bands, config, scanDefaults } from "../config.js";
import { db, schema } from "../db/index.js";
import { getAllUsage } from "../providers/quota.js";
import { createScan, estimateScanCost, requestPause, startScan } from "../pipeline/orchestrator.js";
import { scanEvents } from "../pipeline/events.js";
import { STAGE_LABELS, STAGES } from "../pipeline/types.js";
import { THESIS_PROMPT_VERSION } from "../reasoning/prompts/thesis.js";
import { SYNTHESIS_PROMPT_VERSION } from "../reasoning/prompts/synthesis.js";
import type { ScanEvent, StageState } from "../pipeline/types.js";

const newScanBody = z.object({
  wallet: z.string().min(32).max(50),
  alias: z.string().max(60).nullish(),
  windowN: z.number().int().min(10).max(scanDefaults.window_max).optional(),
  pinnedMints: z.array(z.string()).max(5).optional(),
});

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // ── Scans ──────────────────────────────────────────────────────────────
  app.post("/api/scans", async (req, reply) => {
    const parsed = newScanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const { wallet, alias, windowN, pinnedMints } = parsed.data;
    const estimate = estimateScanCost(wallet, windowN ?? scanDefaults.window_n);
    const scanId = createScan({ wallet, alias: alias ?? null, windowN, pinnedMints });
    return { scanId, estimate, quota: getAllUsage() };
  });

  app.post("/api/scans/:id/start", async (req) => {
    startScan((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post("/api/scans/:id/pause", async (req) => {
    requestPause((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/scans", async () => {
    return db.select().from(schema.scans).orderBy(desc(schema.scans.startedAt)).limit(30).all();
  });

  app.get("/api/scans/:id", async (req, reply) => {
    const scan = db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.id, (req.params as { id: string }).id))
      .get();
    if (!scan) return reply.code(404).send({ error: "scan not found" });
    const stageState = (scan.stageState ?? {}) as Record<string, StageState>;
    return {
      ...scan,
      stages: STAGES.map((s) => ({
        id: s,
        label: STAGE_LABELS[s],
        status: stageState[s]?.status ?? "pending",
      })),
    };
  });

  // SSE progress stream (PLAN.md §10): replays buffered events, then live.
  app.get("/api/scans/:id/events", (req, reply) => {
    const scanId = (req.params as { id: string }).id;
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (ev: ScanEvent) => reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    for (const ev of scanEvents.replay(scanId)) send(ev);
    const listener = (ev: ScanEvent) => send(ev);
    scanEvents.on(`scan:${scanId}`, listener);
    const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      scanEvents.off(`scan:${scanId}`, listener);
    });
  });

  app.get("/api/estimate", async (req) => {
    const q = req.query as { wallet?: string; window?: string };
    const windowN = q.window ? Number(q.window) : scanDefaults.window_n;
    return {
      estimate: q.wallet ? estimateScanCost(q.wallet, windowN) : null,
      quota: getAllUsage(),
    };
  });

  // ── Library / profiles ─────────────────────────────────────────────────
  app.get("/api/library", async () => {
    const rows = db.select().from(schema.profiles).orderBy(desc(schema.profiles.updatedAt)).all();
    return rows.map((p) => {
      const d = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, p.wallet)).get();
      const tokens = db.select().from(schema.tokens).where(eq(schema.tokens.wallet, p.wallet)).all();
      const bonded = tokens.filter((t) => t.bonded).length;
      const bestAth = tokens.reduce<number | null>((best, t) => (t.athUsd != null && (best == null || t.athUsd > best) ? t.athUsd : best), null);
      return {
        wallet: p.wallet,
        name: d?.name ?? null,
        verdictSnippet: p.verdictSnippet,
        updatedAt: p.updatedAt,
        bondRate: tokens.length ? bonded / tokens.length : null,
        bestAthUsd: bestAth,
        tokenCount: tokens.length,
        lifetimeDeploys: d?.lifetimeDeploys ?? null,
      };
    });
  });

  app.get("/api/profiles/:wallet", async (req, reply) => {
    const wallet = (req.params as { wallet: string }).wallet;
    const p = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, wallet)).get();
    if (!p || !existsSync(p.filePath)) return reply.code(404).send({ error: "no profile for this wallet yet" });
    const d = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, wallet)).get();
    return { wallet, name: d?.name ?? null, markdown: readFileSync(p.filePath, "utf8"), filePath: p.filePath, updatedAt: p.updatedAt };
  });

  // Structured profile: DB-backed data for purpose-built UI rendering; the
  // markdown file stays the source of truth for prose sections.
  app.get("/api/profiles/:wallet/structured", async (req, reply) => {
    const wallet = (req.params as { wallet: string }).wallet;
    const p = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, wallet)).get();
    if (!p || !existsSync(p.filePath)) return reply.code(404).send({ error: "no profile for this wallet yet" });
    const d = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, wallet)).get();
    const doneScans = db
      .select()
      .from(schema.scans)
      .where(eq(schema.scans.wallet, wallet))
      .orderBy(desc(schema.scans.startedAt))
      .all()
      .filter((s) => s.status === "done");
    // Prefer the newest scan that actually produced theses (a data-only
    // --through run has a selection but no Layer B output).
    const scan =
      doneScans.find((s) => db.select().from(schema.theses).where(eq(schema.theses.scanId, s.id)).all().length > 0) ??
      doneScans[0];

    const md = readFileSync(p.filePath, "utf8");
    const section = (title: string) => {
      const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // No multiline flag: `$` must mean end-of-file, not end-of-line, or the
      // lazy capture stops at the first blank line.
      const m = md.match(new RegExp(`(?:^|\\n)# ${esc}\\n([\\s\\S]*?)(?=\\n# |$)`));
      return m ? m[1]!.trim() : null;
    };

    const stageState = (scan?.stageState ?? {}) as Record<string, Record<string, unknown>>;
    const selection = (stageState.s3?.selection ?? []) as Array<{ mint: string; reason: string; classification: string }>;
    const thesisRows = scan
      ? db.select().from(schema.theses).where(eq(schema.theses.scanId, scan.id)).all()
      : [];
    const tokenRows = new Map(
      db.select().from(schema.tokens).where(eq(schema.tokens.wallet, wallet)).all().map((t) => [t.mint, t])
    );

    const theses = selection
      .map((entry) => {
        const token = tokenRows.get(entry.mint);
        const thesis = thesisRows.find((t) => t.mint === entry.mint);
        if (!token) return null;
        return {
          mint: entry.mint,
          name: token.name,
          ticker: token.ticker,
          bonded: token.bonded,
          athUsd: token.athUsd,
          createdAt: token.createdAt,
          imageUrl: token.imagePath ? `/images/${token.imagePath.split("/").pop()}` : null,
          classification: entry.classification,
          reason: entry.reason,
          thesis: thesis?.json ?? null,
        };
      })
      .filter((x) => x !== null);

    return {
      wallet,
      name: d?.name ?? null,
      updatedAt: p.updatedAt,
      scan: scan
        ? {
            windowN: scan.windowN,
            from: scan.windowFrom,
            to: scan.windowTo,
            finishedAt: scan.finishedAt,
            quotaSpent: scan.quotaSpent ?? {},
          }
        : null,
      lifetime: {
        deploys: d?.lifetimeDeploys ?? null,
        graduated: d?.lifetimeGraduated ?? null,
        bestAthUsd: d?.lifetimeBestAthUsd ?? null,
        bestMint: d?.lifetimeBestMint ?? null,
      },
      fingerprint: stageState.s2?.fingerprint ?? null,
      sections: {
        verdict: section("Verdict"),
        works: section("What works for them"),
        fails: section("What fails for them"),
        playbook: section("Playbook signals"),
        questions: section("Low-confidence notes / open questions"),
      },
      theses,
    };
  });

  app.post("/api/profiles/:wallet/rename", async (req, reply) => {
    const wallet = (req.params as { wallet: string }).wallet;
    const body = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const p = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, wallet)).get();
    if (!p) return reply.code(404).send({ error: "no profile" });
    // Renaming a deployer renames the file; wallet in frontmatter stays the key (PLAN.md §9.2).
    const newPath = join(config.profilesDir, `${body.data.name.replace(/[^a-zA-Z0-9_-]/g, "_")}-PROFILE.md`);
    if (existsSync(p.filePath) && p.filePath !== newPath) renameSync(p.filePath, newPath);
    db.update(schema.profiles).set({ filePath: newPath }).where(eq(schema.profiles.wallet, wallet)).run();
    db.update(schema.deployers).set({ name: body.data.name }).where(eq(schema.deployers.wallet, wallet)).run();
    return { ok: true, filePath: newPath };
  });

  // ── Settings / quota ───────────────────────────────────────────────────
  app.get("/api/quota", async () => getAllUsage());

  app.get("/api/settings", async () => ({
    authMode: config.authMode,
    scanDefaults,
    bands: { bands_version: bands.bands_version, mid_min_ath_usd: bands.mid_min_ath_usd },
    promptVersions: { thesis: THESIS_PROMPT_VERSION, synthesis: SYNTHESIS_PROMPT_VERSION },
    quota: getAllUsage(),
  }));

  app.put("/api/settings/bands", async (req, reply) => {
    const body = z.object({ mid_min_ath_usd: z.number().positive() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: body.error.message });
    const path = resolve(config.root, "config/bands.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    const [maj, min, patch] = String(file.bands_version).split(".").map(Number);
    file.bands_version = `${maj}.${min}.${(patch ?? 0) + 1}`;
    file.mid_min_ath_usd = body.data.mid_min_ath_usd;
    file.rules.mid = "!bonded && ath_usd > mid_min_ath_usd";
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    // Keep the running process consistent with the file.
    (bands as { mid_min_ath_usd: number }).mid_min_ath_usd = body.data.mid_min_ath_usd;
    (bands as { bands_version: string }).bands_version = file.bands_version;
    return { ok: true, bands_version: file.bands_version };
  });
}
