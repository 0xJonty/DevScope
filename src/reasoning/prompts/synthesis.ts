/**
 * Profile-synthesis prompt — versioned (PLAN.md §8). Bump PROMPT_VERSION on
 * any change that could shift outputs; profiles record it.
 */
// v1.3.0 (2026-10-08): lifecycle-reality framing (quantity-over-quality
// deployer model; judge deploys by ATH + narrative caught, never
// sustainability/long-term performance); verdict must describe style
// positively (no "not a X deployer" constructions).
// v1.2.0 (2026-10-05): verdict reframed as deployer description (style trends
// only, no stat recaps, dev X-handle detection); new deployer_patterns_md
// section dedupes cross-cutting habits out of works/fails; study-not-trade
// framing; no-fluff style rule. Theses arrive enriched with
// name/ticker/ath_usd/socials (see s6-synthesize).
// v1.1.0 (2026-10-05): dropped playbook_signals_md — the tool's purpose is
// studying deploy styles as reference for the owner's own deploys, not
// trade-signal generation.
export const SYNTHESIS_PROMPT_VERSION = "synthesis-v1.3.0";

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

This platform studies HOW deployers deploy. The reader is a deployer studying this wallet's style as reference for their own deploys — never a trader deciding whether to buy. No trader advice or trader phrasing ("fade their deploys", "bid the next one").

Lifecycle reality: pump.fun deploys live minutes to hours and nearly all retrace to zero — this deployer model is quantity over quality, and token longevity carries no information. Judge every deploy by the ATH it reached and the narrative it caught; never discuss token sustainability or long-term performance.

WALLET: ${input.wallet}${input.alias ? ` (alias: ${input.alias})` : ""}
SCAN WINDOW: last ${input.window.n} deploys, ${input.window.from ?? "?"} → ${input.window.to ?? "?"}
LIFETIME CONTEXT: ${JSON.stringify(input.lifetime)}
CLASSIFICATION BANDS USED: ${JSON.stringify(input.bands)}

STATISTICAL FINGERPRINT (deterministic, trust it — the UI displays these numbers already, so never restate them as prose):
${JSON.stringify(input.fingerprint, null, 2)}

PER-TOKEN THESES (${input.theses.length} tokens; each carries name/ticker/ath_usd/socials plus confidence + evidence flags — weight high-confidence theses more):
${JSON.stringify(input.theses, null, 2)}
${input.prior_profile_md ? `\nPRIOR PROFILE (this is a re-scan — update it with the new evidence; keep conclusions that still hold, revise ones the new data contradicts):\n${input.prior_profile_md}` : ""}

TASK — produce the reasoning sections of this deployer's profile:
- verdict — the deployer description, 3–5 lines. Do NOT restate fingerprint stats; the UI shows them beside this text. Describe what statistics cannot: the deploy style and trends you picked up — e.g. a consistent minimum ATH across launches suggesting bundled buys or snipers, a recognisable naming/image habit, an unusual timing fingerprint. If one X handle recurs across multiple tokens' socials, name it — it likely identifies the dev's X account. Describe the style positively — what they do, never "not a X deployer" constructions.
- deployer_patterns_md — cross-cutting habits that show up across hits AND misses (rapid relaunch cadence, paid dexscreener, bundling, image sourcing, social/handle reuse). State each pattern exactly once, here and nowhere else.
- what_works_md — deploy/narrative types ranked by hit rate for THIS wallet, each with concrete token examples (name + ticker) and the deploy choices behind them. Individual token stats are welcome; generalized deployer stats are not, and never repeat deployer_patterns_md.
- what_fails_md — what reliably fails for them, with token examples and the common factor in the failures. Same rules as what_works_md.
- open_questions_md — anomalies, low-confidence areas, attribution oddities, what a future scan should check.

STYLE: clean, readable, straight to the point. No fluff; every sentence carries information.

HARD RULES:
- Ground every pattern claim in the fingerprint numbers or specific theses; cite token names when making an example.
- Distinguish clearly between high-confidence patterns (multiple evidence-backed theses agree) and weak signals (single low-confidence thesis).
- No fabricated statistics: if the fingerprint does not contain a number, do not invent one.
- Never make the same point in two sections — cross-cutting observations live in deployer_patterns_md only.`;
}
