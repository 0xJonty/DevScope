import { bands } from "../config.js";
import { MissingCredentialError } from "../config.js";
import { getWindowTokens, setTokenAth, type TokenRow } from "../db/tokens.js";
import { fetchAthWithFailover } from "../providers/index.js";
import { assertHeadroom } from "../providers/quota.js";
import { getScan, getStageState, patchStageState, recordQuotaSpent } from "./checkpoint.js";
import { computeFingerprint } from "./fingerprint.js";
import { ScanPausedError, type Classification, type ScanCtx, type WindowToken } from "./types.js";

export function classify(bonded: boolean, athUsd: number | null): Classification {
  if (bonded) return "worked";
  if (athUsd != null && athUsd > bands.mid_min_ath_usd) return "mid";
  return "failed";
}

function rowToWindowToken(r: TokenRow): WindowToken {
  return {
    mint: r.mint,
    wallet: r.wallet,
    name: r.name,
    ticker: r.ticker,
    description: r.description,
    imageUri: r.imageUri,
    socials: r.socials ?? {},
    createdAt: r.createdAt,
    bonded: r.bonded,
    cashback: r.cashback,
    athUsd: r.athUsd,
    athAt: r.athAt,
    athSource: (r.athSource as WindowToken["athSource"]) ?? null,
    lastTradeAt: r.lastTradeAt,
    replyCount: r.replyCount,
    poolAddress: r.poolAddress,
    usdMarketCap: null,
    classification: classify(r.bonded, r.athUsd),
  };
}

/**
 * S2 — Exact scoring. Non-bonded tokens already carry a free USD ATH from the
 * pump.fun enumeration payload (verified 2026-10-03). Only bonded tokens hit
 * the quota'd provider: pump.fun's ath_market_cap is unverified for
 * post-graduation trading (TODO-VERIFY), and bonded tokens are dossier
 * headliners, so they get the authoritative Solana Tracker ATH. Permanent
 * cache: a token whose ATH already came from solanatracker/geckoterminal is
 * never re-fetched unless it traded after that fetch.
 */
export async function runS2(ctx: ScanCtx): Promise<void> {
  const scan = getScan(ctx.scanId);
  if (scan.windowFrom == null || scan.windowTo == null) {
    patchStageState(ctx.scanId, "s2", { fingerprint: computeFingerprint([]), scored: true });
    return;
  }

  const rows = getWindowTokens(ctx.wallet, scan.windowFrom, scan.windowTo);
  const needsFetch = rows.filter((r) => {
    const cachedAuthoritative =
      (r.athSource === "solanatracker" || r.athSource === "geckoterminal") &&
      !(r.lastTradeAt != null && r.lastTradeAt > r.fetchedAt - 60_000 && r.bonded);
    if (cachedAuthoritative) return false;
    if (r.bonded) return true; // bonded → authoritative ATH required
    return r.athUsd == null; // non-bonded without any ATH (pump.fun gap)
  });

  const state = getStageState(ctx.scanId, "s2");
  const done = new Set<string>((state.fetchedMints as string[]) ?? []);
  const todo = needsFetch.filter((r) => !done.has(r.mint));

  if (todo.length > 0) {
    assertHeadroom("solanatracker", todo.length);
    ctx.emit({
      type: "progress",
      stage: "s2",
      message: `Fetching authoritative ATH for ${todo.length} token(s) (quota'd)…`,
      current: done.size,
      total: needsFetch.length,
    });
  }

  for (const [i, row] of todo.entries()) {
    if (ctx.pauseRequested()) throw new ScanPausedError("pause requested");
    try {
      const ath = await fetchAthWithFailover(row.mint, row.poolAddress);
      setTokenAth(row.mint, ath.athUsd, ath.athAt, ath.source);
      recordQuotaSpent(ctx.scanId, ath.source, 1);
    } catch (err) {
      if (err instanceof MissingCredentialError) {
        throw new ScanPausedError(`S2 ATH scoring needs ${err.variable} — ${err.message}`);
      }
      throw err;
    }
    done.add(row.mint);
    patchStageState(ctx.scanId, "s2", { fetchedMints: [...done] });
    ctx.emit({
      type: "progress",
      stage: "s2",
      message: `ATH ${i + 1}/${todo.length}: ${row.ticker}`,
      current: done.size,
      total: needsFetch.length,
    });
  }

  const scored = getWindowTokens(ctx.wallet, scan.windowFrom, scan.windowTo).map(rowToWindowToken);
  const fingerprint = computeFingerprint(scored);
  patchStageState(ctx.scanId, "s2", { fingerprint, scored: true });
  ctx.emit({
    type: "progress",
    stage: "s2",
    message: `Classified ${fingerprint.counts.total}: ${fingerprint.counts.worked} worked / ${fingerprint.counts.mid} mid / ${fingerprint.counts.failed} failed (bond rate ${(fingerprint.bondRate * 100).toFixed(1)}%).`,
  });
}
