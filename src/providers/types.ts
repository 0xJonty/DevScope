export type ProviderName = "pumpfun" | "solanatracker" | "bitquery" | "geckoterminal";

/** Normalized token record produced by enumeration (PLAN.md §5.1). */
export interface EnumeratedToken {
  mint: string;
  wallet: string;
  name: string;
  ticker: string;
  description: string | null;
  imageUri: string | null;
  socials: { twitter?: string; telegram?: string; website?: string };
  createdAt: number; // ms epoch
  bonded: boolean;
  cashback: boolean | null;
  athUsd: number | null;
  athAt: number | null;
  athSource: ProviderName | null;
  lastTradeAt: number | null;
  replyCount: number | null;
  poolAddress: string | null;
  usdMarketCap: number | null;
}

export interface AthResult {
  athUsd: number;
  athAt: number | null;
  source: ProviderName;
}

export interface LifetimeStats {
  totalDeploys: number;
  /** Lifetime graduated-token count (Solana Tracker exposes it for free in the same call). */
  graduatedCount: number | null;
  bestAthUsd: number | null;
  bestMint: string | null;
  bestAt: number | null;
}

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * PLAN.md §5.2 — every provider sits behind this interface. Methods are
 * optional capabilities; the registry routes by priority order.
 */
export interface DataProvider {
  readonly name: ProviderName;
  enumerateCreatedTokens?(wallet: string, maxTokens: number, sinceMs?: number): Promise<EnumeratedToken[]>;
  getTokenAth?(mint: string): Promise<AthResult>;
  getTokenDetail?(mint: string): Promise<EnumeratedToken>;
  getLifetimeStats?(wallet: string): Promise<LifetimeStats>;
  getOhlcv?(poolAddress: string): Promise<Candle[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    message: string,
    public readonly status?: number
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

export class SchemaValidationError extends Error {
  constructor(public readonly provider: ProviderName, detail: string) {
    super(`[${provider}] response failed schema validation: ${detail}`);
    this.name = "SchemaValidationError";
  }
}
