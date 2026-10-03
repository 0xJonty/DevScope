import { z } from "zod";
import { providerConfig, requireEnv } from "../config.js";
import { providerFetch } from "./http.js";
import { SchemaValidationError, type DataProvider, type LifetimeStats } from "./types.js";

/**
 * Provider 3 — Bitquery GraphQL (EAP endpoint). Used for the two lifetime
 * aggregates (PLAN.md §7 S1): total deploy count + best-ever ATH.
 * VERIFIED from docs 2026-10-03: POST https://streaming.bitquery.io/eap,
 * Authorization: Bearer <token>. pump.fun program:
 * 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P, create methods create/create_v2.
 * TODO-VERIFY (needs live token): exact point cost of these two queries on the
 * free dev tier (10K points first month, 10 req/min).
 */

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

const countResponse = z.object({
  data: z.object({
    Solana: z.object({
      Instructions: z.array(z.object({ tokens_count: z.union([z.string(), z.number()]).nullish() })),
    }),
  }),
});

const athResponse = z.object({
  data: z.object({
    Solana: z.object({
      DEXTradeByTokens: z.array(
        z.object({
          Trade: z.object({
            Currency: z.object({ MintAddress: z.string() }),
            PriceInUSD: z.union([z.string(), z.number()]).nullish(),
          }),
          Block: z.object({ Time: z.string().nullish() }).nullish(),
        })
      ),
    }),
  }),
});

async function gql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const base = providerConfig.providers.bitquery!.base_url;
  return providerFetch("bitquery", base, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requireEnv("BITQUERY_API_KEY")}`,
    },
    body: JSON.stringify({ query, variables }),
  });
}

const COUNT_QUERY = `
query DeployCount($wallet: String!) {
  Solana(dataset: archive) {
    Instructions(
      where: {
        Instruction: { Program: { Address: { is: "${PUMP_PROGRAM}" }, Method: { in: ["create", "create_v2"] } } }
        Transaction: { Signer: { is: $wallet }, Result: { Success: true } }
      }
    ) {
      tokens_count: count
    }
  }
}`;

/**
 * Best-ever ATH across every token the wallet ever deployed: max trade price
 * in USD over the wallet's created tokens. Token supply on pump.fun is fixed
 * at 1B, so marketcap ≈ price × 1e9 (documented Bitquery pattern).
 */
const LIFETIME_ATH_QUERY = `
query LifetimeAth($wallet: String!) {
  Solana(dataset: archive) {
    DEXTradeByTokens(
      orderBy: { descendingByField: "Trade_PriceInUSD" }
      limit: { count: 1 }
      limitBy: { by: Trade_Currency_MintAddress, count: 1 }
      where: {
        Trade: { Currency: { UpdateAuthority: { is: $wallet } } }
        Transaction: { Result: { Success: true } }
      }
    ) {
      Trade {
        Currency { MintAddress }
        PriceInUSD(maximum: Trade_PriceInUSD)
      }
      Block { Time(maximum: Block_Time) }
    }
  }
}`;

export const bitquery: DataProvider = {
  name: "bitquery",

  async getLifetimeStats(wallet): Promise<LifetimeStats> {
    const countRaw = await gql(COUNT_QUERY, { wallet });
    const countParsed = countResponse.safeParse(countRaw);
    if (!countParsed.success) {
      throw new SchemaValidationError("bitquery", `deploy-count: ${JSON.stringify(countRaw).slice(0, 400)}`);
    }
    const totalDeploys = Number(countParsed.data.data.Solana.Instructions[0]?.tokens_count ?? 0);

    // TODO-VERIFY: UpdateAuthority == creator holds for pump.fun mints (docs
    // use this pattern); confirm with a live token before trusting best-ever ATH.
    const athRaw = await gql(LIFETIME_ATH_QUERY, { wallet });
    const athParsed = athResponse.safeParse(athRaw);
    if (!athParsed.success) {
      throw new SchemaValidationError("bitquery", `lifetime-ath: ${JSON.stringify(athRaw).slice(0, 400)}`);
    }
    const row = athParsed.data.data.Solana.DEXTradeByTokens[0];
    const price = row?.Trade.PriceInUSD != null ? Number(row.Trade.PriceInUSD) : null;
    return {
      totalDeploys,
      bestAthUsd: price != null ? price * 1_000_000_000 : null,
      bestMint: row?.Trade.Currency.MintAddress ?? null,
      bestAt: row?.Block?.Time ? Date.parse(row.Block.Time) : null,
    };
  },
};
