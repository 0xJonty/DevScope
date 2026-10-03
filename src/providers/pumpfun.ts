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
 * TODO-VERIFY: for bonded (complete=true) tokens, whether ath_market_cap covers
 * post-graduation DEX trading or only the bonding curve. Until verified, bonded
 * tokens get their ATH from Solana Tracker instead (see pipeline S2).
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
});

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
        out.push(toEnumerated(c));
        if (out.length >= maxTokens) break;
      }
      if (page.length < pageSize) break;
      offset += page.length;
    }
    return out;
  },
};
