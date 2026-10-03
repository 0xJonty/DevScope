import { pumpfun } from "./pumpfun.js";
import { solanatracker } from "./solanatracker.js";
import { bitquery } from "./bitquery.js";
import { geckoterminal } from "./geckoterminal.js";
import type { AthResult, DataProvider } from "./types.js";

/** Priority order per PLAN.md §5.2. */
export const providers: DataProvider[] = [pumpfun, solanatracker, bitquery, geckoterminal];

export { pumpfun, solanatracker, bitquery, geckoterminal };

/**
 * ATH with failover: Solana Tracker (authoritative, quota'd) → GeckoTerminal
 * candles (keyless, needs a pool address). Loud combined error when all fail.
 */
export async function fetchAthWithFailover(mint: string, poolAddress: string | null): Promise<AthResult> {
  const errors: string[] = [];
  try {
    return await solanatracker.getTokenAth!(mint);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (poolAddress) {
    try {
      const candles = await geckoterminal.getOhlcv!(poolAddress);
      if (candles.length > 0) {
        const best = candles.reduce((a, b) => (b.high > a.high ? b : a));
        // Candle highs are token prices in USD; pump.fun supply is 1B.
        return { athUsd: best.high * 1_000_000_000, athAt: best.ts, source: "geckoterminal" };
      }
      errors.push("[geckoterminal] empty candle list");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    errors.push("[geckoterminal] skipped: no pool address for this token");
  }
  throw new Error(`ATH unavailable for ${mint} from all providers:\n${errors.join("\n")}`);
}
