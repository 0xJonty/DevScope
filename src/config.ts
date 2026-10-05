import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");

export class MissingCredentialError extends Error {
  constructor(public readonly variable: string, hint: string) {
    super(
      `Missing credential: ${variable} is not set in .env — ${hint}. ` +
        `Copy .env.example to .env and fill it in. Nothing will be mocked in its place.`
    );
    this.name = "MissingCredentialError";
  }
}

const bandsSchema = z.object({
  bands_version: z.string(),
  mid_min_ath_usd: z.number(),
});

const scanDefaultsSchema = z.object({
  window_n: z.number(),
  window_max: z.number(),
  dossier: z.object({
    top: z.number(),
    mids: z.number(),
    failures_min: z.number(),
    failures_max: z.number(),
    cap: z.number(),
    cap_absolute: z.number(),
    lifetime_top_k: z.number(),
  }),
  min_history_warn: z.number(),
});

const providersSchema = z.object({
  providers: z.record(
    z.string(),
    z.object({
      base_url: z.string(),
      soft_limit_month: z.number(),
      page_size: z.number().optional(),
      throttle_ms: z.number(),
    })
  ),
  retry: z.object({
    attempts: z.number(),
    backoff_ms: z.number(),
    backoff_factor: z.number(),
  }),
});

function loadJson<T>(rel: string, schema: z.ZodType<T>): T {
  const raw = JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid config file ${rel}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const bands = loadJson("config/bands.json", bandsSchema);
export const scanDefaults = loadJson("config/scan-defaults.json", scanDefaultsSchema);
export const providerConfig = loadJson("config/providers.json", providersSchema);

export const config = {
  root: ROOT,
  port: Number(process.env.PORT ?? 5717),
  dataDir: resolve(ROOT, process.env.DATA_DIR ?? "./data"),
  profilesDir: resolve(ROOT, process.env.PROFILES_DIR ?? "./profiles"),
  authMode: (process.env.AUTH_MODE ?? "subscription") as "subscription" | "api_key",
};

/** Keys are validated lazily at the point of use so keyless features still run. */
export function requireEnv(variable: "SOLANA_TRACKER_API_KEY" | "BITQUERY_API_KEY" | "ANTHROPIC_API_KEY"): string {
  const hints: Record<string, string> = {
    SOLANA_TRACKER_API_KEY: "free key at https://www.solanatracker.io/data-api",
    BITQUERY_API_KEY: "create an access token at https://account.bitquery.io",
    ANTHROPIC_API_KEY: "only needed when AUTH_MODE=api_key",
  };
  const value = process.env[variable];
  if (!value || value.trim() === "") {
    throw new MissingCredentialError(variable, hints[variable] ?? "see .env.example");
  }
  return value.trim();
}

/**
 * Subscription-auth guard (PLAN.md §8). In subscription mode a stray
 * ANTHROPIC_API_KEY must never silently bill — abort loudly instead.
 */
export function assertAuthMode(): void {
  if (config.authMode === "subscription" && process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "AUTH GUARD: AUTH_MODE=subscription but ANTHROPIC_API_KEY is set. " +
        "Refusing to start — the Agent SDK would silently bill that key. " +
        "Unset ANTHROPIC_API_KEY or set AUTH_MODE=api_key explicitly."
    );
  }
  if (config.authMode === "api_key") {
    requireEnv("ANTHROPIC_API_KEY");
  }
}
