import { z } from "zod";
import { providerConfig } from "../config.js";
import { providerFetch } from "./http.js";
import { SchemaValidationError, type Candle, type DataProvider } from "./types.js";

/**
 * Provider 4 — GeckoTerminal public API (keyless). Last-resort OHLCV; ATH is
 * computed locally from candles (PLAN.md §5.2).
 * TODO-VERIFY: pool-address format for pump.fun bonding-curve pools on
 * GeckoTerminal (graduated tokens list their pumpswap/raydium pool).
 */

const ohlcvSchema = z.object({
  data: z.object({
    attributes: z.object({
      // [ts, open, high, low, close, volume]
      ohlcv_list: z.array(z.array(z.number()).min(6)),
    }),
  }),
});

export const geckoterminal: DataProvider = {
  name: "geckoterminal",

  async getOhlcv(poolAddress): Promise<Candle[]> {
    const base = providerConfig.providers.geckoterminal!.base_url;
    const url = `${base}/networks/solana/pools/${poolAddress}/ohlcv/day?aggregate=1&limit=1000&currency=usd`;
    const raw = await providerFetch("geckoterminal", url);
    const parsed = ohlcvSchema.safeParse(raw);
    if (!parsed.success) throw new SchemaValidationError("geckoterminal", parsed.error.message.slice(0, 500));
    return parsed.data.data.attributes.ohlcv_list.map((c) => ({
      ts: c[0]! * 1000,
      open: c[1]!,
      high: c[2]!,
      low: c[3]!,
      close: c[4]!,
      volume: c[5]!,
    }));
  },
};
