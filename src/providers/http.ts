import { setTimeout as sleep } from "node:timers/promises";
import { providerConfig } from "../config.js";
import { ProviderError, type ProviderName } from "./types.js";
import { recordCall } from "./quota.js";

const lastCallAt = new Map<ProviderName, number>();

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Set false for keyless calls that should not count (none currently). */
  metered?: boolean;
}

/**
 * Shared provider HTTP wrapper: per-provider throttle, retry with backoff,
 * ledger increment per real network call, loud typed failures. Never returns
 * partial/fake data (PLAN.md §11).
 */
export async function providerFetch(provider: ProviderName, url: string, opts: HttpOptions = {}): Promise<unknown> {
  const { retry } = providerConfig;
  const throttleMs = providerConfig.providers[provider]?.throttle_ms ?? 500;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    const since = Date.now() - (lastCallAt.get(provider) ?? 0);
    if (since < throttleMs) await sleep(throttleMs - since);
    lastCallAt.set(provider, Date.now());

    if (opts.metered !== false) recordCall(provider);

    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) deployer-intel/0.1",
          accept: "application/json",
          ...opts.headers,
        },
        body: opts.body,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new ProviderError(provider, `HTTP ${res.status} on ${url}`, res.status);
      } else if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        throw new ProviderError(provider, `HTTP ${res.status} on ${url}: ${text}`, res.status);
      } else {
        return await res.json();
      }
    } catch (err) {
      if (err instanceof ProviderError && err.status && err.status < 500 && err.status !== 429) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < retry.attempts) {
      await sleep(retry.backoff_ms * Math.pow(retry.backoff_factor, attempt - 1));
    }
  }
  throw lastError ?? new ProviderError(provider, `request failed after ${retry.attempts} attempts: ${url}`);
}
