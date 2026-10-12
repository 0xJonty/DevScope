import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { scanDefaults } from "../config.js";
import { db, schema } from "../db/index.js";
import { getCoinsBatch, pumpfun, type PumpfunCoin } from "../providers/pumpfun.js";
import { AgentOutputError, RateLimitPause, runAgentJson } from "../reasoning/agent.js";
import {
  buildMimicPrompt,
  MIMIC_PROMPT_VERSION,
  type MimicDeployRow,
  type MimicDigest,
  type MimicExemplar,
  type MimicStats,
  type MimicTwitterCandidate,
} from "../reasoning/prompts/mimic.js";
import { mimicStudyJsonSchema, mimicStudySchema, type MimicStudy } from "../reasoning/schemas.js";
import type { EnumeratedToken } from "../providers/types.js";
import { scanEvents } from "./events.js";
import { computeFingerprint } from "./fingerprint.js";
import { RATE_LIMIT_RESUME_MS, scanQueue } from "./orchestrator.js";
import { classify } from "./s2-score.js";
import { downloadImage } from "./s4-enrich.js";
import { reasoningConfig } from "./s5-thesis.js";
import type { Classification, ScanEvent, WindowToken } from "./types.js";

/**
 * Mimic Dev study (PLAN.md §7f) — a two-step mini-pipeline:
 *   M1  Digest (Layer A, free): fresh-enumerate the wallet's last ~100 deploys
 *       via keyless pump.fun calls, compute mechanical style stats, extract
 *       recurring X-handle candidates, download exemplar images. Checkpointed
 *       on `digest` — a resume never re-fetches.
 *   M2  Study (Layer B, 1 run): the digest + exemplar images (vision) + an
 *       optional Scrapling fetch of the dev's X account become a followable
 *       deploy playbook (mimicStudySchema). Idempotent: an existing study
 *       short-circuits.
 * Self-contained: the digest snapshot is the whole record — nothing here reads
 * from or writes into the `tokens` table, so stale cache never skews a study
 * and studies never skew per-wallet stats.
 */

export function createMimicStudy(wallet: string): string {
  const id = randomUUID();
  db.insert(schema.mimicStudies)
    .values({ id, wallet, startedAt: Date.now(), status: "paused", statusReason: "queued" })
    .run();
  return id;
}

export function getMimicStudy(id: string) {
  const row = db.select().from(schema.mimicStudies).where(eq(schema.mimicStudies.id, id)).get();
  if (!row) throw new Error(`Mimic study ${id} not found`);
  return row;
}

export function listMimicStudies(wallet: string) {
  return db
    .select()
    .from(schema.mimicStudies)
    .where(eq(schema.mimicStudies.wallet, wallet))
    .orderBy(desc(schema.mimicStudies.startedAt))
    .all();
}

/** A wallet gets one mimic study in flight at a time (HTTP 409 in the route). */
export function mimicStudyInFlight(wallet: string): string | null {
  const row = listMimicStudies(wallet).find((s) => s.status === "running" || s.statusReason === "queued");
  return row?.id ?? null;
}

export function estimateMimicCost(): Record<string, { estimated: number; note: string }> {
  const pages = Math.ceil(scanDefaults.mimic.window_n / 50);
  return {
    pumpfun: {
      estimated: pages + 1,
      note: `keyless: ${pages} enumeration pages + 1 batch lookup (fee flags) — no quota'd providers`,
    },
  };
}

function setStatus(id: string, status: "running" | "paused" | "failed" | "done", reason?: string): void {
  db.update(schema.mimicStudies)
    .set({ status, statusReason: reason ?? null, ...(status === "done" ? { finishedAt: Date.now() } : {}) })
    .where(eq(schema.mimicStudies.id, id))
    .run();
}

export function startMimicStudy(id: string): void {
  void scanQueue.add(() => executeMimicStudy(id));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** X handle from a token-social URL; null for share/intent/community paths. */
function extractHandle(url: string): string | null {
  const m = url.match(/(?:^|\/\/)(?:www\.)?(?:twitter\.com|x\.com)\/@?([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  if (!m) return null;
  const handle = m[1]!;
  const reserved = new Set(["i", "intent", "home", "search", "hashtag", "share", "login", "explore", "search?q"]);
  return reserved.has(handle.toLowerCase()) ? null : handle;
}

function buildTwitterCandidates(coins: PumpfunCoin[]): MimicTwitterCandidate[] {
  const byHandle = new Map<string, { handle: string; count: number; sample_urls: string[] }>();
  for (const c of coins) {
    for (const url of [c.twitter, c.website]) {
      if (!url) continue;
      const handle = extractHandle(url);
      if (!handle) continue;
      const key = handle.toLowerCase();
      const entry = byHandle.get(key) ?? { handle, count: 0, sample_urls: [] };
      entry.count++;
      if (entry.sample_urls.length < 3) entry.sample_urls.push(url);
      byHandle.set(key, entry);
    }
  }
  // A dev's own handle recurs across unrelated deploys; one-off links are
  // per-token communities/source posts and carry no account signal.
  return [...byHandle.values()]
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

function toDeployRow(c: PumpfunCoin, classification: Classification): MimicDeployRow {
  return {
    mint: c.mint,
    name: c.name,
    ticker: c.symbol,
    description: c.description ? c.description.slice(0, 160) : null,
    created_at_iso: new Date(c.created_timestamp).toISOString(),
    ath_usd: c.ath_market_cap ?? null,
    bonded: c.complete,
    classification,
    fees: {
      cashback: c.is_cashback_enabled ?? null,
      holder_rewards: c.is_holder_reward ?? null,
      transfer_fee_bps: c.transfer_fee_bps ?? null,
    },
    vanity_pump_mint: c.mint.endsWith("pump"),
    socials: {
      ...(c.twitter ? { twitter: c.twitter } : {}),
      ...(c.telegram ? { telegram: c.telegram } : {}),
      ...(c.website ? { website: c.website } : {}),
    },
    thesis_category: null, // filled from stored theses below
  };
}

function buildStats(coins: PumpfunCoin[], enumerated: EnumeratedToken[]): MimicStats {
  const windowTokens: WindowToken[] = enumerated.map((t) => ({
    ...t,
    classification: classify(t.bonded, t.athUsd),
  }));
  const fp = computeFingerprint(windowTokens);

  const tickerLens = coins.map((c) => c.symbol.length);
  const nameLens = coins.map((c) => c.name.length);
  const descLens = coins.filter((c) => c.description?.trim()).map((c) => c.description!.trim().length);
  const letters = (s: string) => s.replace(/[^A-Za-z]/g, "");
  const caseOf = (s: string): "all_upper" | "all_lower" | "mixed" => {
    const l = letters(s);
    if (l && l === l.toUpperCase()) return "all_upper";
    if (l && l === l.toLowerCase()) return "all_lower";
    return "mixed";
  };
  const tickerCase = { all_upper: 0, all_lower: 0, mixed: 0 };
  for (const c of coins) tickerCase[caseOf(c.symbol)]++;

  const times = coins.map((c) => c.created_timestamp);
  return {
    deploy_count: coins.length,
    window_from_iso: times.length ? new Date(Math.min(...times)).toISOString() : null,
    window_to_iso: times.length ? new Date(Math.max(...times)).toISOString() : null,
    classification_counts: { success: fp.counts.success, mid: fp.counts.mid, failed: fp.counts.failed },
    deploys_per_day: fp.deploysPerDay,
    median_gap_minutes: fp.medianGapMinutes,
    peak_hour_utc: fp.peakHourUtc,
    ath_usd: fp.athUsd,
    naming_buckets: fp.namingPatterns,
    ticker_length: { min: tickerLens.length ? Math.min(...tickerLens) : null, median: median(tickerLens), max: tickerLens.length ? Math.max(...tickerLens) : null },
    name_length: { min: nameLens.length ? Math.min(...nameLens) : null, median: median(nameLens), max: nameLens.length ? Math.max(...nameLens) : null },
    ticker_case: tickerCase,
    description_use: {
      empty: coins.filter((c) => !c.description?.trim()).length,
      median_length: median(descLens),
      max_length: descLens.length ? Math.max(...descLens) : null,
    },
    socials_use: {
      twitter: coins.filter((c) => c.twitter).length,
      telegram: coins.filter((c) => c.telegram).length,
      website: coins.filter((c) => c.website).length,
      none: coins.filter((c) => !c.twitter && !c.telegram && !c.website).length,
    },
    fee_use: {
      holder_rewards: coins.filter((c) => c.is_holder_reward).length,
      cashback: coins.filter((c) => c.is_cashback_enabled).length,
      transfer_fee: coins.filter((c) => (c.transfer_fee_bps ?? 0) > 0).length,
      plain: coins.filter((c) => !c.is_holder_reward && !c.is_cashback_enabled && !((c.transfer_fee_bps ?? 0) > 0)).length,
    },
    vanity_pump_count: coins.filter((c) => c.mint.endsWith("pump")).length,
  };
}

function latestThesisFor(mint: string): { category: string; text: string } | null {
  const row = db
    .select()
    .from(schema.theses)
    .where(eq(schema.theses.mint, mint))
    .all()
    .filter((t) => !(t.json as { generation_failed?: boolean }).generation_failed)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!row) return null;
  const j = row.json as { narrative_category?: string; thesis?: string };
  if (!j.thesis) return null;
  return { category: j.narrative_category ?? "unknown", text: j.thesis.slice(0, 600) };
}

/** M1 — build the deterministic digest (free pump.fun calls + image downloads). */
export async function buildMimicDigest(
  wallet: string,
  emit: (ev: Omit<ScanEvent, "scanId" | "at">) => void
): Promise<{ digest: MimicDigest; pumpfunCalls: number }> {
  const windowN = scanDefaults.mimic.window_n;
  emit({ type: "progress", message: `Enumerating the last ${windowN} deploys (free pump.fun calls)…` });
  const enumerated = await pumpfun.enumerateCreatedTokens!(wallet, windowN);
  if (enumerated.length === 0) {
    throw new Error(`${wallet} has no pump.fun deploys (after policy filters) — nothing to study.`);
  }
  const pages = Math.ceil(enumerated.length / 50);

  // One free batch resolves fee flags (is_holder_reward / transfer_fee_bps),
  // which enumeration mapping drops.
  const batch = await getCoinsBatch(enumerated.map((t) => t.mint));
  const byMint = new Map(batch.coins.map((c) => [c.mint, c]));
  const coins = enumerated.map((t) => byMint.get(t.mint)).filter((c): c is PumpfunCoin => c != null);
  emit({
    type: "progress",
    message: `${coins.length} deploys digested (${batch.mayhemExcluded.length} mayhem-excluded in batch).`,
  });

  const rows = coins.map((c) => {
    const row = toDeployRow(c, classify(c.complete, c.ath_market_cap ?? null));
    row.thesis_category = latestThesisFor(c.mint)?.category ?? null;
    return row;
  });

  // Exemplars: top performers by ATH + most recent, capped images for vision.
  const { exemplar_top, exemplar_recent, image_cap } = scanDefaults.mimic;
  const byAth = [...coins].sort((a, b) => (b.ath_market_cap ?? 0) - (a.ath_market_cap ?? 0));
  const picked = new Map<string, "top_ath" | "recent">();
  for (const c of byAth.slice(0, exemplar_top)) picked.set(c.mint, "top_ath");
  for (const c of coins.slice(0, exemplar_recent)) if (!picked.has(c.mint)) picked.set(c.mint, "recent");

  const exemplars: MimicExemplar[] = [];
  for (const [mint, selection] of picked) {
    const c = byMint.get(mint)!;
    let imagePath: string | null = null;
    if (exemplars.filter((e) => e.image_attached).length < image_cap && c.image_uri) {
      imagePath = await downloadImage(mint, c.image_uri);
      if (!imagePath) emit({ type: "log", message: `image download failed on all gateways for ${c.symbol} (${mint})` });
    }
    exemplars.push({
      mint,
      name: c.name,
      ticker: c.symbol,
      description: c.description ? c.description.slice(0, 400) : null,
      created_at_iso: new Date(c.created_timestamp).toISOString(),
      ath_usd: c.ath_market_cap ?? null,
      bonded: c.complete,
      classification: classify(c.complete, c.ath_market_cap ?? null),
      fees: {
        cashback: c.is_cashback_enabled ?? null,
        holder_rewards: c.is_holder_reward ?? null,
        transfer_fee_bps: c.transfer_fee_bps ?? null,
      },
      vanity_pump_mint: mint.endsWith("pump"),
      selection,
      thesis: latestThesisFor(mint),
      image_path: imagePath,
      image_attached: imagePath != null,
    });
  }
  emit({
    type: "progress",
    message: `${exemplars.length} exemplars selected, ${exemplars.filter((e) => e.image_attached).length} images downloaded.`,
  });

  const deployer = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, wallet)).get();
  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, wallet)).get();
  const candidates = buildTwitterCandidates(coins);
  if (candidates.length > 0) {
    emit({
      type: "progress",
      message: `X-handle candidates: ${candidates.map((c) => `@${c.handle} (×${c.count})`).join(", ")}.`,
    });
  }

  return {
    digest: {
      wallet,
      alias: deployer?.name ?? null,
      built_at_iso: new Date().toISOString(),
      stats: buildStats(coins, enumerated),
      deploys: rows,
      exemplars,
      twitter_candidates: candidates,
      profile_verdict: profile?.verdictSnippet ?? null,
    },
    pumpfunCalls: pages + batch.calls,
  };
}

async function executeMimicStudy(id: string): Promise<void> {
  let study = getMimicStudy(id);
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) => scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  setStatus(id, "running");
  emit({ type: "resumed", message: "Mimic study running." });

  try {
    // M1 — digest (checkpointed; free calls only).
    if (!study.digest) {
      const { digest, pumpfunCalls } = await buildMimicDigest(study.wallet, emit);
      db.update(schema.mimicStudies)
        .set({
          digest: digest as unknown as Record<string, unknown>,
          deployCount: digest.deploys.length,
          quotaSpent: { pumpfun: pumpfunCalls },
        })
        .where(eq(schema.mimicStudies.id, id))
        .run();
      study = getMimicStudy(id);
    } else {
      emit({ type: "log", message: "Digest already cached on this study — skipping enumeration." });
    }

    // M2 — Layer B study (idempotent).
    if (!study.study) {
      const digest = study.digest as unknown as MimicDigest;
      emit({ type: "agent", message: "Synthesizing the deploy-pattern study (Claude)…" });
      const images = digest.exemplars
        .filter((e) => e.image_attached && e.image_path)
        .map((e) => ({ path: e.image_path!, label: `${e.name} ($${e.ticker})` }));

      let result: MimicStudy | null = null;
      let prompt = buildMimicPrompt(digest);
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        try {
          result = await runAgentJson(prompt, mimicStudySchema, {
            model: reasoningConfig.mimic_model,
            maxTurns: reasoningConfig.max_turns_mimic,
            jsonSchema: mimicStudyJsonSchema as unknown as Record<string, unknown>,
            images,
            onActivity: (m) => emit({ type: "agent", message: `  ${m}` }),
          });
          if (result.wallet !== study.wallet) {
            throw new AgentOutputError(`wallet mismatch: got ${result.wallet}, expected ${study.wallet}`);
          }
        } catch (err) {
          if (err instanceof AgentOutputError && attempt === 1) {
            emit({ type: "log", message: `Study output failed validation — retrying once. ${err.message.slice(0, 200)}` });
            prompt = `${buildMimicPrompt(digest)}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly this and try again:\n${err.message}`;
            continue;
          }
          throw err;
        }
      }

      // Mechanical gates (same philosophy as the narrative URL gate): example
      // mints must come from the digest, the handle from the candidate list —
      // invented references are dropped loudly, never kept.
      const known = new Set(digest.deploys.map((d) => d.mint));
      const kept = result!.example_mappings.filter((m) => known.has(m.mint));
      if (kept.length < result!.example_mappings.length) {
        emit({
          type: "log",
          message: `Dropped ${result!.example_mappings.length - kept.length} example mapping(s) with mints outside the digest.`,
        });
        result!.example_mappings = kept;
      }
      const handles = new Set(digest.twitter_candidates.map((c) => c.handle.toLowerCase()));
      if (result!.twitter_handle && !handles.has(result!.twitter_handle.toLowerCase())) {
        emit({ type: "log", message: `Dropped un-sourced X handle "@${result!.twitter_handle}" — not in the candidate list.` });
        result!.twitter_handle = null;
      }
      if (!result!.twitter_handle) result!.twitter_style_md = null;

      db.update(schema.mimicStudies)
        .set({ study: result as unknown as Record<string, unknown>, promptVersion: MIMIC_PROMPT_VERSION })
        .where(eq(schema.mimicStudies.id, id))
        .run();
      emit({
        type: "progress",
        message: `Study formed: ${result!.example_mappings.length} example mappings, confidence ${result!.confidence}${result!.twitter_handle ? `, X account @${result!.twitter_handle}` : ""}.`,
      });
    }

    setStatus(id, "done");
    emit({ type: "done", message: "Mimic study complete." });
  } catch (err) {
    if (err instanceof RateLimitPause) {
      setStatus(id, "paused", err.message);
      emit({ type: "paused", message: err.message });
      emit({ type: "log", message: `Auto-resume in ${RATE_LIMIT_RESUME_MS / 60000} min.` });
      setTimeout(() => {
        const s = getMimicStudy(id);
        if (s.status === "paused") startMimicStudy(id);
      }, RATE_LIMIT_RESUME_MS).unref();
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    setStatus(id, "failed", reason);
    emit({ type: "error", message: reason });
  }
}

/** On server boot: surface mimic studies that were running when the process died. */
export function recoverInterruptedMimicStudies(): void {
  const rows = db.select().from(schema.mimicStudies).where(eq(schema.mimicStudies.status, "running")).all();
  for (const row of rows) {
    setStatus(row.id, "paused", "process restarted mid-study — resume manually");
  }
}
