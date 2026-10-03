import type { EnumeratedToken } from "../providers/types.js";

export const STAGES = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"] as const;
export type StageId = (typeof STAGES)[number];

export const STAGE_LABELS: Record<StageId, string> = {
  s1: "Enumerate deploys + lifetime context",
  s2: "Exact scoring + classification",
  s3: "Dossier selection",
  s4: "Dossier enrichment",
  s5: "Per-token theses (Claude)",
  s6: "Profile synthesis (Claude)",
  s7: "Store & index",
};

export type Classification = "worked" | "mid" | "failed";

export interface StageState {
  status: "pending" | "running" | "done";
  [key: string]: unknown;
}

export interface Fingerprint {
  windowDays: number;
  deploysPerDay: number;
  medianGapMinutes: number | null;
  activeHoursUtc: number[]; // 24 buckets
  peakHourUtc: number | null;
  inferredTimezoneGuess: string | null;
  bondRate: number;
  counts: { worked: number; mid: number; failed: number; total: number };
  athUsd: { median: number | null; p90: number | null; max: number | null };
  namingPatterns: Record<string, number>;
  lifespanHours: { median: number | null; p90: number | null };
  cashbackShare: number | null;
  devBuyNote: string;
}

export interface DossierEntry {
  mint: string;
  reason: string; // why selected (top|mid|failure-cluster:<theme>|pinned)
  classification: Classification | "pinned";
}

export interface ScanEvent {
  type: "stage" | "progress" | "agent" | "paused" | "resumed" | "done" | "error" | "log";
  scanId: string;
  stage?: StageId;
  message: string;
  current?: number;
  total?: number;
  at: number;
}

export interface ScanCtx {
  scanId: string;
  wallet: string;
  alias: string | null;
  windowN: number;
  pinnedMints: string[];
  emit: (ev: Omit<ScanEvent, "scanId" | "at">) => void;
  pauseRequested: () => boolean;
}

export class ScanPausedError extends Error {
  constructor(public readonly reason: string) {
    super(`Scan paused: ${reason}`);
    this.name = "ScanPausedError";
  }
}

export type WindowToken = EnumeratedToken & { classification?: Classification };
