/**
 * Mimic Dev study prompt — versioned (PLAN.md §7f). Bump MIMIC_PROMPT_VERSION
 * on any change that could shift outputs; studies record it.
 */
// v1.0.0 (2026-10-12): initial version. One Layer B run over the deterministic
// digest (last ~100 deploys + mechanical stats + exemplar images + X-handle
// candidates) producing a followable deploy playbook. Owner prompt standards:
// study-not-trade, positive assertions, ATH-centric performance judgment,
// canonical-spelling rule (describe the dev's habits exactly — never improve
// them), no fluff.
export const MIMIC_PROMPT_VERSION = "mimic-v1.0.0";

/** One deploy in the lean digest listing (all window deploys, newest first). */
export interface MimicDeployRow {
  mint: string;
  name: string;
  ticker: string;
  /** Truncated to 160 chars — exemplars carry fuller text. */
  description: string | null;
  created_at_iso: string;
  ath_usd: number | null;
  bonded: boolean;
  classification: "success" | "mid" | "failed";
  fees: {
    cashback: boolean | null;
    holder_rewards: boolean | null;
    transfer_fee_bps: number | null;
  };
  /** Mint ends in "pump" — a ground-out vanity address, a deliberate choice. */
  vanity_pump_mint: boolean;
  socials: { twitter?: string; telegram?: string; website?: string };
  /** narrative_category from a stored thesis when this mint was studied before. */
  thesis_category: string | null;
}

/** Mechanical stats over the digest window (Layer A, trust them). */
export interface MimicStats {
  deploy_count: number;
  window_from_iso: string | null;
  window_to_iso: string | null;
  classification_counts: { success: number; mid: number; failed: number };
  deploys_per_day: number;
  median_gap_minutes: number | null;
  peak_hour_utc: number | null;
  ath_usd: { median: number | null; p90: number | null; max: number | null };
  naming_buckets: Record<string, number>;
  ticker_length: { min: number | null; median: number | null; max: number | null };
  name_length: { min: number | null; median: number | null; max: number | null };
  ticker_case: { all_upper: number; all_lower: number; mixed: number };
  description_use: { empty: number; median_length: number | null; max_length: number | null };
  socials_use: { twitter: number; telegram: number; website: number; none: number };
  fee_use: { holder_rewards: number; cashback: number; transfer_fee: number; plain: number };
  vanity_pump_count: number;
}

/** Exemplar deploy — full detail, image attached as a vision block when downloaded. */
export interface MimicExemplar {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  created_at_iso: string;
  ath_usd: number | null;
  bonded: boolean;
  classification: "success" | "mid" | "failed";
  fees: MimicDeployRow["fees"];
  vanity_pump_mint: boolean;
  selection: "top_ath" | "recent";
  /** Prior evidence-linked thesis for this mint, when one exists. */
  thesis: { category: string; text: string } | null;
  image_path: string | null;
  image_attached: boolean;
}

/** Recurring X handle across the window's token socials — candidate for the
 * dev's own account (per-token community/post links rarely repeat; a dev's
 * own handle does). */
export interface MimicTwitterCandidate {
  handle: string;
  count: number;
  sample_urls: string[];
}

/** M1 output — checkpointed on the mimic_studies row. */
export interface MimicDigest {
  wallet: string;
  alias: string | null;
  built_at_iso: string;
  stats: MimicStats;
  deploys: MimicDeployRow[];
  exemplars: MimicExemplar[];
  twitter_candidates: MimicTwitterCandidate[];
  /** Existing profile verdict (context only — the study must stand alone). */
  profile_verdict: string | null;
}

export function buildMimicPrompt(digest: MimicDigest): string {
  const attached = digest.exemplars.filter((e) => e.image_attached);
  return `You are building a MIMIC STUDY of a pump.fun deployer: a deploy-pattern playbook the reader can follow to deploy in this dev's style. The reader is a deployer studying this wallet's craft as reference for their own launches — never a trader deciding whether to buy. The study's one question: given a raw narrative, what would THIS dev ship — and how do I ship like that?

Lifecycle reality: pump.fun deploys live minutes to hours and nearly all retrace to zero. Judge every deploy by the ATH it reached and the narrative it caught; never discuss token sustainability, retrace, or longevity.

WALLET: ${digest.wallet}${digest.alias ? ` (alias: ${digest.alias})` : ""}

MECHANICAL STATS over the last ${digest.stats.deploy_count} deploys (deterministic, trust them; use them as grounding, never fabricate numbers beyond them):
${JSON.stringify(digest.stats, null, 2)}

ALL ${digest.deploys.length} DEPLOYS IN THE WINDOW (newest first, lean rows — names, tickers, descriptions, ATH, fee flags, vanity mints, prior thesis categories where this tool already studied the mint):
${JSON.stringify(digest.deploys, null, 2)}

EXEMPLARS (${digest.exemplars.length} deploys in full detail — top performers by ATH plus the most recent; prior evidence-linked theses included where they exist, trust their narrative findings):
${JSON.stringify(digest.exemplars, null, 2)}

IMAGES: ${attached.length} exemplar token images are attached, each preceded by a label naming the token. Study them as a set: art style, sourcing (original / screenshot-stolen / AI-generated), effort level, text-on-image habits, palette, and how the image subject tracks each token's narrative.

X ACCOUNT CANDIDATES (handles recurring across this dev's token socials — a handle repeated across unrelated deploys is likely the dev's own account; a handle appearing once is likely a per-token community or source post):
${JSON.stringify(digest.twitter_candidates, null, 2)}
${digest.twitter_candidates.length > 0 ? `If one candidate is plausibly the dev's own account, fetch https://x.com/<handle> with mcp__scrapling__stealthy_fetch (plain WebFetch is bot-blocked on x.com) and study the tweet wording, tone and layout: casing, punctuation, emoji use, line breaks, thread/reply habits, and how deploys get announced. One fetch, two at most. If the fetch returns nothing useful, set twitter_style_md to null and say so in unknowns.` : `No candidates exist — set twitter_handle and twitter_style_md to null; do not go hunting for an account.`}
${digest.profile_verdict ? `\nEXISTING PROFILE VERDICT (context only — the study must stand alone):\n${digest.profile_verdict}` : ""}

WEB USE (light): a handful of searches at most, only to pin down the narrative behind a specific deploy when its name/description/thesis leaves it unclear. The digest carries the decisive data; this is a pattern study, not a research run.

TASK — produce every section as clean markdown:
- playbook_md — THE deliverable: numbered, followable steps to deploy exactly like this dev, start to finish. Catching the narrative the way they do → naming it their way (their casing/spelling/length habits) → writing the description their way → sourcing/making the image their way → fee configuration → timing/cadence → socials → announcing (if their X account is known). Someone holding a fresh narrative should be able to execute this list and ship a coin indistinguishable from this dev's. Reference their actual habits with token examples inline.
- narrative_to_token_md — the transformation pattern: what this dev keeps, compresses, or drops between a raw narrative and the deployed coin. Which part of a story becomes the ticker, which the name, what the description does.
- naming_md — ticker + name style and wording rules, stated as rules with examples (casing, lengths, spelling — exact crowd spelling vs invented words, prefixes/suffixes, recurring formats).
- image_style_md — the image pattern and its relationship to narrative type, grounded in the attached exemplars.
- fee_patterns_md — which fee setup they pair with which narrative/deploy types, from the digest's fee flags. If they only ever use one setup, say exactly that.
- deploy_mechanics_md — cadence, active hours, relaunch/derivative habits, vanity …pump mint use, socials-per-deploy habits.
- twitter_handle + twitter_style_md — per the X ACCOUNT rules above.
- example_mappings — 3–8 concrete narrative→deploy mappings (mint, the raw narrative, the resulting name/ticker, and how the narrative became exactly those choices). Prefer exemplars with theses; these are the study's evidence core.
- confidence + unknowns.

STYLE: clean, readable, straight to the point. No fluff; every sentence carries information. State what this dev DOES — positive assertions, no "not a X deployer" constructions, no self-contradiction; a competing read goes to unknowns.

HARD RULES:
- Describe the dev's habits EXACTLY as the data shows them — never "improve" their spelling, casing, or style. If they ship lowercase misspellings, the playbook says ship lowercase misspellings.
- Every example mint MUST come from the digest — never invented. twitter_handle MUST be one of the candidates or null.
- Ground every pattern claim in digest rows, stats, attached images, or a prior thesis; cite token names + tickers when giving examples. No fabricated statistics.
- Patterns need multiple supporting deploys; a single-deploy observation is a weak signal and must be labeled as such or left to unknowns.
- The "wallet" field must echo ${digest.wallet} exactly.`;
}
