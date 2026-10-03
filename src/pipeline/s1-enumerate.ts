import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { upsertEnumeratedToken } from "../db/tokens.js";
import { pumpfun, bitquery } from "../providers/index.js";
import { MissingCredentialError } from "../config.js";
import { getStageState, patchStageState, getScan } from "./checkpoint.js";
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
    // Re-scan delta (PLAN.md §7): only fetch deploys newer than the prior
    // scan's window.to; the scan row already carries the prior window bounds.
    const scan = getScan(ctx.scanId);
    const sinceMs = (getStageState(ctx.scanId, "delta_since" as never).sinceMs as number | undefined) ?? undefined;
    ctx.emit({
      type: "progress",
      stage: "s1",
      message: sinceMs
        ? `Delta-enumerating deploys since ${new Date(sinceMs).toISOString()}…`
        : `Enumerating up to ${ctx.windowN} deploys from pump.fun…`,
    });
    const tokens = await pumpfun.enumerateCreatedTokens!(ctx.wallet, ctx.windowN, sinceMs);
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
          ? sinceMs
            ? "No new deploys since the last scan."
            : "No pump.fun creates found for this wallet — not a pump.fun deployer."
          : `Enumerated ${tokens.length} ${sinceMs ? "new " : ""}deploys (window ${from ? new Date(from).toISOString().slice(0, 10) : "?"} → ${to ? new Date(to).toISOString().slice(0, 10) : "?"}).`,
    });
  }

  if (!state.lifetime && !getStageState(ctx.scanId, "s1").lifetime) {
    ctx.emit({ type: "progress", stage: "s1", message: "Fetching lifetime context (Bitquery aggregates)…" });
    try {
      const stats = await bitquery.getLifetimeStats!(ctx.wallet);
      db.update(schema.deployers)
        .set({
          lifetimeDeploys: stats.totalDeploys,
          lifetimeBestAthUsd: stats.bestAthUsd,
          lifetimeBestMint: stats.bestMint,
        })
        .where(eq(schema.deployers.wallet, ctx.wallet))
        .run();
      patchStageState(ctx.scanId, "s1", { lifetime: true, lifetimeStats: stats });
      ctx.emit({
        type: "progress",
        stage: "s1",
        message: `Lifetime: ${stats.totalDeploys} deploys, best ATH ${stats.bestAthUsd ? "$" + Math.round(stats.bestAthUsd).toLocaleString() : "unknown"}.`,
      });
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        throw new ScanPausedError(`S1 lifetime context needs ${err.variable} — ${err.message}`);
      }
      throw err;
    }
  }
}
