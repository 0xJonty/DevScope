import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { MissingCredentialError, scanDefaults } from "../config.js";
import { db, schema } from "../db/index.js";
import type { VampShortlistEntry } from "../db/schema.js";
import { getTokensByMints, type TokenRow } from "../db/tokens.js";
import { getCoinsBatch, pumpfun, type PumpfunCoin } from "../providers/pumpfun.js";
import { searchWindowTokens } from "../providers/solanatracker.js";
import { assertHeadroom, QuotaExceededError } from "../providers/quota.js";
import { runAgentJson, AgentOutputError, RateLimitPause } from "../reasoning/agent.js";
import { vampVerdictSchema, vampVerdictJsonSchema, type VampVerdict } from "../reasoning/schemas.js";
import {
  buildVampPrompt,
  VAMP_PROMPT_VERSION,
  type VampDossier,
  type VampCandidateDossier,
} from "../reasoning/prompts/vamp.js";
import { upsertEnumeratedToken } from "../db/tokens.js";
import { scanEvents } from "./events.js";
import { RATE_LIMIT_RESUME_MS, scanQueue } from "./orchestrator.js";
import { downloadImage, enrichTokenRow } from "./s4-enrich.js";
import { reasoningConfig } from "./s5-thesis.js";
import { ScanPausedError, type ScanEvent } from "./types.js";
import { scoreCandidate } from "./vamp-similarity.js";

/**
 * Vamp Scan — opt-in PvP analysis around one token's launch window
 * (PLAN.md §7c). Mini-pipeline, every step checkpointed on the scan row:
 *   V1 window enumerate (Solana Tracker /search, quota'd)   → windowTokens
 *   V2 resolve+filter (free pump.fun batch: ATH floor, mayhem) ┐
 *   V3 similarity shortlist + candidate images                ┘→ shortlist
 *   V4 verdict (one Layer B run, vision over all images)      → vamp_verdicts
 * Candidates never enter the `tokens` table — they'd skew per-wallet stats
 * for any deployer who happens to own one. The shortlist snapshot on the
 * scan row is the whole record.
 */

type VampScanRow = typeof schema.vampScans.$inferSelect;

export function createVampScan(mint: string, triggerScanId?: string | null): string {
  const id = randomUUID();
  db.insert(schema.vampScans)
    .values({
      id,
      mint,
      triggerScanId: triggerScanId ?? null,
      startedAt: Date.now(),
      status: "paused",
      statusReason: "queued",
      windowMinutes: scanDefaults.vamp.window_minutes,
      athFloorUsd: scanDefaults.vamp.ath_floor_usd,
      quotaSpent: {},
    })
    .run();
  return id;
}

export function getVampScan(id: string): VampScanRow {
  const scan = db.select().from(schema.vampScans).where(eq(schema.vampScans.id, id)).get();
  if (!scan) throw new Error(`Vamp scan ${id} not found`);
  return scan;
}

/** Latest vamp scan + verdict for a mint (token pages render this). */
export function getVampState(mint: string): {
  scan: VampScanRow | null;
  verdict: Record<string, unknown> | null;
  promptVersion: string | null;
} {
  const scan = db
    .select()
    .from(schema.vampScans)
    .where(eq(schema.vampScans.mint, mint))
    .orderBy(desc(schema.vampScans.startedAt))
    .get();
  if (!scan) return { scan: null, verdict: null, promptVersion: null };
  const verdict = db
    .select()
    .from(schema.vampVerdicts)
    .where(and(eq(schema.vampVerdicts.mint, mint), eq(schema.vampVerdicts.vampScanId, scan.id)))
    .get();
  return { scan, verdict: verdict?.json ?? null, promptVersion: verdict?.promptVersion ?? null };
}

function setStatus(id: string, status: "running" | "paused" | "failed" | "done", reason?: string): void {
  db.update(schema.vampScans)
    .set({ status, statusReason: reason ?? null, ...(status === "done" ? { finishedAt: Date.now() } : {}) })
    .where(eq(schema.vampScans.id, id))
    .run();
}

function patchScan(id: string, patch: Partial<typeof schema.vampScans.$inferInsert>): void {
  db.update(schema.vampScans).set(patch).where(eq(schema.vampScans.id, id)).run();
}

function recordQuota(id: string, provider: string, calls: number): void {
  if (calls === 0) return;
  const scan = getVampScan(id);
  const spent = { ...(scan.quotaSpent ?? {}) };
  spent[provider] = (spent[provider] ?? 0) + calls;
  patchScan(id, { quotaSpent: spent });
}

export function startVampScan(id: string): void {
  void scanQueue.add(() => executeVampScan(id));
}

async function executeVampScan(id: string): Promise<void> {
  let scan = getVampScan(id);
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) =>
    scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  setStatus(id, "running");
  emit({ type: "resumed", message: "Vamp scan running." });

  try {
    // The scanned token must be cached + enriched (it always is — vamp scans
    // start from a completed scan's token page). Self-heal if not.
    let row = getTokensByMints([scan.mint])[0];
    if (!row) {
      emit({ type: "progress", message: `Token not cached — fetching ${scan.mint} (pump.fun)…` });
      upsertEnumeratedToken(await pumpfun.getTokenDetail!(scan.mint));
      recordQuota(id, "pumpfun", 1);
      row = getTokensByMints([scan.mint])[0]!;
    }
    if (!row.imagePath) {
      await enrichTokenRow(row, emit, (provider, calls) => recordQuota(id, provider, calls));
      row = getTokensByMints([scan.mint])[0]!;
    }

    // V1 — window enumeration (quota'd; checkpointed in windowTokens).
    if (scan.windowTokens == null) {
      const windowMs = scan.windowMinutes * 60_000;
      assertHeadroom("solanatracker", 2);
      emit({
        type: "progress",
        message: `V1: enumerating every pump.fun deploy within ±${scan.windowMinutes} min of launch (Solana Tracker, quota'd)…`,
      });
      const { tokens, calls } = await searchWindowTokens(row.createdAt - windowMs, row.createdAt + windowMs);
      recordQuota(id, "solanatracker", calls);
      const others = tokens.filter((t) => t.mint !== scan.mint);
      patchScan(id, {
        windowTokens: others.map((t) => ({ mint: t.mint, createdAt: t.createdAt, deployer: t.deployer })),
        candidatesTotal: others.length,
      });
      scan = getVampScan(id);
      emit({ type: "progress", message: `V1: ${others.length} deploys share the window.` });
    }

    // V2 + V3 — resolve metadata/ATH (free batch), floor-filter, rank, images.
    if (scan.shortlist == null) {
      const windowTokens = scan.windowTokens ?? [];
      emit({
        type: "progress",
        message: `V2: resolving ${windowTokens.length} candidates (pump.fun batch, free) + ATH floor $${scan.athFloorUsd.toLocaleString("en-US")}…`,
      });
      const { coins, mayhemExcluded, calls } = await getCoinsBatch([scan.mint, ...windowTokens.map((t) => t.mint)]);
      recordQuota(id, "pumpfun", calls);
      if (mayhemExcluded.length > 0) {
        emit({ type: "log", message: `V2: ${mayhemExcluded.length} mayhem-mode launches excluded by policy.` });
      }

      const scannedCoin = coins.find((c) => c.mint === scan.mint) ?? null;
      const survivors = coins.filter(
        (c) => c.mint !== scan.mint && (c.ath_market_cap ?? 0) >= scan.athFloorUsd
      );
      emit({ type: "progress", message: `V2: ${survivors.length} candidates reached the ATH floor.` });

      const windowMs = scan.windowMinutes * 60_000;
      const scored = survivors
        .map((c) => {
          const { textSim, score } = scoreCandidate(
            { name: row.name, ticker: row.ticker, description: row.description },
            {
              name: c.name,
              ticker: c.symbol,
              description: c.description ?? null,
              athUsd: c.ath_market_cap ?? null,
              createdDeltaMs: c.created_timestamp - row.createdAt,
            },
            windowMs,
            scan.athFloorUsd
          );
          return { coin: c, textSim, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, scanDefaults.vamp.shortlist_cap);

      // V3 — candidate images for the top-K (vision input for V4). Downloads
      // are keyed by mint in /data/images, so reruns are free.
      const shortlist: VampShortlistEntry[] = [];
      for (const [i, s] of scored.entries()) {
        const c = s.coin;
        let imagePath: string | null = null;
        if (i < scanDefaults.vamp.image_candidates && c.image_uri) {
          imagePath = await downloadImage(c.mint, c.image_uri);
          if (!imagePath) emit({ type: "log", message: `V3: image download failed for ${c.symbol} (${c.mint}).` });
        }
        shortlist.push(toShortlistEntry(c, row, s.score, imagePath));
      }
      patchScan(id, { shortlist, candidatesFiltered: survivors.length });
      scan = getVampScan(id);
      emit({
        type: "progress",
        message: `V3: shortlist of ${shortlist.length} (cap ${scanDefaults.vamp.shortlist_cap}), ${shortlist.filter((s) => s.imagePath).length} with images.`,
      });
      // Scanned token's fee flags come from the same batch — stash them on the
      // shortlist head via closure variable instead of a schema field.
      if (scannedCoin) scannedFeeCache.set(id, scannedCoin);
    }

    // V4 — verdict (one Layer B run).
    const existing = db
      .select()
      .from(schema.vampVerdicts)
      .where(and(eq(schema.vampVerdicts.mint, scan.mint), eq(schema.vampVerdicts.vampScanId, id)))
      .get();
    if (!existing) {
      await generateVampVerdict(id, scan, row, emit);
    }

    setStatus(id, "done");
    emit({ type: "done", message: "Vamp scan complete." });
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      const reason = `Vamp scan needs ${err.variable} — ${err.message}`;
      setStatus(id, "paused", reason);
      emit({ type: "paused", message: reason });
      return;
    }
    if (err instanceof ScanPausedError || err instanceof QuotaExceededError) {
      const reason = err.message;
      setStatus(id, "paused", reason);
      emit({ type: "paused", message: reason });
      if (/usage limit|rate.?limit|overloaded/i.test(reason)) {
        emit({ type: "log", message: `Auto-resume in ${RATE_LIMIT_RESUME_MS / 60000} min.` });
        setTimeout(() => {
          if (getVampScan(id).status === "paused") startVampScan(id);
        }, RATE_LIMIT_RESUME_MS).unref();
      }
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    setStatus(id, "failed", reason);
    emit({ type: "error", message: reason });
  }
}

/** Scanned token's own fee flags, captured from the V2 batch for the dossier.
 * In-memory is fine: a resume that skips V2 re-reads them with one free call. */
const scannedFeeCache = new Map<string, PumpfunCoin>();

function toShortlistEntry(
  c: PumpfunCoin,
  scanned: TokenRow,
  score: number,
  imagePath: string | null
): VampShortlistEntry {
  return {
    mint: c.mint,
    name: c.name,
    ticker: c.symbol,
    description: c.description ?? null,
    createdAt: c.created_timestamp,
    athUsd: c.ath_market_cap ?? null,
    athAt: c.ath_market_cap_timestamp ?? null,
    bonded: c.complete,
    deployer: c.creator,
    sameDeployer: c.creator === scanned.wallet,
    cashback: c.is_cashback_enabled ?? null,
    holderReward: c.is_holder_reward ?? null,
    transferFeeBps: c.transfer_fee_bps ?? null,
    replyCount: c.reply_count ?? null,
    imageUri: c.image_uri ?? null,
    imagePath,
    score: Math.round(score * 1000) / 1000,
  };
}

async function generateVampVerdict(
  id: string,
  scan: VampScanRow,
  row: TokenRow,
  emit: (ev: Omit<ScanEvent, "scanId" | "at">) => void
): Promise<void> {
  const shortlist = scan.shortlist ?? [];
  let scannedCoin = scannedFeeCache.get(id) ?? null;
  if (!scannedCoin) {
    // Resume path: V2 ran in a previous process — one free call restores the
    // scanned token's fee flags.
    try {
      const { coins, calls } = await getCoinsBatch([scan.mint]);
      recordQuota(id, "pumpfun", calls);
      scannedCoin = coins[0] ?? null;
    } catch {
      scannedCoin = null; // fee flags degrade to nulls; the dossier stays honest
    }
  }

  const priorThesis = db
    .select()
    .from(schema.theses)
    .where(eq(schema.theses.mint, scan.mint))
    .all()
    .filter((t) => !(t.json as { generation_failed?: boolean }).generation_failed)
    .sort((a, b) => b.createdAt - a.createdAt)[0];

  const candidates: VampCandidateDossier[] = shortlist.map((s) => ({
    mint: s.mint,
    name: s.name,
    ticker: s.ticker,
    description: s.description ? s.description.slice(0, 200) : null,
    launched_seconds_after_scanned: Math.round((s.createdAt - row.createdAt) / 1000),
    ath_usd: s.athUsd,
    ath_minutes_after_scanned_ath:
      s.athAt != null && row.athAt != null ? Math.round((s.athAt - row.athAt) / 60_000) : null,
    bonded: s.bonded,
    fees: { cashback: s.cashback, holder_rewards: s.holderReward, transfer_fee_bps: s.transferFeeBps },
    same_deployer: s.sameDeployer,
    reply_count: s.replyCount,
    image_attached: s.imagePath != null,
  }));

  const dossier: VampDossier = {
    scanned: {
      mint: row.mint,
      name: row.name,
      ticker: row.ticker,
      description: row.description,
      created_at_iso: new Date(row.createdAt).toISOString(),
      bonded: row.bonded,
      ath_usd: row.athUsd,
      ath_at_iso: row.athAt ? new Date(row.athAt).toISOString() : null,
      fees: {
        cashback: scannedCoin?.is_cashback_enabled ?? row.cashback,
        holder_rewards: scannedCoin?.is_holder_reward ?? null,
        transfer_fee_bps: scannedCoin?.transfer_fee_bps ?? null,
      },
      reply_count: row.replyCount,
      prior_thesis: (priorThesis?.json as { thesis?: string } | undefined)?.thesis ?? null,
    },
    window_minutes: scan.windowMinutes,
    ath_floor_usd: scan.athFloorUsd,
    candidates,
  };

  const images: Array<{ path: string; label: string }> = [];
  if (row.imagePath) images.push({ path: row.imagePath, label: `SCANNED: ${row.ticker}` });
  for (const s of shortlist) {
    if (s.imagePath) images.push({ path: s.imagePath, label: `candidate ${s.ticker} (${s.mint.slice(0, 6)}…)` });
  }

  emit({ type: "agent", message: `V4: vamp verdict for ${row.name} (${row.ticker}) — ${candidates.length} candidates…` });

  const shortlistMints = new Set(shortlist.map((s) => s.mint));
  let verdict: VampVerdict | null = null;
  let prompt = buildVampPrompt(dossier);
  for (let attempt = 1; attempt <= 2 && !verdict; attempt++) {
    try {
      verdict = await runAgentJson(prompt, vampVerdictSchema, {
        model: reasoningConfig.vamp_model,
        maxTurns: reasoningConfig.max_turns_vamp,
        jsonSchema: vampVerdictJsonSchema as unknown as Record<string, unknown>,
        images,
        onActivity: (m) => emit({ type: "agent", message: `  ${m}` }),
      });
      if (verdict.mint !== row.mint) {
        throw new AgentOutputError(`mint mismatch: got ${verdict.mint}, expected ${row.mint}`);
      }
      const foreign = verdict.counterparts.filter((c) => !shortlistMints.has(c.mint));
      if (foreign.length > 0) {
        throw new AgentOutputError(
          `counterpart mints not in the candidate list: ${foreign.map((c) => c.mint).join(", ")}`
        );
      }
      if (verdict.role === "no_vamp_found" && verdict.counterparts.length > 0) {
        throw new AgentOutputError("role no_vamp_found requires empty counterparts");
      }
      if (verdict.role !== "no_vamp_found" && verdict.counterparts.length === 0) {
        throw new AgentOutputError(`role ${verdict.role} requires at least one counterpart`);
      }
    } catch (err) {
      if (err instanceof RateLimitPause) throw new ScanPausedError(err.message);
      if (err instanceof AgentOutputError && attempt === 1) {
        prompt = `${buildVampPrompt(dossier)}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly this and try again:\n${err.message}`;
        continue;
      }
      emit({ type: "log", message: `vamp verdict failed for ${scan.mint}: ${String(err)}` });
      db.insert(schema.vampVerdicts)
        .values({
          mint: scan.mint,
          vampScanId: id,
          json: { mint: scan.mint, generation_failed: true, error: String(err).slice(0, 500) },
          promptVersion: VAMP_PROMPT_VERSION,
          createdAt: Date.now(),
        })
        .run();
      return;
    }
  }
  if (verdict) {
    db.insert(schema.vampVerdicts)
      .values({
        mint: scan.mint,
        vampScanId: id,
        json: verdict as unknown as Record<string, unknown>,
        promptVersion: VAMP_PROMPT_VERSION,
        createdAt: Date.now(),
      })
      .run();
    emit({ type: "progress", message: `V4: verdict ${verdict.role} (${verdict.confidence} confidence).` });
  }
}

/** Pre-flight quota estimate (mirrors estimateTokenScanCost). */
export function estimateVampScanCost(): Record<string, { estimated: number; note: string }> {
  return {
    solanatracker: {
      estimated: 2,
      note: `±${scanDefaults.vamp.window_minutes} min window search (usually 1 page, 2 budgeted)`,
    },
    pumpfun: { estimated: 1, note: "candidate metadata + ATH batch (keyless)" },
    geckoterminal: { estimated: 0, note: "not used" },
  };
}

/** On server boot: surface vamp scans that were running when the process died. */
export function recoverInterruptedVampScans(): void {
  const rows = db.select().from(schema.vampScans).where(eq(schema.vampScans.status, "running")).all();
  for (const r of rows) {
    setStatus(r.id, "paused", "process restarted mid-scan — resume manually");
  }
}
