/**
 * Vamp-scan V3 — deterministic candidate ranking (PLAN.md §7c). Pure text +
 * magnitude heuristics; deliberately loose. The score only decides which
 * candidates make the Layer B shortlist — the agent (with vision on the
 * images) makes the actual same-narrative call, so a differently-named vamp
 * must still be able to ride in on ATH + launch proximity alone.
 * No image hashing here: the agent's visual comparison outperforms a pHash
 * and the extra native dependency isn't worth it at this scale.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "coin", "token", "pump", "fun",
  "meme", "crypto", "sol", "solana", "official", "its", "his", "her", "are",
  "was", "you", "your", "not", "but", "has", "have", "will", "just", "from",
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
  );
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 — edit-distance similarity of normalized strings. */
function editSim(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

/** 0..1 — Jaccard overlap of meaningful words. */
function wordOverlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

export interface SimilarityInput {
  name: string;
  ticker: string;
  description: string | null;
}

export interface SimilarityParts {
  textSim: number;
  score: number;
}

/**
 * Rank a candidate against the scanned token. Weights: text identity is the
 * strongest deterministic vamp signal we have (0.5), but ATH magnitude (0.3)
 * and launch proximity (0.2) keep differently-named same-narrative deploys
 * in the shortlist — the whole point of handing the final call to Layer B.
 */
export function scoreCandidate(
  scanned: SimilarityInput,
  candidate: SimilarityInput & { athUsd: number | null; createdDeltaMs: number },
  windowMs: number,
  athFloorUsd: number
): SimilarityParts {
  const tickerSim = editSim(scanned.ticker, candidate.ticker);
  const nameSim = Math.max(
    editSim(scanned.name, candidate.name),
    wordOverlap(scanned.name, candidate.name),
    // Cross-field: a vamp often uses the original's NAME as its TICKER or vice versa.
    editSim(scanned.name, candidate.ticker),
    editSim(scanned.ticker, candidate.name)
  );
  const descSim =
    scanned.description && candidate.description ? wordOverlap(scanned.description, candidate.description) : 0;
  const textSim = Math.max(tickerSim, nameSim) * 0.8 + descSim * 0.2;

  // log-scaled ATH weight above the floor: $10k floor → 0, ~$1M → 1.
  const ath = candidate.athUsd ?? 0;
  const athWeight = ath > athFloorUsd ? Math.min(1, Math.log10(ath / athFloorUsd) / 2) : 0;

  const proximity = Math.max(0, 1 - Math.abs(candidate.createdDeltaMs) / windowMs);

  return { textSim, score: textSim * 0.5 + athWeight * 0.3 + proximity * 0.2 };
}
