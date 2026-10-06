/**
 * Thesis prompt — versioned (PLAN.md §8). Bump PROMPT_VERSION on any change
 * that could shift outputs; profiles and theses record it.
 */
// v1.3.0 (2026-10-07): link-opening routed through the Scrapling MCP tools —
// built-in WebFetch is bot-blocked on X (HTTP 402 pay-per-crawl), Instagram,
// and most protected sites; get → stealthy_fetch escalation, lean extraction,
// unreachable links go to "unknowns".
// v1.2.0 (2026-10-05): reframed as deploy post-mortem (why it performed, not
// whether to buy): narrative verification via attached links, narrative age,
// vamp PvP analysis, no-fluff style rule.
// v1.1.0 (2026-10-05): token image attached inline as a content block instead
// of a Read path (user-level hooks blocked Read inside SDK sessions).
export const THESIS_PROMPT_VERSION = "thesis-v1.3.0";

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
  const outcomeQuestion = data.bonded
    ? "why this deploy worked — what made people buy it"
    : data.classification === "mid"
      ? "why this deploy almost worked and what stopped it short of graduation"
      : "why nobody bought this deploy — what killed it";
  return `You are analyzing one pump.fun token deployed by a wallet under study. This is a deploy post-mortem, not trade advice: explain ${outcomeQuestion}. The answer is not always logical — a strong narrative can lose to a better ticker, and a zero-effort deploy can run on timing alone.

TOKEN DOSSIER (deterministic data, trust it):
${JSON.stringify(data, null, 2)}

${image_path ? "TOKEN IMAGE: attached to this message. Assess it visually — effort level, AI-generated vs stolen vs original art, meme lineage. Image quality/style is a real deployment-style signal; report it in image_notes." : "TOKEN IMAGE: none available."}

RESEARCH (web search + the dossier's socials links):
LINK TOOLS: open links with the scrapling tools when available — plain WebFetch is bot-blocked on x.com (HTTP 402), Instagram, and most protected sites. Try mcp__scrapling__get first (fast); escalate to mcp__scrapling__stealthy_fetch for x.com, instagram.com, youtube.com, or any blocked/empty/login-wall result. Keep responses lean: markdown extraction, and a css_selector when only part of the page matters. A link unreachable with every tool goes in "unknowns" — never guess its contents.
1. Verify the narrative. Open the attached links (X accounts/posts, websites) and confirm what the narrative actually is and who or what it is about. Web-search a ±48h window around launch (${data.created_at_iso}) for the catalyst: news, celebrity moments, crypto-twitter metas.
2. Date the narrative. Was the catalyst fresh at launch or days old? If old, how was the meta performing when this deployed — still running or already exhausted?
3. Vamp check. Deployers vamp (vampire) volume from a running token into a competing deploy of the same narrative, often winning on a better ticker, name, image, or finer token details (holder rewards, fee sharing, sending supply to people). Look for competing deploys of the narrative around launch: did this token vamp another, get vamped, or win the PvP — and what decided it? If it got vamped, what let it reach its heights first?
4. Judge the craft. Was the outcome down to the ticker, the name, the image, finer token details, or the combination? Small mistakes have large impact in this space — name the mistake when you find one.

Then decide narrative category and timing position (first mover vs derivative) and write a 3–8 sentence thesis answering: ${outcomeQuestion}.

STYLE: straight to the point. No fluff, no hedging boilerplate, no restating dossier stats. Every sentence must carry a finding.

HARD RULES:
- Every factual claim about external events goes in "evidence" with the URL you actually found it at and found=true. If you looked and could not verify, include the claim with found=false.
- Unverified speculation must be explicitly labeled as speculation inside the thesis text.
- If evidence ends up empty, confidence MUST be "low".
- Historical X/Twitter reconstruction is weak for older tokens — say so in "unknowns" rather than guessing.
- The "mint" field must echo ${data.mint} exactly.`;
}
