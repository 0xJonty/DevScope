import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "./index.js";
import type { EnumeratedToken } from "../providers/types.js";

export type TokenRow = typeof schema.tokens.$inferSelect;

/** An ATH that came from (or was max-merged with) a quota'd/candle provider —
 * never downgraded back to pump.fun's raw value. */
export function isAuthoritativeAthSource(source: string | null | undefined): boolean {
  return source != null && source !== "pumpfun";
}

/** Permanent cache (PLAN.md §5.4): upsert refreshes mutable fields only; an
 * authoritative ATH already on the row is never downgraded to pumpfun's. */
export function upsertEnumeratedToken(t: EnumeratedToken): void {
  const existing = db.select().from(schema.tokens).where(eq(schema.tokens.mint, t.mint)).get();
  const keepAth = isAuthoritativeAthSource(existing?.athSource);
  db.insert(schema.tokens)
    .values({
      mint: t.mint,
      wallet: t.wallet,
      name: t.name,
      ticker: t.ticker,
      description: t.description,
      imageUri: t.imageUri,
      socials: t.socials,
      createdAt: t.createdAt,
      bonded: t.bonded,
      cashback: t.cashback,
      athUsd: t.athUsd,
      athAt: t.athAt,
      athSource: t.athSource,
      lastTradeAt: t.lastTradeAt,
      replyCount: t.replyCount,
      poolAddress: t.poolAddress,
      fetchedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: schema.tokens.mint,
      set: {
        bonded: t.bonded,
        lastTradeAt: t.lastTradeAt,
        replyCount: t.replyCount,
        poolAddress: t.poolAddress,
        fetchedAt: Date.now(),
        ...(keepAth ? {} : { athUsd: t.athUsd, athAt: t.athAt, athSource: t.athSource }),
      },
    })
    .run();
}

export function getWindowTokens(wallet: string, fromMs: number, toMs: number): TokenRow[] {
  return db
    .select()
    .from(schema.tokens)
    .where(
      and(eq(schema.tokens.wallet, wallet), gte(schema.tokens.createdAt, fromMs), lte(schema.tokens.createdAt, toMs))
    )
    .orderBy(desc(schema.tokens.createdAt))
    .all();
}

export function getTokensByMints(mints: string[]): TokenRow[] {
  if (mints.length === 0) return [];
  return db.select().from(schema.tokens).where(inArray(schema.tokens.mint, mints)).all();
}

export function setTokenAth(mint: string, athUsd: number, athAt: number | null, source: string): void {
  db.update(schema.tokens)
    .set({ athUsd, athAt, athSource: source, fetchedAt: Date.now() })
    .where(eq(schema.tokens.mint, mint))
    .run();
}

export function setTokenImagePath(mint: string, imagePath: string): void {
  db.update(schema.tokens).set({ imagePath }).where(eq(schema.tokens.mint, mint)).run();
}

export function setTokenCurveStats(mint: string, curveStats: Record<string, unknown>): void {
  db.update(schema.tokens).set({ curveStats }).where(eq(schema.tokens.mint, mint)).run();
}
