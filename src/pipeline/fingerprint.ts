import type { Fingerprint, WindowToken } from "./types.js";

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

/** Regex buckets per PLAN.md §7 S2. A token can hit several buckets. */
const NAMING_BUCKETS: Record<string, RegExp> = {
  dictionary_word: /^[A-Za-z]{4,12}$/,
  short_caps_ticker: /^[A-Z]{2,5}$/,
  has_emoji: /\p{Extended_Pictographic}/u,
  ai_theme: /\b(ai|agent|gpt|claude|llm|neural|bot)\b/i,
  animal_theme: /\b(dog|doge|cat|kitty|pepe|frog|bear|bull|ape|monkey|bird|shib|inu|hamster|capybara)\b/i,
  person_name: /\b(elon|trump|musk|biden|kanye|taylor|messi|ronaldo|vitalik|cz|sbf)\b/i,
  numbers: /\d/,
  all_lowercase: /^[a-z\s]+$/,
};

export function computeFingerprint(tokens: WindowToken[]): Fingerprint {
  const counts = { worked: 0, mid: 0, failed: 0, total: tokens.length };
  for (const t of tokens) {
    if (t.classification) counts[t.classification]++;
  }

  const times = tokens.map((t) => t.createdAt).sort((a, b) => a - b);
  const first = times[0] ?? Date.now();
  const last = times[times.length - 1] ?? Date.now();
  const windowDays = Math.max((last - first) / 86_400_000, 1 / 24);

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push((times[i]! - times[i - 1]!) / 60_000);

  const hours = new Array<number>(24).fill(0);
  for (const t of tokens) {
    const h = new Date(t.createdAt).getUTCHours();
    hours[h] = (hours[h] ?? 0) + 1;
  }
  const peak = tokens.length ? hours.indexOf(Math.max(...hours)) : null;
  // Rough heuristic: assume deploys cluster around local afternoon/evening (14–22).
  const tzGuess =
    peak == null
      ? null
      : `UTC${peak >= 18 ? "-" + (24 - peak + 18 - 18) : peak < 10 ? "+" + (18 - peak) : "±0"}-ish if deploys peak ~18:00 local (heuristic, peak UTC hour ${peak})`;

  const aths = tokens.filter((t) => t.athUsd != null).map((t) => t.athUsd!);

  const naming: Record<string, number> = {};
  for (const [bucket, re] of Object.entries(NAMING_BUCKETS)) {
    naming[bucket] = tokens.filter((t) => re.test(t.name) || re.test(t.ticker)).length;
  }

  const lifespans = tokens
    .filter((t) => t.lastTradeAt != null && t.lastTradeAt > t.createdAt)
    .map((t) => (t.lastTradeAt! - t.createdAt) / 3_600_000);

  const cashbackKnown = tokens.filter((t) => t.cashback != null);

  return {
    windowDays: Number(windowDays.toFixed(2)),
    deploysPerDay: Number((tokens.length / windowDays).toFixed(2)),
    medianGapMinutes: median(gaps),
    activeHoursUtc: hours,
    peakHourUtc: peak,
    inferredTimezoneGuess: tzGuess,
    bondRate: counts.total ? Number((counts.worked / counts.total).toFixed(4)) : 0,
    counts,
    athUsd: { median: median(aths), p90: percentile(aths, 90), max: aths.length ? Math.max(...aths) : null },
    namingPatterns: naming,
    lifespanHours: { median: median(lifespans), p90: percentile(lifespans, 90) },
    cashbackShare: cashbackKnown.length
      ? Number((cashbackKnown.filter((t) => t.cashback).length / cashbackKnown.length).toFixed(4))
      : null,
    devBuyNote:
      "dev-buy sizes not exposed by pump.fun enumeration API (verified 2026-10-03); available per-token via trade history only — out of v1 quota budget",
  };
}
