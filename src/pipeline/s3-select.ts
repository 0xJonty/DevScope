import { scanDefaults, MissingCredentialError } from "../config.js";
import { getScan, getStageState, patchStageState, recordQuotaSpent } from "./checkpoint.js";
import { getWindowTokens, getTokensByMints, upsertEnumeratedToken, setTokenAth } from "../db/tokens.js";
import { solanatracker } from "../providers/index.js";
import { classify } from "./s2-score.js";
import { ScanPausedError, type DossierEntry, type ScanCtx } from "./types.js";

interface Candidate {
  mint: string;
  name: string;
  ticker: string;
  createdAt: number;
  bonded: boolean;
  athUsd: number | null;
  lastTradeAt: number | null;
  replyCount: number | null;
}

const THEME_RES: Record<string, RegExp> = {
  ai: /\b(ai|agent|gpt|bot)\b/i,
  animal: /\b(dog|doge|cat|pepe|frog|inu|shib|ape)\b/i,
  person: /\b(elon|trump|musk|kanye|vitalik)\b/i,
  emoji: /\p{Extended_Pictographic}/u,
  caps_ticker: /^[A-Z]{2,5}$/,
};

function theme(c: Candidate): string {
  for (const [name, re] of Object.entries(THEME_RES)) {
    if (re.test(c.name) || re.test(c.ticker)) return name;
  }
  return "other";
}

/** Instructive failures: had some life (replies / traded for a while) then died. */
function instructiveness(c: Candidate): number {
  const lifespanH = c.lastTradeAt && c.lastTradeAt > c.createdAt ? (c.lastTradeAt - c.createdAt) / 3.6e6 : 0;
  return (c.replyCount ?? 0) * 2 + Math.min(lifespanH, 72) + (c.athUsd ?? 0) / 1000;
}

/**
 * S3 — Dossier selection (PLAN.md §7): top 10 by ATH (bonded first), 2–3
 * "almost made it" mids, 5–8 failures sampled across theme+time clusters
 * weighted toward instructive ones, plus user-pinned mints (fetched ad hoc
 * when out of window). Hard cap 20 (25 absolute).
 */
export async function runS3(ctx: ScanCtx): Promise<void> {
  const scan = getScan(ctx.scanId);
  const d = scanDefaults.dossier;
  const rows =
    scan.windowFrom != null && scan.windowTo != null
      ? getWindowTokens(ctx.wallet, scan.windowFrom, scan.windowTo)
      : [];
  const cands: Candidate[] = rows.map((r) => ({
    mint: r.mint,
    name: r.name,
    ticker: r.ticker,
    createdAt: r.createdAt,
    bonded: r.bonded,
    athUsd: r.athUsd,
    lastTradeAt: r.lastTradeAt,
    replyCount: r.replyCount,
  }));

  const byClass = {
    worked: cands.filter((c) => classify(c.bonded, c.athUsd) === "worked"),
    mid: cands.filter((c) => classify(c.bonded, c.athUsd) === "mid"),
    failed: cands.filter((c) => classify(c.bonded, c.athUsd) === "failed"),
  };

  const selection: DossierEntry[] = [];
  const picked = new Set<string>();
  const push = (mint: string, reason: string, classification: DossierEntry["classification"]) => {
    if (!picked.has(mint) && selection.length < d.cap_absolute) {
      picked.add(mint);
      selection.push({ mint, reason, classification });
    }
  };

  // Top N by ATH, bonded first.
  const tops = [...cands].sort(
    (a, b) => Number(b.bonded) - Number(a.bonded) || (b.athUsd ?? 0) - (a.athUsd ?? 0)
  );
  for (const c of tops.slice(0, d.top)) push(c.mint, "top by ATH", classify(c.bonded, c.athUsd));

  // Mids: highest ATH below migration — "almost made it".
  const mids = [...byClass.mid].sort((a, b) => (b.athUsd ?? 0) - (a.athUsd ?? 0));
  for (const c of mids.slice(0, d.mids)) push(c.mint, "almost made it (highest non-bonded ATH)", "mid");

  // Failures: cluster by theme + week, sample across clusters by instructiveness.
  const clusters = new Map<string, Candidate[]>();
  for (const c of byClass.failed) {
    const key = `${theme(c)}:${Math.floor(c.createdAt / (7 * 86_400_000))}`;
    clusters.set(key, [...(clusters.get(key) ?? []), c]);
  }
  const clusterList = [...clusters.entries()].map(([key, members]) => ({
    key,
    members: members.sort((a, b) => instructiveness(b) - instructiveness(a)),
  }));
  clusterList.sort((a, b) => b.members.length - a.members.length);
  const failureTarget = Math.min(d.failures_max, Math.max(d.failures_min, clusterList.length));
  let fi = 0;
  while (selection.filter((s) => s.classification === "failed").length < failureTarget && clusterList.length > 0) {
    const cluster = clusterList[fi % clusterList.length]!;
    const next = cluster.members.shift();
    fi++;
    if (next) push(next.mint, `failure cluster ${cluster.key}`, "failed");
    if (clusterList.every((cl) => cl.members.length === 0)) break;
  }

  // Trim to soft cap, preserving tops > mids > failures order already enforced.
  while (selection.length > d.cap) selection.pop();

  // Pinned mints (incl. out-of-window, e.g. lifetime best) — fetched ad hoc.
  for (const mint of ctx.pinnedMints) {
    if (picked.has(mint)) continue;
    const known = getTokensByMints([mint])[0];
    if (!known) {
      ctx.emit({ type: "progress", stage: "s3", message: `Fetching pinned out-of-window token ${mint}…` });
      try {
        const detail = await solanatracker.getTokenDetail!(mint);
        upsertEnumeratedToken({ ...detail, wallet: detail.wallet || ctx.wallet });
        const ath = await solanatracker.getTokenAth!(mint);
        setTokenAth(mint, ath.athUsd, ath.athAt, ath.source);
        recordQuotaSpent(ctx.scanId, "solanatracker", 2);
      } catch (err) {
        if (err instanceof MissingCredentialError) {
          throw new ScanPausedError(`S3 pinned-token fetch needs ${err.variable} — ${err.message}`);
        }
        throw err;
      }
    }
    push(mint, "user-pinned", "pinned");
  }

  patchStageState(ctx.scanId, "s3", { selection, done: true });
  ctx.emit({
    type: "progress",
    stage: "s3",
    message: `Dossier: ${selection.length} tokens (${selection.filter((s) => s.classification === "worked").length} worked, ${selection.filter((s) => s.classification === "mid").length} mid, ${selection.filter((s) => s.classification === "failed").length} failed, ${selection.filter((s) => s.classification === "pinned").length} pinned).`,
  });
}
