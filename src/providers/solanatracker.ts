import { z } from "zod";
import { providerConfig, requireEnv } from "../config.js";
import { providerFetch } from "./http.js";
import {
  SchemaValidationError,
  type AthResult,
  type DataProvider,
  type EnumeratedToken,
  type LifetimeStats,
} from "./types.js";

/**
 * Provider 2 — Solana Tracker Data API. THE quota'd provider (free tier:
 * 2,500 req/month @ 3 req/s, verified from docs 2026-10-03).
 * Endpoints (from the published OpenAPI spec):
 *   GET /tokens/{mint}          — token detail
 *   GET /tokens/{mint}/ath      — { highest_price, highest_market_cap, timestamp }
 *   GET /deployer/{wallet}      — tokens by deployer (failover enumeration)
 * TODO-VERIFY (needs live key): auth header name is assumed `x-api-key` per
 * docs convention; OpenAPI names the scheme "apiKey". Confirm with smoke test.
 */

const deployerPageSchema = z.looseObject({
  status: z.string(),
  total: z.number(),
  // Verified live 2026-10-05: an object { total, totalUniqueTokens, data[] }.
  graduated: z.union([z.number(), z.looseObject({ total: z.number() })]).nullish(),
});

const athSchema = z.object({
  highest_price: z.number().nullish(),
  highest_market_cap: z.number().nullish(),
  timestamp: z.number().nullish(),
});

const tokenDetailSchema = z.looseObject({
  token: z.looseObject({
    name: z.string(),
    symbol: z.string(),
    mint: z.string(),
    description: z.string().nullish(),
    image: z.string().nullish(),
    creator: z.string().nullish(),
    createdOn: z.union([z.string(), z.number()]).nullish(),
    twitter: z.string().nullish(),
    telegram: z.string().nullish(),
    website: z.string().nullish(),
    creation: z.looseObject({ creator: z.string().nullish(), created_time: z.number().nullish() }).nullish(),
  }),
  pools: z.array(z.looseObject({ marketCap: z.looseObject({ usd: z.number().nullish() }).nullish() })).nullish(),
});

function headers(): Record<string, string> {
  return { "x-api-key": requireEnv("SOLANA_TRACKER_API_KEY") };
}

function base(): string {
  return providerConfig.providers.solanatracker!.base_url;
}

export const solanatracker: DataProvider = {
  name: "solanatracker",

  /**
   * Lifetime context, one quota'd call (verified live 2026-10-05):
   * GET /deployer/{wallet}?page=1&limit=1 → { total, graduated, ... }.
   * Best-ever ATH is NOT available here; Bitquery's archive dataset has it but
   * needs a paid plan (free tier is realtime-only) — S1 enriches when it can.
   */
  async getLifetimeStats(wallet): Promise<LifetimeStats> {
    const raw = await providerFetch("solanatracker", `${base()}/deployer/${wallet}?page=1&limit=1`, {
      headers: headers(),
    });
    const parsed = deployerPageSchema.safeParse(raw);
    if (!parsed.success) throw new SchemaValidationError("solanatracker", parsed.error.message.slice(0, 500));
    const graduated = parsed.data.graduated;
    return {
      totalDeploys: parsed.data.total,
      graduatedCount: typeof graduated === "number" ? graduated : graduated?.total ?? null,
      bestAthUsd: null,
      bestMint: null,
      bestAt: null,
    };
  },

  async getTokenAth(mint): Promise<AthResult> {
    const raw = await providerFetch("solanatracker", `${base()}/tokens/${mint}/ath`, { headers: headers() });
    const parsed = athSchema.safeParse(raw);
    if (!parsed.success) throw new SchemaValidationError("solanatracker", parsed.error.message.slice(0, 500));
    if (parsed.data.highest_market_cap == null) {
      throw new SchemaValidationError("solanatracker", `no highest_market_cap for ${mint}`);
    }
    return {
      athUsd: parsed.data.highest_market_cap,
      athAt: parsed.data.timestamp ?? null,
      source: "solanatracker",
    };
  },

  async getTokenDetail(mint): Promise<EnumeratedToken> {
    const raw = await providerFetch("solanatracker", `${base()}/tokens/${mint}`, { headers: headers() });
    const parsed = tokenDetailSchema.safeParse(raw);
    if (!parsed.success) throw new SchemaValidationError("solanatracker", parsed.error.message.slice(0, 500));
    const t = parsed.data.token;
    const createdRaw = t.creation?.created_time ?? t.createdOn;
    const createdAt = typeof createdRaw === "number" ? (createdRaw < 1e12 ? createdRaw * 1000 : createdRaw) : 0;
    return {
      mint: t.mint,
      wallet: t.creation?.creator ?? t.creator ?? "",
      name: t.name,
      ticker: t.symbol,
      description: t.description ?? null,
      imageUri: t.image ?? null,
      socials: {
        ...(t.twitter ? { twitter: t.twitter } : {}),
        ...(t.telegram ? { telegram: t.telegram } : {}),
        ...(t.website ? { website: t.website } : {}),
      },
      createdAt,
      bonded: false, // unknown from this endpoint; caller must not overwrite a known flag
      cashback: null,
      athUsd: null,
      athAt: null,
      athSource: null,
      lastTradeAt: null,
      replyCount: null,
      poolAddress: null,
      usdMarketCap: parsed.data.pools?.[0]?.marketCap?.usd ?? null,
    };
  },
};
