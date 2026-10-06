import { z } from "zod";
import { providerConfig } from "../config.js";
import { providerFetch } from "./http.js";
import {
  SchemaValidationError,
  type DataProvider,
  type EnumeratedToken,
} from "./types.js";

/**
 * Provider 1 — pump.fun unofficial frontend API (keyless, fragile).
 * VERIFIED LIVE 2026-10-03:
 *   GET {base}/coins?offset=&limit=&creator=<wallet>
 *   - descending created_timestamp, page hard-capped at 70 rows
 *   - includes usd_market_cap, ath_market_cap (USD), ath_market_cap_timestamp,
 *     complete (= bonded), is_cashback_enabled, socials, image_uri
 * VERIFIED 2026-10-05: ath_market_cap DOES cover post-graduation DEX trading
 * (observed $130.5M on a graduated token — far above any graduation cap), but
 * it can lag low vs Solana Tracker on recent graduates, so bonded tokens keep
 * the max-merge with Solana Tracker's ATH (see pipeline S2).
 * Also verified: `sort=ath_market_cap&order=DESC` works with the creator
 * filter — one free call returns a wallet's all-time top deploys by ATH.
 * VERIFIED LIVE 2026-10-07: mayhem-mode launches (opt-in AI agent randomly
 * trades an extra 1B-token supply for 24h — a gambling chart, not a deploy
 * worth studying) carry `mayhem_state` ('active' | 'paused' | 'completed');
 * the field is ABSENT on normal coins. Mayhem rows are dropped here at the
 * provider boundary so they can never reach the DB, stats, or dossiers.
 */

const coinSchema = z.object({
  mint: z.string().min(32),
  name: z.string(),
  symbol: z.string(),
  description: z.string().nullish(),
  image_uri: z.string().nullish(),
  twitter: z.string().nullish(),
  telegram: z.string().nullish(),
  website: z.string().nullish(),
  creator: z.string().min(32),
  created_timestamp: z.number(),
  complete: z.boolean(),
  is_cashback_enabled: z.boolean().nullish(),
  usd_market_cap: z.number().nullish(),
  ath_market_cap: z.number().nullish(),
  ath_market_cap_timestamp: z.number().nullish(),
  last_trade_timestamp: z.number().nullish(),
  reply_count: z.number().nullish(),
  pool_address: z.string().nullish(),
  mayhem_state: z.string().nullish(),
});

/** Mints dropped by the mayhem filter in the most recent enumerate/top call.
 * Single-user sequential pipeline — read right after the call (S1 uses it to
 * purge stale cached rows and report the exclusion in the scan feed). */
let lastMayhemExcluded: string[] = [];
export function getMayhemExcludedMints(): string[] {
  return lastMayhemExcluded;
}

function isMayhem(c: z.infer<typeof coinSchema>): boolean {
  return c.mayhem_state != null;
}

const coinsPageSchema = z.array(z.looseObject(coinSchema.shape));

function toEnumerated(c: z.infer<typeof coinSchema>): EnumeratedToken {
  return {
    mint: c.mint,
    wallet: c.creator,
    name: c.name,
    ticker: c.symbol,
    description: c.description ?? null,
    imageUri: c.image_uri ?? null,
    socials: {
      ...(c.twitter ? { twitter: c.twitter } : {}),
      ...(c.telegram ? { telegram: c.telegram } : {}),
      ...(c.website ? { website: c.website } : {}),
    },
    createdAt: c.created_timestamp,
    bonded: c.complete,
    cashback: c.is_cashback_enabled ?? null,
    athUsd: c.ath_market_cap ?? null,
    athAt: c.ath_market_cap_timestamp ?? null,
    athSource: c.ath_market_cap != null ? "pumpfun" : null,
    lastTradeAt: c.last_trade_timestamp ?? null,
    replyCount: c.reply_count ?? null,
    poolAddress: c.pool_address ?? null,
    usdMarketCap: c.usd_market_cap ?? null,
  };
}

export const pumpfun: DataProvider = {
  name: "pumpfun",

  async enumerateCreatedTokens(wallet, maxTokens, sinceMs) {
    const base = providerConfig.providers.pumpfun!.base_url;
    const pageSize = providerConfig.providers.pumpfun!.page_size ?? 50;
    const out: EnumeratedToken[] = [];
    let offset = 0;
    lastMayhemExcluded = [];

    while (out.length < maxTokens) {
      const url = `${base}/coins?offset=${offset}&limit=${pageSize}&creator=${wallet}&includeNsfw=true`;
      const raw = await providerFetch("pumpfun", url);
      const parsed = coinsPageSchema.safeParse(raw);
      if (!parsed.success) {
        throw new SchemaValidationError("pumpfun", parsed.error.message.slice(0, 500));
      }
      const page = parsed.data;
      if (page.length === 0) break;

      for (const c of page) {
        if (c.creator !== wallet) {
          throw new SchemaValidationError(
            "pumpfun",
            `creator filter returned foreign coin ${c.mint} (creator ${c.creator}) — endpoint shape changed`
          );
        }
        if (sinceMs != null && c.created_timestamp <= sinceMs) return out;
        if (isMayhem(c)) {
          lastMayhemExcluded.push(c.mint);
          continue;
        }
        out.push(toEnumerated(c));
        if (out.length >= maxTokens) break;
      }
      if (page.length < pageSize) break;
      offset += page.length;
    }
    return out;
  },
};

/**
 * All-time top deploys by ATH for a wallet — one free call via
 * `sort=ath_market_cap&order=DESC` (verified live 2026-10-05). This is how a
 * 22k-deploy wallet's $130M graduate gets found without archive access.
 */
export async function getTopCreatedByAth(wallet: string, limit: number): Promise<EnumeratedToken[]> {
  const base = providerConfig.providers.pumpfun!.base_url;
  const url = `${base}/coins?offset=0&limit=${limit}&creator=${wallet}&sort=ath_market_cap&order=DESC&includeNsfw=true`;
  const raw = await providerFetch("pumpfun", url);
  const parsed = coinsPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SchemaValidationError("pumpfun", parsed.error.message.slice(0, 500));
  }
  lastMayhemExcluded = [];
  for (const c of parsed.data) {
    if (c.creator !== wallet) {
      throw new SchemaValidationError(
        "pumpfun",
        `creator filter returned foreign coin ${c.mint} on ATH sort — endpoint shape changed`
      );
    }
    if (isMayhem(c)) lastMayhemExcluded.push(c.mint);
  }
  return parsed.data.filter((c) => !isMayhem(c)).map(toEnumerated);
}
