import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, extname } from "node:path";
import { Readable } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";
import { config } from "../config.js";
import { getTokensByMints, setTokenCurveStats, setTokenImagePath } from "../db/tokens.js";
import { geckoterminal } from "../providers/index.js";
import { getStageState, patchStageState, recordQuotaSpent } from "./checkpoint.js";
import { ScanPausedError, type DossierEntry, type ScanCtx } from "./types.js";

/** ipfs.io rate-limits hard (observed 429s) — try pump.fun's own image CDN
 * first, then the original URI, then a Pinata gateway rewrite. */
function imageCandidates(mint: string, uri: string): string[] {
  const candidates = [`https://images.pump.fun/coin-image/${mint}?variant=256x256`, uri];
  const ipfsMatch = uri.match(/\/ipfs\/([A-Za-z0-9]+.*)$/);
  if (ipfsMatch) candidates.push(`https://gateway.pinata.cloud/ipfs/${ipfsMatch[1]}`);
  return candidates;
}

async function downloadImage(mint: string, uri: string): Promise<string | null> {
  const dir = join(config.dataDir, "images");
  await mkdir(dir, { recursive: true });
  for (const candidate of imageCandidates(mint, uri)) {
    try {
      const res = await fetch(candidate, {
        signal: AbortSignal.timeout(30_000),
        headers: { "user-agent": "Mozilla/5.0" },
        redirect: "follow",
      });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !res.body || !type.startsWith("image/")) continue;
      const ext = type.includes("png") ? ".png" : type.includes("gif") ? ".gif" : type.includes("webp") ? ".webp" : extname(new URL(candidate).pathname) || ".jpg";
      const path = join(dir, `${mint}${ext}`);
      await streamPipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
      return path;
    } catch {
      continue; // try next gateway; the caller logs if all fail
    }
  }
  return null;
}

/**
 * S4 — Dossier enrichment, selected tokens only: image download (vision input
 * for S5), price-curve summary. Curve stats come from GeckoTerminal daily
 * candles when a pool address exists; otherwise only time-to-ATH from cached
 * fields. Missing data stays null — never fabricated (PLAN.md rules).
 */
export async function runS4(ctx: ScanCtx): Promise<void> {
  const selection = (getStageState(ctx.scanId, "s3").selection ?? []) as DossierEntry[];
  const state = getStageState(ctx.scanId, "s4");
  const done = new Set<string>((state.enriched as string[]) ?? []);
  const rows = getTokensByMints(selection.map((s) => s.mint));

  for (const [i, row] of rows.entries()) {
    if (done.has(row.mint)) continue;
    if (ctx.pauseRequested()) throw new ScanPausedError("pause requested");
    ctx.emit({
      type: "progress",
      stage: "s4",
      message: `Enriching ${row.ticker} (${i + 1}/${rows.length})…`,
      current: i + 1,
      total: rows.length,
    });

    if (!row.imagePath && row.imageUri) {
      const path = await downloadImage(row.mint, row.imageUri);
      if (path) {
        setTokenImagePath(row.mint, path);
      } else {
        ctx.emit({ type: "log", stage: "s4", message: `image download failed on all gateways for ${row.mint}` });
      }
    }

    const curve: Record<string, unknown> = {
      time_to_ath_hours:
        row.athAt != null && row.athAt > row.createdAt ? (row.athAt - row.createdAt) / 3.6e6 : null,
      lifespan_hours:
        row.lastTradeAt != null && row.lastTradeAt > row.createdAt
          ? (row.lastTradeAt - row.createdAt) / 3.6e6
          : null,
      reply_count: row.replyCount,
    };
    if (row.poolAddress && row.bonded) {
      try {
        const candles = await geckoterminal.getOhlcv!(row.poolAddress);
        recordQuotaSpent(ctx.scanId, "geckoterminal", 1);
        if (candles.length > 0) {
          const peak = candles.reduce((a, b) => (b.high > a.high ? b : a));
          const after = candles.filter((c) => c.ts > peak.ts);
          curve.days_with_trades = candles.length;
          curve.total_volume_usd = candles.reduce((s, c) => s + c.volume, 0);
          curve.retrace_7d_after_ath =
            after.length > 0 && peak.high > 0 ? 1 - Math.min(...after.slice(0, 7).map((c) => c.low)) / peak.high : null;
        }
      } catch (err) {
        ctx.emit({ type: "log", stage: "s4", message: `candles unavailable for ${row.mint}: ${String(err)}` });
      }
    }
    setTokenCurveStats(row.mint, curve);

    done.add(row.mint);
    patchStageState(ctx.scanId, "s4", { enriched: [...done] });
  }
  patchStageState(ctx.scanId, "s4", { done: true });
}
