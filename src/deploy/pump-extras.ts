import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  getExtensionData,
  unpackMint,
} from "@solana/spl-token";
import { unpack as unpackTokenMetadata } from "@solana/spl-token-metadata";
import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { z } from "zod";
import { config } from "../config.js";
import { getConnection } from "./solana.js";

/**
 * Pump.fun-specific deploy extras (PLAN.md §7e, 0.15.0):
 *  - supported quote mints ("pairing") straight from the chain via
 *    `fetchSupportedQuoteMints` (SOL + Global whitelist + QuoteControl PDA);
 *  - verified-charity search + donate.gg config creation, the exact flow
 *    pump.fun's own frontend uses (extracted from its bundle 2026-10-12):
 *    keyless GET /donate/charities/search on fun-block.pump.fun, authenticated
 *    POST /donate/configs returning the on-chain configId pubkey.
 *
 * The donate-config POST requires a pump.fun session cookie (401 otherwise) —
 * pasted once in Settings → Wallets and stored at data/pump-auth.json (0600).
 */

const FUN_BLOCK = "https://fun-block.pump.fun";
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/create",
};

// ── pump.fun session (for the donate-config POST) ─────────────────────────

const PUMP_AUTH_FILE = "pump-auth.json";

function pumpAuthPath(): string {
  return resolve(config.dataDir, PUMP_AUTH_FILE);
}

export function setPumpSession(cookie: string): void {
  writeFileSync(pumpAuthPath(), JSON.stringify({ cookie: cookie.trim() }, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function clearPumpSession(): void {
  if (existsSync(pumpAuthPath())) rmSync(pumpAuthPath());
}

export function getPumpSession(): string | null {
  if (!existsSync(pumpAuthPath())) return null;
  const parsed = JSON.parse(readFileSync(pumpAuthPath(), "utf8")) as { cookie?: string };
  return parsed.cookie?.trim() || null;
}

// ── verified charity search (keyless) ─────────────────────────────────────

const charitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().nullish(),
  logo: z.string().nullish(),
  website: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
  isEnabled: z.boolean().nullish(),
});
const charitySearchSchema = z.object({
  pageKey: z.string().nullish(),
  response: z.array(charitySchema),
});
export type Charity = z.infer<typeof charitySchema>;

export async function searchCharities(term: string, limit = 8): Promise<Charity[]> {
  const params = new URLSearchParams({ term, limit: String(limit) });
  const res = await fetch(`${FUN_BLOCK}/donate/charities/search?${params}`, {
    headers: BROWSER_HEADERS,
  });
  if (!res.ok) throw new Error(`charity search failed: HTTP ${res.status}`);
  const parsed = charitySearchSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`charity search response shape: ${parsed.error.message}`);
  return parsed.data.response.filter((c) => c.isEnabled !== false);
}

// ── donate.gg config creation (needs the pump.fun session) ────────────────

const donateConfigSchema = z.object({ id: z.string().min(32) });

export class PumpSessionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "PumpSessionError";
  }
}

/**
 * Create a donate.gg config for the charity split and return its on-chain
 * configId. `weights` follow pump.fun's integer-weight convention (one weight
 * per charity, proportional to its shareBps).
 */
export async function createDonateConfig(
  beneficiaries: Array<{ charityId: string; weight: number }>
): Promise<PublicKey> {
  const cookie = getPumpSession();
  if (!cookie) {
    throw new PumpSessionError(
      "charity deploys need a pump.fun session — paste your pump.fun cookie in Settings → Wallets"
    );
  }
  const res = await fetch(`${FUN_BLOCK}/donate/configs`, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ charityBeneficiaries: beneficiaries }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new PumpSessionError(
      `pump.fun session rejected (HTTP ${res.status}) — re-paste a fresh cookie in Settings → Wallets`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`donate config creation failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const parsed = donateConfigSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`donate config response shape: ${parsed.error.message}`);
  return new PublicKey(parsed.data.id);
}

/** Pump.fun's integer-weight convention for the donate config (mirrors the
 * frontend's computeIntegerWeights: bps divided by their GCD). */
export function charityWeights(shareBps: number[]): number[] {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = shareBps.reduce((acc, v) => gcd(acc, v), 0) || 1;
  return shareBps.map((v) => v / g);
}

// ── supported quote mints ("pairing") ─────────────────────────────────────

export interface QuoteOption {
  mint: string;
  symbol: string;
  decimals: number;
  source: string;
}

const KNOWN_SYMBOLS: Record<string, string> = {
  [NATIVE_MINT.toBase58()]: "SOL",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
};

const pumpBatchSchema = z.array(
  z.object({ mint: z.string(), symbol: z.string().nullish() }).loose()
);

let quotesCache: { at: number; quotes: QuoteOption[] } | null = null;

/**
 * Supported quotes with symbols + decimals, in a handful of BULK calls only
 * (the naive per-mint resolveQuoteMint path is ~380 RPC round-trips for the
 * ~190-mint QuoteControl list — it hung the public RPC in testing):
 * getMultipleAccountsInfo batches give decimals and the Token-2022 metadata
 * symbol (covers the xStocks); one pump.fun /coins/mints batch names the
 * pump-born quotes; known constants cover SOL/USDC; short mints otherwise.
 */
export async function getSupportedQuotes(): Promise<QuoteOption[]> {
  if (quotesCache && Date.now() - quotesCache.at < 10 * 60_000) return quotesCache.quotes;
  const connection = getConnection();
  const sdk = new OnlinePumpSdk(connection);
  const supported = await sdk.fetchSupportedQuoteMints();

  const symbols = new Map<string, string>(Object.entries(KNOWN_SYMBOLS));
  const decimals = new Map<string, number>([[NATIVE_MINT.toBase58(), 9]]);

  const toFetch = supported.map((q) => q.mint).filter((m) => !m.equals(NATIVE_MINT));
  for (let i = 0; i < toFetch.length; i += 100) {
    const batch = toFetch.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(batch).catch(() => []);
    for (let j = 0; j < batch.length; j++) {
      const info = infos[j];
      const key = batch[j]!.toBase58();
      if (!info) continue;
      try {
        const mint = unpackMint(batch[j]!, info, info.owner);
        decimals.set(key, mint.decimals);
        if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          const data = getExtensionData(ExtensionType.TokenMetadata, mint.tlvData);
          if (data) {
            const meta = unpackTokenMetadata(data);
            if (meta.symbol) symbols.set(key, meta.symbol);
          }
        }
      } catch {
        /* unreadable mint — dropped below for missing decimals */
      }
    }
  }

  const unnamed = toFetch.map((m) => m.toBase58()).filter((m) => !symbols.has(m));
  if (unnamed.length > 0) {
    try {
      const res = await fetch("https://frontend-api-v3.pump.fun/coins/mints", {
        method: "POST",
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
        body: JSON.stringify({ mints: unnamed.slice(0, 500) }),
      });
      if (res.ok) {
        const rows = pumpBatchSchema.safeParse(await res.json());
        if (rows.success) {
          for (const row of rows.data) if (row.symbol) symbols.set(row.mint, row.symbol);
        }
      }
    } catch {
      /* symbol enrichment only — short mints remain readable */
    }
  }

  const quotes: QuoteOption[] = supported
    .filter((q) => decimals.has(q.mint.toBase58()))
    .map((q) => {
      const mint = q.mint.toBase58();
      return {
        mint,
        symbol: symbols.get(mint) ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`,
        decimals: decimals.get(mint)!,
        source: q.source,
      };
    });
  // SOL, then USDC, then alphabetical.
  quotes.sort((a, b) =>
    a.symbol === "SOL" ? -1 : b.symbol === "SOL" ? 1 :
    a.symbol === "USDC" ? -1 : b.symbol === "USDC" ? 1 :
    a.symbol.localeCompare(b.symbol)
  );
  quotesCache = { at: Date.now(), quotes };
  return quotes;
}
