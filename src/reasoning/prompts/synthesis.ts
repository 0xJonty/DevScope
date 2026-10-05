/**
 * Profile-synthesis prompt — versioned (PLAN.md §8). Bump PROMPT_VERSION on
 * any change that could shift outputs; profiles record it.
 */
export const SYNTHESIS_PROMPT_VERSION = "synthesis-v1.0.0";

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

TASK — produce the reasoning sections of this deployer's profile:
- verdict: 3–5 line tl;dr. What kind of deployer is this, are they good, what is the single most actionable takeaway.
- what_works_md: narrative types ranked by their hit rate for THIS wallet, with concrete token examples (name + ticker).
- what_fails_md: what reliably fails for them, with examples.
- playbook_signals_md: actionable "if this wallet does X → historically Y" bullet signals a trader could act on.
- open_questions_md: anomalies, low-confidence areas, attribution oddities, what a future scan should check.

HARD RULES:
- Ground every pattern claim in the fingerprint numbers or specific theses; cite token names when making an example.
- Distinguish clearly between high-confidence patterns (multiple evidence-backed theses agree) and weak signals (single low-confidence thesis).
- No fabricated statistics: if the fingerprint does not contain a number, do not invent one.`;
}
