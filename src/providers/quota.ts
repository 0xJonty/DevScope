import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { providerConfig } from "../config.js";
import type { ProviderName } from "./types.js";

export class QuotaExceededError extends Error {
  constructor(provider: string, used: number, limit: number, estimate: number) {
    super(
      `Quota refusal for ${provider}: ${used}/${limit} calls used this month; ` +
        `the requested operation needs ~${estimate} more. Lower the scan window or wait for the monthly reset.`
    );
    this.name = "QuotaExceededError";
  }
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function softLimit(provider: ProviderName): number {
  return providerConfig.providers[provider]?.soft_limit_month ?? 0;
}

export function getUsage(provider: ProviderName): { used: number; limit: number; month: string } {
  const month = monthKey();
  const row = db
    .select()
    .from(schema.providerUsage)
    .where(and(eq(schema.providerUsage.provider, provider), eq(schema.providerUsage.month, month)))
    .get();
  return { used: row?.callsUsed ?? 0, limit: row?.softLimit ?? softLimit(provider), month };
}

export function getAllUsage(): Record<string, { used: number; limit: number }> {
  const out: Record<string, { used: number; limit: number }> = {};
  for (const p of Object.keys(providerConfig.providers) as ProviderName[]) {
    const { used, limit } = getUsage(p);
    out[p] = { used, limit };
  }
  return out;
}

export function remaining(provider: ProviderName): number {
  const { used, limit } = getUsage(provider);
  return Math.max(0, limit - used);
}

/** Refuse before starting work whose estimated cost exceeds headroom (PLAN.md §5.3). */
export function assertHeadroom(provider: ProviderName, estimatedCalls: number): void {
  const { used, limit } = getUsage(provider);
  if (used + estimatedCalls > limit) {
    throw new QuotaExceededError(provider, used, limit, estimatedCalls);
  }
}

/** Every real provider call runs through this: increments the ledger first. */
export function recordCall(provider: ProviderName, calls = 1): void {
  const month = monthKey();
  db.insert(schema.providerUsage)
    .values({ provider, month, callsUsed: calls, softLimit: softLimit(provider) })
    .onConflictDoUpdate({
      target: [schema.providerUsage.provider, schema.providerUsage.month],
      set: { callsUsed: sql`${schema.providerUsage.callsUsed} + ${calls}` },
    })
    .run();
  const { used, limit } = getUsage(provider);
  if (used > limit) {
    throw new QuotaExceededError(provider, used, limit, 0);
  }
}
