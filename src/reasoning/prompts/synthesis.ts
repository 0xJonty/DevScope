/**
 * Profile-synthesis prompt — versioned (PLAN.md §8). Bump PROMPT_VERSION on
 * any change that could shift outputs; profiles record it.
 */
// v1.1.0 (2026-10-05): dropped playbook_signals_md — the tool's purpose is
// studying deploy styles as reference for the owner's own deploys, not
// trade-signal generation; removing it cuts synthesis cost and output noise.
export const SYNTHESIS_PROMPT_VERSION = "synthesis-v1.1.0";

export interface SynthesisInput {
  wallet: string;
  alias: string | null;
  window: { n: number; from: string | null; to: string | null };
  lifetime: {
    total_deploys: number | null;
    total_graduated: number | null;
    best_ath_usd: number | null;
    best_mint: string | null;
  };
  fingerprint: Record<string, unknown>;
  bands: { worked: string; mid_min_ath_usd: number };
  theses: Array<Record<string, unknown>>;
  prior_profile_md: string | null;
}

export function buildSynthesisPrompt(input: SynthesisInput): string {
  return `You are synthesizing a persistent intelligence profile of a pump.fun deployer wallet from (a) a deterministic statistical fingerprint and (b) per-token AI theses that were each independently researched and evidence-linked.

WALLET: ${input.wallet}${input.alias ? ` (alias: ${input.alias})` : ""}
SCAN WINDOW: last ${input.window.n} deploys, ${input.window.from ?? "?"} → ${input.window.to ?? "?"}
LIFETIME CONTEXT: ${JSON.stringify(input.lifetime)}
CLASSIFICATION BANDS USED: ${JSON.stringify(input.bands)}

STATISTICAL FINGERPRINT (deterministic, trust it):
${JSON.stringify(input.fingerprint, null, 2)}

PER-TOKEN THESES (${input.theses.length} tokens; each has confidence + evidence flags — weight high-confidence theses more):
${JSON.stringify(input.theses, null, 2)}
${input.prior_profile_md ? `\nPRIOR PROFILE (this is a re-scan — update it with the new evidence; keep conclusions that still hold, revise ones the new data contradicts):\n${input.prior_profile_md}` : ""}

TASK — produce the reasoning sections of this deployer's profile. The reader is
another deployer studying this wallet's style as reference for their own
deploys — focus on what deploy choices (narrative type, timing, naming, image
effort, cadence) separate their hits from their misses:
- verdict: 3–5 line tl;dr. What kind of deployer is this, what actually drives their hits, what about their style is worth copying or avoiding.
- what_works_md: deploy/narrative types ranked by hit rate for THIS wallet, with concrete token examples (name + ticker) and the deploy choices behind them.
- what_fails_md: what reliably fails for them, with examples and the common factor in the failures.
- open_questions_md: anomalies, low-confidence areas, attribution oddities, what a future scan should check.

HARD RULES:
- Ground every pattern claim in the fingerprint numbers or specific theses; cite token names when making an example.
- Distinguish clearly between high-confidence patterns (multiple evidence-backed theses agree) and weak signals (single low-confidence thesis).
- No fabricated statistics: if the fingerprint does not contain a number, do not invent one.`;
}
