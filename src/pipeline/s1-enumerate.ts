import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { upsertEnumeratedToken } from "../db/tokens.js";
import { pumpfun, bitquery, solanatracker } from "../providers/index.js";
import { getTopCreatedByAth } from "../providers/pumpfun.js";
import { BitqueryPlanRestrictedError } from "../providers/bitquery.js";
import { MissingCredentialError } from "../config.js";
import { getStageState, patchStageState, getScan, recordQuotaSpent } from "./checkpoint.js";
import { ScanPausedError, type ScanCtx } from "./types.js";

/**
 * S1 — Enumerate the wallet's most recent N deploys (provider 1) + lifetime
 * context via Bitquery aggregates. Sub-checkpoints: enumeration and lifetime
 * complete independently, so a missing BITQUERY_API_KEY after a finished
 * enumeration resumes straight into the lifetime fetch.
 */
export async function runS1(ctx: ScanCtx): Promise<void> {
  const state = getStageState(ctx.scanId, "s1");

  if (!state.enumerated) {
    // Always re-enumerate the full window, even on re-scans: pump.fun calls
    // are free, and the upsert refreshes stale ATHs for tokens that pumped
    // after the previous scan (observed live: a token at $6.6k at scan time
    // that hit $419k hours later and would never have been re-read). The
    // expensive delta — thesis reuse — is handled per mint in S5.
    const scan = getScan(ctx.scanId);
    ctx.emit({
      type: "progress",
      stage: "s1",
      message: `Enumerating up to ${ctx.windowN} most recent deploys from pump.fun…`,
    });
    const tokens = await pumpfun.enumerateCreatedTokens!(ctx.wallet, ctx.windowN);
    for (const t of tokens) upsertEnumeratedToken(t);

    const newFrom = tokens.length ? Math.min(...tokens.map((t) => t.createdAt)) : null;
    const newTo = tokens.length ? Math.max(...tokens.map((t) => t.createdAt)) : null;
    const from = scan.windowFrom != null ? (newFrom != null ? Math.min(scan.windowFrom, newFrom) : scan.windowFrom) : newFrom;
    const to = scan.windowTo != null ? (newTo != null ? Math.max(scan.windowTo, newTo) : scan.windowTo) : newTo;
    db.update(schema.scans)
      .set({ windowFrom: from, windowTo: to })
      .where(eq(schema.scans.id, ctx.scanId))
      .run();

    db.insert(schema.deployers)
      .values({ wallet: ctx.wallet, name: ctx.alias, createdAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.deployers.wallet,
        set: ctx.alias ? { name: ctx.alias } : { wallet: ctx.wallet },
      })
      .run();

    patchStageState(ctx.scanId, "s1", { enumerated: true, tokenCount: tokens.length });
    ctx.emit({
      type: "progress",
      stage: "s1",
      message:
        tokens.length === 0
          ? "No pump.fun creates found for this wallet — not a pump.fun deployer."
          : `Enumerated ${tokens.length} deploys (window ${from ? new Date(from).toISOString().slice(0, 10) : "?"} → ${to ? new Date(to).toISOString().slice(0, 10) : "?"}).`,
    });
  }

  if (!getStageState(ctx.scanId, "s1").highlights) {
    // Lifetime highlights (added 2026-10-05): one free pump.fun call sorted by
    // ath_market_cap returns the wallet's all-time top deploys — this is how
    // out-of-window career-defining tokens (e.g. a $130M graduate behind 22k
    // newer deploys) enter the dossier. S3 auto-pins the top K.
    ctx.emit({ type: "progress", stage: "s1", message: "Fetching all-time top deploys (free, ATH-sorted)…" });
    const tops = await getTopCreatedByAth(ctx.wallet, 10);
    for (const t of tops) upsertEnumeratedToken(t);
    const best = tops[0];
    if (best?.athUsd != null) {
      db.update(schema.deployers)
        .set({ lifetimeBestAthUsd: best.athUsd, lifetimeBestMint: best.mint })
        .where(eq(schema.deployers.wallet, ctx.wallet))
        .run();
    }
    patchStageState(ctx.scanId, "s1", {
      highlights: true,
      lifetimeTopMints: tops.map((t) => t.mint),
    });
    if (best) {
      ctx.emit({
        type: "progress",
        stage: "s1",
        message: `All-time best deploy: ${best.name} (${best.ticker}) — ATH $${Math.round(best.athUsd ?? 0).toLocaleString()}.`,
      });
    }
  }

  if (!state.lifetime && !getStageState(ctx.scanId, "s1").lifetime) {
    // Lifetime context (reworked 2026-10-05): Solana Tracker /deployer gives
    // exact lifetime totals in one quota'd call. Bitquery's archive dataset
    // would add the lifetime best-ever ATH, but the free tier is realtime-only
    // — attempted opportunistically, surfaced loudly, never blocking.
    ctx.emit({ type: "progress", stage: "s1", message: "Fetching lifetime context (Solana Tracker /deployer)…" });
    try {
      const stats = await solanatracker.getLifetimeStats!(ctx.wallet);
      recordQuotaSpent(ctx.scanId, "solanatracker", 1);

      // Highlights already filled lifetime best from pump.fun's ATH sort;
      // Bitquery archive (paid plans) may only improve on it, never erase it.
      const current = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, ctx.wallet)).get();
      let bestAthUsd = current?.lifetimeBestAthUsd ?? null;
      let bestMint = current?.lifetimeBestMint ?? null;
      if (process.env.BITQUERY_API_KEY?.trim()) {
        try {
          const archive = await bitquery.getLifetimeStats!(ctx.wallet);
          if (archive.bestAthUsd != null && archive.bestAthUsd > (bestAthUsd ?? 0)) {
            bestAthUsd = archive.bestAthUsd;
            bestMint = archive.bestMint;
          }
        } catch (err) {
          if (err instanceof BitqueryPlanRestrictedError) {
            ctx.emit({ type: "log", stage: "s1", message: err.message });
          } else {
            throw err;
          }
        }
      } else {
        ctx.emit({
          type: "log",
          stage: "s1",
          message: "BITQUERY_API_KEY not set — optional archive cross-check of lifetime best ATH skipped.",
        });
      }

      db.update(schema.deployers)
        .set({
          lifetimeDeploys: stats.totalDeploys,
          lifetimeGraduated: stats.graduatedCount,
          lifetimeBestAthUsd: bestAthUsd,
          lifetimeBestMint: bestMint,
        })
        .where(eq(schema.deployers.wallet, ctx.wallet))
        .run();
      patchStageState(ctx.scanId, "s1", { lifetime: true, lifetimeStats: { ...stats, bestAthUsd, bestMint } });
      ctx.emit({
        type: "progress",
        stage: "s1",
        message: `Lifetime: ${stats.totalDeploys} deploys, ${stats.graduatedCount ?? "?"} graduated, best ATH ${bestAthUsd ? "$" + Math.round(bestAthUsd).toLocaleString() : "unknown"}.`,
      });
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        throw new ScanPausedError(`S1 lifetime context needs ${err.variable} — ${err.message}`);
      }
      throw err;
    }
  }
}
