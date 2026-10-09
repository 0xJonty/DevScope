/**
 * Vamp verdict prompt — versioned (PLAN.md §7c). Bump VAMP_PROMPT_VERSION on
 * any change that could shift outputs; verdicts record it.
 */
// v1.0.0 (2026-10-09): initial version. Evidence-gated PvP analysis over a
// deterministic candidate shortlist (±N min launch window, ATH-floored).
// Follows the owner prompt standards: positive assertions, no elimination
// prose, lifecycle-reality framing (ATH + narrative-at-its-moment only),
// light web use restricted to narrative-source confirmation.
export const VAMP_PROMPT_VERSION = "vamp-v1.0.0";

export interface VampCandidateDossier {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  /** Launch offset vs the scanned token: negative = launched earlier. */
  launched_seconds_after_scanned: number;
  ath_usd: number | null;
  /** ATH-time offset vs the scanned token's ATH (minutes); null when either side lacks a timestamp. */
  ath_minutes_after_scanned_ath: number | null;
  bonded: boolean;
  fees: {
    cashback: boolean | null;
    holder_rewards: boolean | null;
    transfer_fee_bps: number | null;
  };
  same_deployer: boolean;
  reply_count: number | null;
  image_attached: boolean;
}

export interface VampDossier {
  scanned: {
    mint: string;
    name: string;
    ticker: string;
    description: string | null;
    created_at_iso: string;
    bonded: boolean;
    ath_usd: number | null;
    ath_at_iso: string | null;
    fees: {
      cashback: boolean | null;
      holder_rewards: boolean | null;
      transfer_fee_bps: number | null;
    };
    reply_count: number | null;
    /** The scanned token's existing thesis prose, when one exists — context only. */
    prior_thesis: string | null;
  };
  window_minutes: number;
  ath_floor_usd: number;
  candidates: VampCandidateDossier[];
}

export function buildVampPrompt(dossier: VampDossier): string {
  const { scanned, candidates } = dossier;
  return `You are analyzing pump.fun PvP dynamics around one token's launch. Vamping (from "vampire"): a deployer launches a competing version of a running token's narrative to suck its volume. The winner's edge is often small — a correctly spelled or canonical ticker/name vs a flawed one, a better fee configuration (creator fees vs holder rewards vs charity vs fee share), a better or more faithful image, or finer token details (supply sends, reward mechanics). Some fights end with a clear winner; some PvP until both die.

SCANNED TOKEN (deterministic data, trust it):
${JSON.stringify(scanned, null, 2)}

CANDIDATES — every pump.fun deploy launched within ±${dossier.window_minutes} minutes of the scanned token that reached ≥ $${dossier.ath_floor_usd.toLocaleString("en-US")} ATH (deterministic enumeration, trust it; ordered by similarity to the scanned token):
${JSON.stringify(candidates, null, 2)}

IMAGES: the scanned token's image is attached first, then candidate images for every candidate with image_attached=true, each preceded by a ticker label. Compare them visually — same subject, same meme lineage, copied/cropped/re-rendered art, and relative quality are real vamp signals.

TASK:
1. Same-narrative identification. Which candidates target the same narrative as the scanned token? Tickers and names can differ completely between versions of the same narrative — judge by name, description, and image subject together, not ticker match alone. same_deployer=true candidates are self-vamps (a dev relaunching their own narrative) — treat them as full competitors.
2. Direction. Among same-narrative tokens, establish who vamped whom from the deterministic numbers: launch order (launched_seconds_after_scanned), ATH order (ath_minutes_after_scanned_ath), and ATH magnitudes. A later launch out-peaking an earlier runner is the vamp signature; comparable peaks close in time with both dead is a PvP that nobody won.
3. Deciding factors. For the winner, name the specific edge, not just the category: which ticker/name detail was better (spelling, the canonical phrasing of the moment), which fee setup won buyers, what made the image stronger, or which finer token detail tipped it. Small differences decide these fights.
4. If the scanned token got vamped: state what let it reach its own heights before the fight was lost (earlier launch, first to the narrative, initial image appeal — whatever the data supports).

ROLE (scanned token's perspective): "vamped_another" = it launched into or after an existing same-narrative runner and out-performed it. "got_vamped" = a competing deploy took its volume and out-performed it. "pvp_won" = a contested near-simultaneous fight it ultimately won. "pvp_no_winner" = it fought one or more rivals and every side died without a winner. "no_vamp_found" = no same-narrative competitor exists among the candidates.

WEB USE (light, optional): only when two tokens' names differ enough that a shared narrative needs confirming, search the catalyst or open a link. Prefer the scrapling tools when available (mcp__scrapling__get first, mcp__scrapling__stealthy_fetch for x.com/protected sites); plain WebFetch is bot-blocked on x.com (HTTP 402). This is not a research run — the dossier carries the decisive data.

HARD RULES:
- Report a vamp/PvP relationship only on evidence: the dossier's numbers, the images, or an externally verified shared narrative. Counterpart mints MUST come from the candidate list — never invent one.
- role no_vamp_found ⟺ counterparts empty and deciding_factors empty; the thesis then states what the token ran as, alone in its window. Never write "this wasn't a vamp"-style prose anywhere.
- Full retrace is the default outcome for every token here and carries no information — never narrate retrace, drawdown, or death as a finding. Performance = ATH reached + how the narrative performed at its moment.
- State what each deploy IS — no elimination reasoning, no self-contradiction between sentences. A competing read you cannot dismiss gets one line in "unknowns", never in the thesis.
- Every externally sourced claim goes in "evidence" with the URL and found=true/false. Dossier-derived findings need no evidence entries. If you used the web and verified nothing, confidence MUST be "low"; a verdict built purely on dossier numbers and images may be "high" when the pattern is unambiguous.
- No fluff: every sentence carries a finding.
- The "mint" field must echo ${scanned.mint} exactly.`;
}
