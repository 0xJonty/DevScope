import { sqliteTable, text, integer, real, primaryKey } from "drizzle-orm/sqlite-core";

/** PLAN.md §9.1 core tables. */

export const deployers = sqliteTable("deployers", {
  wallet: text("wallet").primaryKey(),
  name: text("name"),
  createdAt: integer("created_at").notNull(),
  lastScannedAt: integer("last_scanned_at"),
  lifetimeDeploys: integer("lifetime_deploys"),
  lifetimeGraduated: integer("lifetime_graduated"),
  lifetimeBestAthUsd: real("lifetime_best_ath_usd"),
  lifetimeBestMint: text("lifetime_best_mint"),
  linkedWallets: text("linked_wallets", { mode: "json" }).$type<string[]>(),
});

export const tokens = sqliteTable("tokens", {
  mint: text("mint").primaryKey(),
  wallet: text("wallet").notNull(),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  description: text("description"),
  imageUri: text("image_uri"),
  imagePath: text("image_path"),
  socials: text("socials", { mode: "json" }).$type<{ twitter?: string; telegram?: string; website?: string }>(),
  createdAt: integer("created_at").notNull(),
  bonded: integer("bonded", { mode: "boolean" }).notNull(),
  cashback: integer("cashback", { mode: "boolean" }),
  athUsd: real("ath_usd"),
  athAt: integer("ath_at"),
  athSource: text("ath_source"),
  lastTradeAt: integer("last_trade_at"),
  replyCount: integer("reply_count"),
  poolAddress: text("pool_address"),
  curveStats: text("curve_stats", { mode: "json" }).$type<Record<string, unknown>>(),
  fetchedAt: integer("fetched_at").notNull(),
});

export const scans = sqliteTable("scans", {
  id: text("id").primaryKey(),
  wallet: text("wallet").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status").notNull().$type<"running" | "paused" | "failed" | "done">(),
  statusReason: text("status_reason"),
  windowN: integer("window_n").notNull(),
  windowFrom: integer("window_from"),
  windowTo: integer("window_to"),
  bandsVersion: text("bands_version").notNull(),
  quotaSpent: text("quota_spent", { mode: "json" }).$type<Record<string, number>>(),
  stageState: text("stage_state", { mode: "json" }).$type<Record<string, unknown>>(),
  pinnedMints: text("pinned_mints", { mode: "json" }).$type<string[]>(),
});

/** Individual token research scans (Token Scan). The thesis lands in `theses`
 * keyed (mint, scan_id = token_scans.id) — same contract as deployer scans,
 * so dev-scan and token-scan results stay scoped by scan id with no overlap. */
export const tokenScans = sqliteTable("token_scans", {
  id: text("id").primaryKey(),
  mint: text("mint").notNull(),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status").notNull().$type<"running" | "paused" | "failed" | "done">(),
  statusReason: text("status_reason"),
  quotaSpent: text("quota_spent", { mode: "json" }).$type<Record<string, number>>(),
  /** "Include vamp scan" flag (0.10.0) — persisted so a resumed scan still chains it. */
  vampRequested: integer("vamp_requested", { mode: "boolean" }),
  /** Vamp scan chained after this token scan completed (null until then). */
  vampScanId: text("vamp_scan_id"),
});

/** One shortlisted vamp candidate (snapshot stored on the scan row — vamp
 * candidates deliberately never enter `tokens`, which would skew per-wallet
 * stats for any deployer who happens to own a candidate). */
export interface VampShortlistEntry {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  createdAt: number;
  athUsd: number | null;
  athAt: number | null;
  bonded: boolean;
  deployer: string;
  sameDeployer: boolean;
  cashback: boolean | null;
  holderReward: boolean | null;
  transferFeeBps: number | null;
  replyCount: number | null;
  imageUri: string | null;
  imagePath: string | null;
  score: number;
}

/** Vamp Scan runs (PLAN.md §7c) — opt-in PvP analysis around one token's
 * launch window. The verdict lands in `vamp_verdicts` keyed (mint, scan id). */
export const vampScans = sqliteTable("vamp_scans", {
  id: text("id").primaryKey(),
  mint: text("mint").notNull(),
  /** Deployer-scan or token-scan id that spawned it (null = started from a token page). */
  triggerScanId: text("trigger_scan_id"),
  startedAt: integer("started_at").notNull(),
  finishedAt: integer("finished_at"),
  status: text("status").notNull().$type<"running" | "paused" | "failed" | "done">(),
  statusReason: text("status_reason"),
  windowMinutes: integer("window_minutes").notNull(),
  athFloorUsd: real("ath_floor_usd").notNull(),
  candidatesTotal: integer("candidates_total"),
  candidatesFiltered: integer("candidates_filtered"),
  /** V1 checkpoint: raw window enumeration (so a resume never re-spends the
   * quota'd search). Lean rows — full metadata comes from the free V2 batch. */
  windowTokens: text("window_tokens", { mode: "json" }).$type<
    Array<{ mint: string; createdAt: number; deployer: string | null }>
  >(),
  shortlist: text("shortlist", { mode: "json" }).$type<VampShortlistEntry[]>(),
  quotaSpent: text("quota_spent", { mode: "json" }).$type<Record<string, number>>(),
});

export const vampVerdicts = sqliteTable(
  "vamp_verdicts",
  {
    mint: text("mint").notNull(),
    vampScanId: text("vamp_scan_id").notNull(),
    json: text("json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.mint, t.vampScanId] })]
);

export const theses = sqliteTable(
  "theses",
  {
    mint: text("mint").notNull(),
    scanId: text("scan_id").notNull(),
    json: text("json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.mint, t.scanId] })]
);

export const profiles = sqliteTable("profiles", {
  wallet: text("wallet").primaryKey(),
  filePath: text("file_path").notNull(),
  updatedAt: integer("updated_at").notNull(),
  verdictSnippet: text("verdict_snippet"),
});

export const providerUsage = sqliteTable(
  "provider_usage",
  {
    provider: text("provider").notNull(),
    month: text("month").notNull(), // YYYY-MM
    callsUsed: integer("calls_used").notNull().default(0),
    softLimit: integer("soft_limit").notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.month] })]
);
