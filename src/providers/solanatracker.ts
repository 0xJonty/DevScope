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
 *   GET /search                 — filter search (vamp-scan window enumeration)
 * TODO-VERIFY (needs live key): auth header name is assumed `x-api-key` per
 * docs convention; OpenAPI names the scheme "apiKey". Confirm with smoke test.
 * VERIFIED LIVE 2026-10-09: `/search` works filter-only (no `query`) on the
 * free tier — `minCreatedAt`/`maxCreatedAt` (unix ms) reach arbitrary history,
 * `market=pumpfun` restricts cleanly, `limit` max 500 per page with
 * page-number pagination (`hasMore` flags truncation). A 10-minute global
 * window returned 347 pump.fun deploys in one page.
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

const searchPageSchema = z.looseObject({
  status: z.string(),
  data: z.array(
    z.looseObject({
      mint: z.string().min(32),
      name: z.string().nullish(),
      symbol: z.string().nullish(),
      deployer: z.string().nullish(),
      createdAt: z.number(),
      market: z.string().nullish(),
    })
  ),
  hasMore: z.boolean().nullish(),
});

/** One pump.fun deploy found by the vamp-scan window search (lean on purpose —
 * full metadata + ATH come from the free pump.fun batch lookup afterwards). */
export interface WindowToken {
  mint: string;
  name: string | null;
  ticker: string | null;
  deployer: string | null;
  createdAt: number;
}

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

/**
 * Vamp-scan window enumeration (verified live 2026-10-09): every pump.fun
 * deploy created inside [fromMs, toMs]. Filter-only `/search` with
 * `market=pumpfun` + `minCreatedAt`/`maxCreatedAt`; 500-row pages. Quota'd —
 * callers assertHeadroom first and record `calls` against their scan.
 * `maxPages` caps runaway windows (3 pages = 1,500 deploys ≫ any ±5min
 * window at the observed ~35 deploys/min global rate).
 */
export async function searchWindowTokens(
  fromMs: number,
  toMs: number,
  maxPages = 3
): Promise<{ tokens: WindowToken[]; calls: number }> {
  const tokens: WindowToken[] = [];
  let calls = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${base()}/search?market=pumpfun&minCreatedAt=${fromMs}&maxCreatedAt=${toMs}` +
      `&sortBy=createdAt&sortOrder=asc&limit=500&page=${page}`;
    const raw = await providerFetch("solanatracker", url, { headers: headers() });
    calls++;
    const parsed = searchPageSchema.safeParse(raw);
    if (!parsed.success) throw new SchemaValidationError("solanatracker", parsed.error.message.slice(0, 500));
    for (const row of parsed.data.data) {
      // The window bounds are the contract — drop anything the API lets slip
      // (curated/promoted rows can ride along on search responses).
      if (row.createdAt < fromMs || row.createdAt > toMs) continue;
      tokens.push({
        mint: row.mint,
        name: row.name ?? null,
        ticker: row.symbol ?? null,
        deployer: row.deployer ?? null,
        createdAt: row.createdAt,
      });
    }
    if (!parsed.data.hasMore) break;
  }
  return { tokens, calls };
}
