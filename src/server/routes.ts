import { readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FastifyReply, FastifyRequest, FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  BAND_DEFAULTS,
  bands,
  config,
  deployConfig,
  filters,
  narrativeConfig,
  scanDefaults,
} from "../config.js";
import {
  ALLOWED_IMAGE_MIMES,
  createDeployment,
  deployedByNarrativeToken,
  deploymentInFlight,
  estimateDeployCost,
  getDeployment,
  listDeployments,
  reconcileDeployment,
  startDeployment,
} from "../deploy/pipeline.js";
import {
  hasWallets,
  importWallet,
  removeWallet,
  setMainWallet,
  walletStatuses,
} from "../deploy/wallets.js";
import {
  clearPumpSession,
  getPumpSession,
  getSupportedQuotes,
  searchCharities,
  setPumpSession,
} from "../deploy/pump-extras.js";
import { getConnection } from "../deploy/solana.js";
import { ensureVanityPool, getVanityState } from "../deploy/vanity.js";
import { db, schema } from "../db/index.js";
import { getAllUsage } from "../providers/quota.js";
import { createScan, estimateScanCost, requestPause, startScan } from "../pipeline/orchestrator.js";
import { createTokenScan, estimateTokenScanCost, startTokenScan } from "../pipeline/token-scan.js";
import {
  createVampScan,
  estimateVampScanCost,
  getVampState,
  startVampScan,
} from "../pipeline/vamp-scan.js";
import {
  createNarrativeScan,
  getNarrativeScan,
  startNarrativeScan,
} from "../pipeline/narrative-scan.js";
import {
  createMimicStudy,
  estimateMimicCost,
  getMimicStudy,
  listMimicStudies,
  mimicStudyInFlight,
  startMimicStudy,
} from "../pipeline/mimic-scan.js";
import { grokAccount, grokLoggedIn, grokLogout, startGrokDeviceLogin } from "../providers/grok.js";
import { scanEvents } from "../pipeline/events.js";
import { classify } from "../pipeline/s2-score.js";
import { STAGE_LABELS, STAGES } from "../pipeline/types.js";
import { THESIS_PROMPT_VERSION } from "../reasoning/prompts/thesis.js";
import { SYNTHESIS_PROMPT_VERSION } from "../reasoning/prompts/synthesis.js";
import { VAMP_PROMPT_VERSION } from "../reasoning/prompts/vamp.js";
import { NARRATIVE_PROMPT_VERSION } from "../reasoning/prompts/narrative.js";
import { MIMIC_PROMPT_VERSION } from "../reasoning/prompts/mimic.js";
import type { ScanEvent, StageState } from "../pipeline/types.js";

// Base58 Solana address (no 0, O, I, l), 32–44 chars.
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const walletField = z.string().trim().regex(BASE58, "not a valid Solana wallet address (base58, 32–44 chars)");
const mintField = z.string().trim().regex(BASE58, "not a valid token mint address (base58, 32–44 chars)");

/** Flatten a zod error into one short human-readable line for UI display. */
const zodMsg = (err: z.ZodError): string =>
  err.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");

const newScanBody = z.object({
  wallet: walletField,
  alias: z.string().max(60, "name must be 60 characters or fewer").nullish(),
  windowN: z
    .number()
    .int()
    .min(10, "window must be at least 10 deploys")
    .max(scanDefaults.window_max, `window must be at most ${scanDefaults.window_max} deploys`)
    .optional(),
  pinnedMints: z.array(mintField).max(5, "at most 5 pinned mints").optional(),
});

const newTokenScanBody = z.object({ mint: mintField, vamp: z.boolean().optional() });

const newVampScanBody = z.object({
  mint: mintField,
  triggerScanId: z.string().nullish(),
});

const tokenImageUrl = (t: { imagePath: string | null; imageUri: string | null }): string | null =>
  t.imagePath ? `/images/${t.imagePath.split("/").pop()}` : t.imageUri;

/** SSE progress stream (PLAN.md §10): replays buffered events, then live.
 * Shared by deployer scans and token scans — both publish to the same bus. */
function sseEvents(req: FastifyRequest, reply: FastifyReply): void {
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
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // ── Scans ──────────────────────────────────────────────────────────────
  app.post("/api/scans", async (req, reply) => {
    const parsed = newScanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
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

  app.get("/api/scans/:id/events", sseEvents);

  app.get("/api/estimate", async (req) => {
    const q = req.query as { wallet?: string; window?: string };
    const windowN = q.window ? Number(q.window) : scanDefaults.window_n;
    return {
      estimate: q.wallet ? estimateScanCost(q.wallet, windowN) : null,
      quota: getAllUsage(),
    };
  });

  // ── Token scans (single-contract research scans) ──────────────────────
  app.post("/api/token-scans", async (req, reply) => {
    const parsed = newTokenScanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    const mint = parsed.data.mint.trim();
    const scanId = createTokenScan(mint, parsed.data.vamp ?? false);
    const estimate = estimateTokenScanCost(mint);
    if (parsed.data.vamp) {
      // Fold the chained vamp scan's cost into the pre-flight numbers.
      for (const [p, e] of Object.entries(estimateVampScanCost())) {
        if (e.estimated === 0) continue;
        const existing = estimate[p];
        estimate[p] = existing
          ? { estimated: existing.estimated + e.estimated, note: `${existing.note}; vamp: ${e.note}` }
          : { estimated: e.estimated, note: `vamp: ${e.note}` };
      }
    }
    return { scanId, estimate, quota: getAllUsage() };
  });

  app.post("/api/token-scans/:id/start", async (req) => {
    startTokenScan((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/token-scans/estimate", async (req) => {
    const q = req.query as { mint?: string };
    return { estimate: q.mint ? estimateTokenScanCost(q.mint) : null, quota: getAllUsage() };
  });

  app.get("/api/token-scans", async () => {
    const scans = db.select().from(schema.tokenScans).orderBy(desc(schema.tokenScans.startedAt)).limit(30).all();
    return scans.map((s) => {
      const t = db.select().from(schema.tokens).where(eq(schema.tokens.mint, s.mint)).get();
      return {
        ...s,
        name: t?.name ?? null,
        ticker: t?.ticker ?? null,
        imageUrl: t ? tokenImageUrl(t) : null,
      };
    });
  });

  app.get("/api/token-scans/:id", async (req, reply) => {
    const scan = db
      .select()
      .from(schema.tokenScans)
      .where(eq(schema.tokenScans.id, (req.params as { id: string }).id))
      .get();
    if (!scan) return reply.code(404).send({ error: "token scan not found" });
    const t = db.select().from(schema.tokens).where(eq(schema.tokens.mint, scan.mint)).get();
    return { ...scan, name: t?.name ?? null, ticker: t?.ticker ?? null, imageUrl: t ? tokenImageUrl(t) : null };
  });

  app.get("/api/token-scans/:id/events", sseEvents);

  // ── Vamp scans (opt-in PvP analysis, PLAN.md §7c) ─────────────────────
  app.post("/api/vamp-scans", async (req, reply) => {
    const parsed = newVampScanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    const mint = parsed.data.mint.trim();
    const scanId = createVampScan(mint, parsed.data.triggerScanId ?? null);
    return { scanId, estimate: estimateVampScanCost(), quota: getAllUsage() };
  });

  app.post("/api/vamp-scans/:id/start", async (req) => {
    startVampScan((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/vamp-scans/estimate", async () => ({ estimate: estimateVampScanCost(), quota: getAllUsage() }));

  app.get("/api/vamp-scans/:id", async (req, reply) => {
    const scan = db
      .select()
      .from(schema.vampScans)
      .where(eq(schema.vampScans.id, (req.params as { id: string }).id))
      .get();
    if (!scan) return reply.code(404).send({ error: "vamp scan not found" });
    return scan;
  });

  app.get("/api/vamp-scans/:id/events", sseEvents);

  /** Latest vamp scan + verdict for a mint — token pages render this.
   * Counterparts are shortlist mints (pipeline-enforced), so the response
   * enriches each with ticker + image from the scan's shortlist snapshot —
   * the stored verdict itself stays lean. */
  app.get("/api/vamp/:mint", async (req) => {
    const state = getVampState((req.params as { mint: string }).mint);
    const shortlist = state.scan?.shortlist;
    const counterparts = state.verdict?.counterparts;
    if (shortlist && Array.isArray(counterparts)) {
      for (const c of counterparts as Array<{ mint?: string; ticker?: string; imageUrl?: string | null }>) {
        const entry = shortlist.find((s) => s.mint === c.mint);
        if (entry) {
          c.ticker = entry.ticker;
          c.imageUrl = tokenImageUrl(entry);
        }
      }
    }
    return state;
  });

  // ── Narrative X Scans (Grok live-X trend research, PLAN.md §7d) ───────
  const newNarrativeScanBody = z.object({
    prompt: z.string().trim().max(500, "prompt must be 500 characters or fewer"),
    windowDays: z
      .number()
      .int()
      .min(1, "window must be at least 1 day")
      .max(narrativeConfig.window_days_max, `window must be at most ${narrativeConfig.window_days_max} days`),
    relatedTweets: z
      .number()
      .int()
      .min(1, "related tweets must be at least 1")
      .max(narrativeConfig.related_tweets_max, `related tweets must be at most ${narrativeConfig.related_tweets_max}`)
      .default(narrativeConfig.related_tweets_default),
  });

  app.post("/api/narrative-scans", async (req, reply) => {
    const parsed = newNarrativeScanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    const scanId = createNarrativeScan(parsed.data.prompt, parsed.data.windowDays, parsed.data.relatedTweets);
    return { scanId };
  });

  app.post("/api/narrative-scans/:id/start", async (req) => {
    startNarrativeScan((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/narrative-scans", async () => {
    const rows = db
      .select()
      .from(schema.narrativeScans)
      .orderBy(desc(schema.narrativeScans.startedAt))
      .limit(30)
      .all();
    // List stays lean: narrative count instead of the full report payload.
    return rows.map(({ grokRaw, narratives, ...rest }) => ({
      ...rest,
      narrativeCount: Array.isArray((narratives as { narratives?: unknown[] } | null)?.narratives)
        ? (narratives as { narratives: unknown[] }).narratives.length
        : null,
    }));
  });

  app.get("/api/narrative-scans/:id", async (req, reply) => {
    try {
      return getNarrativeScan((req.params as { id: string }).id);
    } catch {
      return reply.code(404).send({ error: "narrative scan not found" });
    }
  });

  app.get("/api/narrative-scans/:id/events", sseEvents);

  // ── Narrative tokens (one tokenable narrative = one page) ─────────────
  /** Card shape for the Narratives library + scan results — lean, no posts. */
  const narrativeTokenCard = (row: typeof schema.narrativeTokens.$inferSelect) => {
    const n = row.json as Record<string, unknown>;
    return {
      id: row.id,
      scanId: row.scanId,
      createdAt: row.createdAt,
      rank: row.rank,
      imagePath: row.imagePath,
      title: n.title ?? null,
      ticker: n.ticker ?? null,
      tokenName: n.token_name ?? null,
      category: n.category ?? null,
      momentum: n.momentum ?? null,
      confidence: n.confidence ?? null,
      feeType: n.fee_type ?? null,
    };
  };

  app.get("/api/narrative-tokens", async (req) => {
    const q = req.query as { scan?: string };
    const rows = q.scan
      ? db
          .select()
          .from(schema.narrativeTokens)
          .where(eq(schema.narrativeTokens.scanId, q.scan))
          .orderBy(schema.narrativeTokens.rank)
          .all()
      : db
          .select()
          .from(schema.narrativeTokens)
          .orderBy(desc(schema.narrativeTokens.createdAt), schema.narrativeTokens.rank)
          .limit(200)
          .all();
    const deployed = deployedByNarrativeToken(rows.map((r) => r.id));
    return rows.map((r) => ({ ...narrativeTokenCard(r), deployed: deployed.get(r.id) ?? null }));
  });

  app.get("/api/narrative-tokens/:id", async (req, reply) => {
    const row = db
      .select()
      .from(schema.narrativeTokens)
      .where(eq(schema.narrativeTokens.id, (req.params as { id: string }).id))
      .get();
    if (!row) return reply.code(404).send({ error: "narrative token not found" });
    const scan = db
      .select()
      .from(schema.narrativeScans)
      .where(eq(schema.narrativeScans.id, row.scanId))
      .get();
    return {
      id: row.id,
      scanId: row.scanId,
      createdAt: row.createdAt,
      rank: row.rank,
      imagePath: row.imagePath,
      narrative: row.json,
      deployed: deployedByNarrativeToken([row.id]).get(row.id) ?? null,
      scan: scan
        ? {
            prompt: scan.prompt,
            windowDays: scan.windowDays,
            relatedTweets: scan.relatedTweets,
            grokModel: scan.grokModel,
            promptVersion: scan.promptVersion,
            finishedAt: scan.finishedAt,
          }
        : null,
    };
  });

  // ── Token deploys (PLAN.md §7e — pure Layer A) ─────────────────────────
  await app.register(fastifyMultipart, {
    limits: { fileSize: deployConfig.image_max_bytes, files: 1 },
  });

  const optionalUrl = z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().url("must be a full URL").max(200).optional()
  );

  const deployBody = z.object({
    name: z.string().trim().min(1, "name required").max(32, "name must be ≤32 chars"),
    ticker: z
      .string()
      .trim()
      .transform((s) => s.replace(/^\$/, "").toUpperCase())
      .pipe(z.string().min(1, "ticker required").max(10, "ticker must be ≤10 chars")),
    description: z.string().trim().max(1000, "description must be ≤1000 chars").default(""),
    twitter: optionalUrl,
    telegram: optionalUrl,
    website: optionalUrl,
    devBuySol: z
      .number()
      .min(0)
      .max(deployConfig.dev_buy_sol_max, `dev buy capped at ${deployConfig.dev_buy_sol_max} SOL`)
      .default(0),
    holderReward: z.boolean().default(false),
    quoteMint: z.string().trim().regex(BASE58, "not a valid mint").nullish(),
    charities: z
      .array(
        z.object({
          id: z.string().min(8).max(64),
          name: z.string().min(1).max(120),
          shareBps: z.number().int().min(1).max(10000),
        })
      )
      .max(5, "at most 5 charities")
      .default([]),
    vanity: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    narrativeTokenId: z.string().nullish(),
    walletPubkey: walletField.nullish(),
  });

  app.get("/api/deployer", async (_req, reply) => {
    ensureVanityPool();
    try {
      const wallets = hasWallets() ? await walletStatuses(getConnection()) : [];
      return { wallets, vanity: getVanityState() };
    } catch (err) {
      return reply
        .code(502)
        .send({ error: `RPC unreachable: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  const importWalletBody = z.object({
    name: z.string().trim().max(40).default(""),
    secret: z.string().trim().min(32, "paste the wallet's private key (base58 or 64-byte JSON array)"),
  });

  app.post("/api/wallets", async (req, reply) => {
    const parsed = importWalletBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    try {
      return importWallet(parsed.data.name, parsed.data.secret);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/wallets/main", async (req, reply) => {
    const parsed = z.object({ pubkey: walletField }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    try {
      setMainWallet(parsed.data.pubkey);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete("/api/wallets/:pubkey", async (req, reply) => {
    try {
      removeWallet((req.params as { pubkey: string }).pubkey);
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/deploy/estimate", async (req, reply) => {
    const q = req.query as { devBuySol?: string; wallet?: string; charity?: string; quote?: string };
    const devBuySol = Number(q.devBuySol ?? 0);
    if (!Number.isFinite(devBuySol) || devBuySol < 0) {
      return reply.code(400).send({ error: "devBuySol must be a non-negative number" });
    }
    try {
      return await estimateDeployCost(
        devBuySol,
        deployConfig.priority_fee_sol,
        q.wallet || null,
        q.charity === "1",
        q.quote !== "token"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(msg.includes("wallet") ? 400 : 502).send({ error: msg });
    }
  });

  app.get("/api/deploy/quotes", async (_req, reply) => {
    try {
      // Pump-coin quotes need extra plumbing (pumpQuote accounts) — not offered yet.
      return (await getSupportedQuotes()).filter((q) => q.source !== "pumpCoin");
    } catch (err) {
      return reply
        .code(502)
        .send({ error: `quote lookup failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  app.get("/api/deploy/charities", async (req, reply) => {
    const term = ((req.query as { term?: string }).term ?? "").trim();
    if (term.length < 2) return [];
    try {
      return await searchCharities(term);
    } catch (err) {
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/pump-session", async () => ({ set: getPumpSession() !== null }));

  app.post("/api/pump-session", async (req, reply) => {
    const parsed = z
      .object({ cookie: z.string().trim().min(16, "paste the full Cookie header value") })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    setPumpSession(parsed.data.cookie);
    return { ok: true };
  });

  app.delete("/api/pump-session", async () => {
    clearPumpSession();
    return { ok: true };
  });

  app.post("/api/deployments", async (req, reply) => {
    if (deploymentInFlight()) {
      return reply.code(409).send({ error: "a deploy is already in flight — wait for it to finish" });
    }
    let payloadRaw: string | null = null;
    let image: { data: Buffer; mimeType: string } | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "image") {
            await part.toBuffer(); // drain unexpected files
            continue;
          }
          if (!ALLOWED_IMAGE_MIMES.includes(part.mimetype)) {
            return reply
              .code(400)
              .send({ error: `image must be one of: ${ALLOWED_IMAGE_MIMES.join(", ")}` });
          }
          image = { data: await part.toBuffer(), mimeType: part.mimetype };
        } else if (part.fieldname === "payload") {
          payloadRaw = part.value as string;
        }
      }
    } catch (err) {
      return reply.code(400).send({
        error: `upload failed (image over ${Math.round(deployConfig.image_max_bytes / 1024 / 1024)}MB?): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (!payloadRaw) return reply.code(400).send({ error: "missing payload field" });

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(payloadRaw);
    } catch {
      return reply.code(400).send({ error: "payload is not valid JSON" });
    }
    const parsed = deployBody.safeParse(payloadJson);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    const body = parsed.data;

    if (body.charities.length > 0) {
      if (body.holderReward) {
        return reply.code(400).send({
          error: "holder rewards and charity fees are mutually exclusive — a holder-rewards coin's fees all go to holders",
        });
      }
      const totalBps = body.charities.reduce((acc, c) => acc + c.shareBps, 0);
      if (totalBps > 10000) {
        return reply.code(400).send({ error: "charity shares exceed 100%" });
      }
      if (!body.dryRun && getPumpSession() === null) {
        return reply.code(400).send({
          error: "charity deploys need a pump.fun session — paste your pump.fun cookie in Settings → Wallets",
        });
      }
    }

    if (!body.dryRun) {
      const estimate = await estimateDeployCost(
        body.devBuySol,
        deployConfig.priority_fee_sol,
        body.walletPubkey,
        body.charities.length > 0,
        !body.quoteMint
      );
      if (!estimate.sufficient) {
        return reply.code(400).send({
          error: `underfunded: deploy needs ~${estimate.totalSol.toFixed(4)} SOL, deployer holds ${estimate.balanceSol.toFixed(4)} SOL`,
        });
      }
    }

    try {
      const deploymentId = createDeployment({
        params: {
          name: body.name,
          ticker: body.ticker,
          description: body.description,
          walletPubkey: body.walletPubkey ?? undefined,
          twitter: body.twitter,
          telegram: body.telegram,
          website: body.website,
          devBuySol: body.devBuySol,
          slippageBps: body.quoteMint
            ? deployConfig.create_slippage_bps.token
            : deployConfig.create_slippage_bps.sol,
          priorityFeeSol: deployConfig.priority_fee_sol,
          holderReward: body.holderReward,
          quoteMint: body.quoteMint ?? null,
          charities: body.charities,
          dryRun: body.dryRun,
        },
        vanity: body.vanity,
        narrativeTokenId: body.narrativeTokenId ?? null,
        image,
      });
      startDeployment(deploymentId);
      return { deploymentId };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const deploymentRow = (row: ReturnType<typeof getDeployment>) => ({
    id: row.id,
    mint: row.mint,
    narrativeTokenId: row.narrativeTokenId,
    status: row.status,
    statusReason: row.statusReason,
    name: row.params.name,
    ticker: row.params.ticker,
    walletPubkey: row.params.walletPubkey ?? null,
    devBuySol: row.params.devBuySol,
    dryRun: row.params.dryRun,
    quoteMint: row.params.quoteMint ?? null,
    charities: row.params.charities ?? [],
    holderReward: row.params.holderReward,
    metadataUri: row.metadataUri,
    imageUrl: row.imagePath ? `/images/${row.imagePath.split("/").pop()}` : null,
    signature: row.signature,
    feeShareSignature: row.feeShareSignature,
    vanity: row.vanity,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  });

  app.get("/api/deployments", async () => listDeployments().map(deploymentRow));

  app.get("/api/deployments/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      let row = getDeployment(id);
      if (row.status === "confirming" || row.status === "sending") {
        await reconcileDeployment(id).catch(() => {});
        row = getDeployment(id);
      }
      return deploymentRow(row);
    } catch {
      return reply.code(404).send({ error: "deployment not found" });
    }
  });

  app.get("/api/deployments/:id/events", sseEvents);

  // ── Grok auth (subscription OAuth for Narrative X Scans) ──────────────
  let grokLoginError: string | null = null;
  let grokLoginPending = false;

  app.get("/api/grok/status", async () => {
    const subscription = config.grokAuthMode === "subscription";
    return {
      authMode: config.grokAuthMode,
      loggedIn: subscription ? grokLoggedIn() : Boolean(process.env.XAI_API_KEY),
      // Userinfo is fetched once post-login and cached on the token store.
      account: subscription ? await grokAccount() : null,
      loginPending: grokLoginPending,
      loginError: grokLoginError,
      model: narrativeConfig.grok.model,
      windowDaysDefault: narrativeConfig.window_days_default,
      windowDaysMax: narrativeConfig.window_days_max,
      relatedTweetsDefault: narrativeConfig.related_tweets_default,
      relatedTweetsMax: narrativeConfig.related_tweets_max,
    };
  });

  app.post("/api/grok/login", async (_req, reply) => {
    if (config.grokAuthMode === "api_key") {
      return reply.code(400).send({ error: "GROK_AUTH_MODE=api_key — no OAuth login needed" });
    }
    try {
      const login = await startGrokDeviceLogin();
      grokLoginPending = true;
      grokLoginError = null;
      // Poll runs server-side; the UI watches /api/grok/status.
      login.done
        .then(() => {
          grokLoginPending = false;
        })
        .catch((err) => {
          grokLoginPending = false;
          grokLoginError = err instanceof Error ? err.message : String(err);
        });
      return {
        userCode: login.userCode,
        verificationUri: login.verificationUri,
        expiresInSeconds: login.expiresInSeconds,
      };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/grok/logout", async () => {
    grokLogout();
    grokLoginError = null;
    return { ok: true };
  });

  // ── Dev-scan token page (bat button target, PLAN.md §10) ─────────────
  // Token data + latest thesis for a dossier token, scoped under its
  // deployer profile — deliberately NOT a Token Library entry.
  app.get("/api/dev-tokens/:mint", async (req, reply) => {
    const mint = (req.params as { mint: string }).mint;
    const t = db.select().from(schema.tokens).where(eq(schema.tokens.mint, mint)).get();
    if (!t) return reply.code(404).send({ error: "token not cached" });
    const d = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, t.wallet)).get();
    const thesisRow = db
      .select()
      .from(schema.theses)
      .where(eq(schema.theses.mint, mint))
      .all()
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return {
      mint,
      name: t.name,
      ticker: t.ticker,
      description: t.description,
      socials: t.socials ?? {},
      wallet: t.wallet,
      walletName: d?.name ?? null,
      bonded: t.bonded,
      athUsd: t.athUsd,
      athAt: t.athAt,
      createdAt: t.createdAt,
      imageUrl: tokenImageUrl(t),
      classification: classify(t.bonded, t.athUsd),
      curveStats: t.curveStats ?? null,
      replyCount: t.replyCount,
      promptVersion: thesisRow?.promptVersion ?? null,
      thesis: thesisRow?.json ?? null,
    };
  });

  // ── Token library ──────────────────────────────────────────────────────
  // Only tokens researched via Token Scan appear here (latest done scan per
  // mint); deployer-scan dossiers never leak in and vice versa.
  app.get("/api/token-library", async () => {
    const scans = db
      .select()
      .from(schema.tokenScans)
      .where(eq(schema.tokenScans.status, "done"))
      .orderBy(desc(schema.tokenScans.startedAt))
      .all();
    const seen = new Set<string>();
    const out = [];
    for (const s of scans) {
      if (seen.has(s.mint)) continue;
      seen.add(s.mint);
      const t = db.select().from(schema.tokens).where(eq(schema.tokens.mint, s.mint)).get();
      if (!t) continue;
      out.push({
        mint: s.mint,
        name: t.name,
        ticker: t.ticker,
        imageUrl: tokenImageUrl(t),
        wallet: t.wallet,
        bonded: t.bonded,
        athUsd: t.athUsd,
        createdAt: t.createdAt,
        classification: classify(t.bonded, t.athUsd),
        scannedAt: s.finishedAt ?? s.startedAt,
        scanId: s.id,
      });
    }
    return out;
  });

  app.get("/api/token-library/:mint", async (req, reply) => {
    const mint = (req.params as { mint: string }).mint;
    const scan = db
      .select()
      .from(schema.tokenScans)
      .where(and(eq(schema.tokenScans.mint, mint), eq(schema.tokenScans.status, "done")))
      .orderBy(desc(schema.tokenScans.startedAt))
      .get();
    if (!scan) return reply.code(404).send({ error: "no completed token scan for this mint yet" });
    const t = db.select().from(schema.tokens).where(eq(schema.tokens.mint, mint)).get();
    if (!t) return reply.code(404).send({ error: "token not cached" });
    const thesisRow = db
      .select()
      .from(schema.theses)
      .where(and(eq(schema.theses.mint, mint), eq(schema.theses.scanId, scan.id)))
      .get();
    return {
      mint,
      name: t.name,
      ticker: t.ticker,
      description: t.description,
      socials: t.socials ?? {},
      wallet: t.wallet,
      bonded: t.bonded,
      athUsd: t.athUsd,
      athAt: t.athAt,
      createdAt: t.createdAt,
      imageUrl: tokenImageUrl(t),
      classification: classify(t.bonded, t.athUsd),
      curveStats: t.curveStats ?? null,
      replyCount: t.replyCount,
      scannedAt: scan.finishedAt ?? scan.startedAt,
      promptVersion: thesisRow?.promptVersion ?? null,
      thesis: thesisRow?.json ?? null,
    };
  });

  // ── Mimic Dev studies (PLAN.md §7f) ────────────────────────────────────
  /** Lean row for the profile's Mimic tab — the digest snapshot stays server-side. */
  const mimicStudyRow = (row: typeof schema.mimicStudies.$inferSelect) => ({
    id: row.id,
    wallet: row.wallet,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    statusReason: row.statusReason,
    deployCount: row.deployCount,
    promptVersion: row.promptVersion,
    quotaSpent: row.quotaSpent,
    study: row.study ?? null,
  });

  app.post("/api/mimic-scans", async (req, reply) => {
    const parsed = z.object({ wallet: walletField }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: zodMsg(parsed.error) });
    const inFlight = mimicStudyInFlight(parsed.data.wallet);
    if (inFlight) {
      return reply.code(409).send({ error: "a mimic study is already running for this wallet", scanId: inFlight });
    }
    const scanId = createMimicStudy(parsed.data.wallet);
    return { scanId, estimate: estimateMimicCost(), quota: getAllUsage() };
  });

  app.post("/api/mimic-scans/:id/start", async (req) => {
    startMimicStudy((req.params as { id: string }).id);
    return { ok: true };
  });

  app.get("/api/mimic-scans/:id", async (req, reply) => {
    try {
      return mimicStudyRow(getMimicStudy((req.params as { id: string }).id));
    } catch {
      return reply.code(404).send({ error: "mimic study not found" });
    }
  });

  app.get("/api/mimic-scans/:id/events", sseEvents);

  app.get("/api/mimic/:wallet", async (req) => {
    const wallet = (req.params as { wallet: string }).wallet;
    return listMimicStudies(wallet).map(mimicStudyRow);
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
        patterns: section("Deployer patterns"),
        works: section("What works for them"),
        fails: section("What fails for them"),
        questions: section("Low-confidence notes / open questions"),
      },
      theses,
    };
  });

  app.post("/api/profiles/:wallet/rename", async (req, reply) => {
    const wallet = (req.params as { wallet: string }).wallet;
    const body = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: zodMsg(body.error) });
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
    bands: {
      bands_version: bands.bands_version,
      success_mode: bands.success_mode,
      success_min_ath_usd: bands.success_min_ath_usd,
      mid_min_ath_usd: bands.mid_min_ath_usd,
    },
    bandDefaults: BAND_DEFAULTS,
    filters: { include_mayhem: filters.include_mayhem },
    promptVersions: {
      thesis: THESIS_PROMPT_VERSION,
      synthesis: SYNTHESIS_PROMPT_VERSION,
      vamp: VAMP_PROMPT_VERSION,
      narrative: NARRATIVE_PROMPT_VERSION,
      mimic: MIMIC_PROMPT_VERSION,
    },
    grok: { authMode: config.grokAuthMode, model: narrativeConfig.grok.model },
    quota: getAllUsage(),
  }));

  /** Persist new band values to config/bands.json (patch-bumping
   * bands_version) and keep the running process consistent with the file. */
  const writeBands = (next: {
    success_mode: "bonded" | "ath_usd";
    success_min_ath_usd: number;
    mid_min_ath_usd: number;
  }): string => {
    const path = resolve(config.root, "config/bands.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    const [maj, min, patch] = String(file.bands_version).split(".").map(Number);
    file.bands_version = `${maj}.${min}.${(patch ?? 0) + 1}`;
    file.success_mode = next.success_mode;
    file.success_min_ath_usd = next.success_min_ath_usd;
    file.mid_min_ath_usd = next.mid_min_ath_usd;
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    Object.assign(bands, next, { bands_version: file.bands_version });
    return file.bands_version;
  };

  const bandsBody = z.object({
    success_mode: z.enum(["bonded", "ath_usd"]),
    success_min_ath_usd: z.number().positive("SUCCESS threshold must be a positive number"),
    mid_min_ath_usd: z.number().positive("MID threshold must be a positive number"),
  });

  app.put("/api/settings/bands", async (req, reply) => {
    const body = bandsBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: zodMsg(body.error) });
    const b = body.data;
    if (b.success_mode === "ath_usd" && b.success_min_ath_usd <= b.mid_min_ath_usd) {
      return reply
        .code(400)
        .send({ error: "SUCCESS threshold must be higher than the MID threshold" });
    }
    return { ok: true, bands_version: writeBands(b) };
  });

  app.post("/api/settings/bands/reset", async () => ({
    ok: true,
    bands_version: writeBands({ ...BAND_DEFAULTS }),
  }));

  app.put("/api/settings/filters", async (req, reply) => {
    const body = z.object({ include_mayhem: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: zodMsg(body.error) });
    const path = resolve(config.root, "config/filters.json");
    const file = JSON.parse(readFileSync(path, "utf8"));
    file.include_mayhem = body.data.include_mayhem;
    writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
    // Keep the running process consistent with the file.
    (filters as { include_mayhem: boolean }).include_mayhem = body.data.include_mayhem;
    return { ok: true, include_mayhem: file.include_mayhem };
  });
}
