import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MissingCredentialError } from "../config.js";
import { db, schema } from "../db/index.js";
import {
  getTokensByMints,
  isAuthoritativeAthSource,
  purgeTokens,
  setTokenAth,
  upsertEnumeratedToken,
  type TokenRow,
} from "../db/tokens.js";
import { fetchAthWithFailover } from "../providers/index.js";
import { MayhemExcludedError, pumpfun } from "../providers/pumpfun.js";
import { assertHeadroom, QuotaExceededError } from "../providers/quota.js";
import { scanEvents } from "./events.js";
import { RATE_LIMIT_RESUME_MS, scanQueue } from "./orchestrator.js";
import { classify } from "./s2-score.js";
import { enrichTokenRow } from "./s4-enrich.js";
import { generateOrReuseThesis } from "./s5-thesis.js";
import { ScanPausedError, type ScanEvent } from "./types.js";

/**
 * Token Scan — single-contract research scan (PLAN.md §7b). A mini-pipeline
 * over the same primitives as the deployer scan: free pump.fun lookup →
 * authoritative ATH (S2 rule) → enrichment (S4) → one thesis (S5, Layer B).
 * Every step is idempotent, so a paused/failed scan resumes by re-running:
 * cached token fields refresh free, an authoritative ATH is never re-fetched,
 * and an existing (mint, scanId) thesis short-circuits Layer B.
 */

export function createTokenScan(mint: string): string {
  const id = randomUUID();
  db.insert(schema.tokenScans)
    .values({ id, mint, startedAt: Date.now(), status: "paused", statusReason: "queued", quotaSpent: {} })
    .run();
  return id;
}

export function getTokenScan(id: string) {
  const scan = db.select().from(schema.tokenScans).where(eq(schema.tokenScans.id, id)).get();
  if (!scan) throw new Error(`Token scan ${id} not found`);
  return scan;
}

function setStatus(id: string, status: "running" | "paused" | "failed" | "done", reason?: string): void {
  db.update(schema.tokenScans)
    .set({ status, statusReason: reason ?? null, ...(status === "done" ? { finishedAt: Date.now() } : {}) })
    .where(eq(schema.tokenScans.id, id))
    .run();
}

function recordQuota(id: string, provider: string, calls: number): void {
  const scan = getTokenScan(id);
  const spent = { ...(scan.quotaSpent ?? {}) };
  spent[provider] = (spent[provider] ?? 0) + calls;
  db.update(schema.tokenScans).set({ quotaSpent: spent }).where(eq(schema.tokenScans.id, id)).run();
}

export function startTokenScan(id: string): void {
  void scanQueue.add(() => executeTokenScan(id));
}

async function executeTokenScan(id: string): Promise<void> {
  const scan = getTokenScan(id);
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) =>
    scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  setStatus(id, "running");
  emit({ type: "resumed", message: "Token scan running." });

  try {
    // 1. Metadata — free single-coin lookup; refreshes mutable cached fields.
    emit({ type: "progress", message: `Fetching token metadata for ${scan.mint} (pump.fun)…` });
    const detail = await pumpfun.getTokenDetail!(scan.mint);
    upsertEnumeratedToken(detail);
    recordQuota(id, "pumpfun", 1);
    let row = mustGetRow(scan.mint);
    emit({ type: "progress", message: `Found ${row.name} (${row.ticker}) by ${row.wallet}.` });

    // 2. Authoritative ATH — same rule as S2: bonded tokens only, max-merged
    //    with pump.fun's curve-phase value; cached authoritative ATH is kept.
    const cachedAuthoritative =
      isAuthoritativeAthSource(row.athSource) &&
      !(row.lastTradeAt != null && row.lastTradeAt > row.fetchedAt - 60_000 && row.bonded);
    if (row.bonded && !cachedAuthoritative) {
      assertHeadroom("solanatracker", 1);
      emit({ type: "progress", message: "Bonded token — fetching authoritative ATH (quota'd)…" });
      const ath = await fetchAthWithFailover(row.mint, row.poolAddress);
      const pumpfunAth = row.athSource === "pumpfun" ? row.athUsd : null;
      if (pumpfunAth != null && pumpfunAth > ath.athUsd) {
        setTokenAth(row.mint, pumpfunAth, row.athAt, `pumpfun+${ath.source}-max`);
      } else {
        setTokenAth(row.mint, ath.athUsd, ath.athAt, ath.source);
      }
      recordQuota(id, ath.source, 1);
    }

    // 3. Enrichment — image (vision input) + curve stats.
    row = mustGetRow(scan.mint);
    emit({ type: "progress", message: `Enriching ${row.ticker}…` });
    await enrichTokenRow(row, emit, (provider, calls) => recordQuota(id, provider, calls));
    row = mustGetRow(scan.mint);

    // 4. Thesis (Layer B) — a prior successful thesis for this mint is copied
    //    verbatim (re-scan rule), so already-studied tokens cost nothing.
    const existing = db
      .select()
      .from(schema.theses)
      .where(eq(schema.theses.scanId, id))
      .get();
    if (!existing) {
      await generateOrReuseThesis({
        scanId: id,
        row,
        classification: classify(row.bonded, row.athUsd),
        selectionReason: "token-scan",
        label: "Thesis",
        emit,
      });
    }

    setStatus(id, "done");
    emit({ type: "done", message: "Token scan complete." });
  } catch (err) {
    if (err instanceof MayhemExcludedError) {
      // Same purge rule as S1: policy-excluded rows cached before the filter
      // existed (and their theses) must not linger in the DB.
      purgeTokens([scan.mint]);
      setStatus(id, "failed", err.message);
      emit({ type: "error", message: err.message });
      return;
    }
    if (err instanceof MissingCredentialError) {
      const reason = `Token scan needs ${err.variable} — ${err.message}`;
      setStatus(id, "paused", reason);
      emit({ type: "paused", message: reason });
      return;
    }
    if (err instanceof ScanPausedError || err instanceof QuotaExceededError) {
      const reason = err.message;
      setStatus(id, "paused", reason);
      emit({ type: "paused", message: reason });
      // Usage-window limits clear on their own — auto-resume (same as dev scans).
      if (/usage limit|rate.?limit|overloaded/i.test(reason)) {
        emit({ type: "log", message: `Auto-resume in ${RATE_LIMIT_RESUME_MS / 60000} min.` });
        setTimeout(() => {
          const s = getTokenScan(id);
          if (s.status === "paused") startTokenScan(id);
        }, RATE_LIMIT_RESUME_MS).unref();
      }
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    setStatus(id, "failed", reason);
    emit({ type: "error", message: reason });
  }
}

function mustGetRow(mint: string): TokenRow {
  const row = getTokensByMints([mint])[0];
  if (!row) throw new Error(`token row missing after upsert for ${mint}`);
  return row;
}

/** Pre-flight quota estimate (mirrors estimateScanCost). */
export function estimateTokenScanCost(mint: string): Record<string, { estimated: number; note: string }> {
  const cached = getTokensByMints([mint])[0];
  const athCached = cached != null && isAuthoritativeAthSource(cached.athSource);
  return {
    pumpfun: { estimated: 1, note: "single-coin lookup (keyless)" },
    solanatracker: {
      estimated: athCached ? 0 : 1,
      note: athCached ? "authoritative ATH already cached" : "authoritative ATH — spent only if the token bonded",
    },
    geckoterminal: { estimated: cached?.bonded && cached.poolAddress ? 1 : 0, note: "candles if bonded with a pool" },
  };
}

/** On server boot: surface token scans that were running when the process died. */
export function recoverInterruptedTokenScans(): void {
  const rows = db.select().from(schema.tokenScans).where(eq(schema.tokenScans.status, "running")).all();
  for (const row of rows) {
    setStatus(row.id, "paused", "process restarted mid-scan — resume manually");
  }
}
