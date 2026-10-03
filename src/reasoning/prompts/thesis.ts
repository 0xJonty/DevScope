/**
 * Thesis prompt — versioned (PLAN.md §8). Bump PROMPT_VERSION on any change
 * that could shift outputs; profiles and theses record it.
 */
export const THESIS_PROMPT_VERSION = "thesis-v1.0.0";

export interface ThesisDossier {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  socials: Record<string, string>;
  created_at_iso: string;
  bonded: boolean;
  cashback_coin: boolean | null;
  ath_usd: number | null;
  ath_at_iso: string | null;
  classification: string;
  selection_reason: string;
  curve_stats: Record<string, unknown> | null;
  reply_count: number | null;
  image_path: string | null;
}

export function buildThesisPrompt(dossier: ThesisDossier): string {
  const { image_path, ...data } = dossier;
  return `You are analyzing a single pump.fun token deployed by a wallet under study, to explain WHY it performed the way it did.

TOKEN DOSSIER (deterministic data, trust it):
${JSON.stringify(data, null, 2)}

${image_path ? `TOKEN IMAGE: read the file at ${image_path} and assess it visually — effort level, AI-generated vs stolen vs original art, meme lineage. Image quality/style is a real deployment-style signal; report it in image_notes.` : "TOKEN IMAGE: none available."}

TASK:
1. Web-search for events in a ±48h window around the launch time (${data.created_at_iso}) relevant to the token's name/ticker/description: news, celebrity moments, crypto-twitter metas, trends it could be riding.
2. Decide the narrative category and timing position (first mover vs derivative).
3. Write a 3–8 sentence thesis for why it ${data.bonded ? "worked (graduated)" : data.classification === "mid" ? "almost worked but died pre-graduation" : "failed"}.

HARD RULES:
- Every factual claim about external events goes in "evidence" with the URL you actually found it at and found=true. If you looked and could not verify, include the claim with found=false.
- Unverified speculation must be explicitly labeled as speculation inside the thesis text.
- If evidence ends up empty, confidence MUST be "low".
- Historical X/Twitter reconstruction is weak for older tokens — say so in "unknowns" rather than guessing.
- The "mint" field must echo ${data.mint} exactly.`;
}
