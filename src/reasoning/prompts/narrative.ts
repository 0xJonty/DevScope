/**
 * Narrative X Scan prompts — versioned (PLAN.md §7d). Two prompts live here
 * because they form one contract: the Grok-side research prompt (N1, sent to
 * xAI with the x_search tool) and the Layer B structuring prompt (N2, Claude
 * Agent SDK). Bump NARRATIVE_PROMPT_VERSION on any change that could shift
 * outputs; narrative scans record it.
 */
// narrative-v1.1.1 (2026-10-12): ticker rule hardened after a live failure —
// 2-10 chars (pump.fun limit) with an explicit compression rule for longer
// phrases; length now also enforced by the structured-output JSON schema.
// narrative-v1.1.0 (2026-10-12): tokenable-narrative rework. Scope locked to
// politics / breaking news / trending memes (memes prioritized — underserved,
// highest impact); sports and generic non-tokenable news excluded; search is
// explicitly global, not western/English-only (memes especially). Each
// narrative is now a full token concept: optimal ticker + name (canonical
// phrasing — the vamp finding that spelling/canonicality decides fights),
// recommended fee type with reason, and a user-set count (1-5) of most-viral
// posts. stale_dropped widened to cover non-tokenable drops.
// narrative-v1.0.0 (2026-10-12): initial version.
export const NARRATIVE_PROMPT_VERSION = "narrative-v1.1.1";

/** N1 — what Grok researches on X. The x_search tool rides along scoped to
 * [from_date, to_date); the prose restates the window because date params are
 * day-granular. */
export function buildGrokTrendPrompt(userPrompt: string, windowDays: number, relatedTweets: number): string {
  const windowLabel = windowDays === 1 ? "the last 24 hours" : `the last ${windowDays} days`;
  return `Research what is genuinely viral on X (Twitter) right now, restricted to ${windowLabel}. Use X search extensively.

FOCUS: ${userPrompt.trim() || "the biggest viral narratives on X overall"}

SCOPE — only these three lanes:
1. Trending memes and joke formats — the PRIORITY lane. New meme templates, viral phrases/catchwords, animal/mascot moments, absurdist in-jokes, image formats being riffed on. Dig deeper here than anywhere else.
2. Political flashpoints — moments producing a nameable symbol, phrase, or figure people are rallying around or dunking on.
3. Breaking news — only when it carries meme energy: a catchphrase, an image, a name, a moment the crowd is riffing on.

EXCLUDE entirely: sports (results, trades, games, athletes — even when trending), routine corporate/earnings/product news, celebrity gossip without a viral joke attached, and generic headline news nobody is memeing. The test for every story: is the crowd riffing on a specific word, name, image, or moment? No riff, no entry.

GLOBAL, not western-only: run searches beyond English — Japanese, Korean, Chinese, Spanish, Portuguese, Arabic, European language spheres. Non-English memes count fully (they are the most under-reported); report them in English with the original phrase/name romanized exactly as the crowd writes it.

For each distinct narrative you find (aim for the 5-10 strongest), report:
1. What it is — the actual story or joke, concretely, with names/phrases spelled exactly as the crowd spells them (this exact spelling matters downstream).
2. When it started and what the catalyst was.
3. How big it is — virality signals you can see (view/like/repost counts, how many large accounts are on it, whether it's still accelerating or already cooling).
4. The ${relatedTweets === 1 ? "single most viral post" : `${relatedTweets} most viral posts`} driving it — direct post URL for each (x.com/<handle>/status/<id>), the author handle, and roughly how large each post is.

RULES:
- Only stories with real traction inside ${windowLabel}. An older story qualifies only if it had a major NEW development inside the window — then report the new development, dated.
- Date every story. If you cannot place a story inside the window, say so explicitly.
- Post URLs must be real posts you found via search — never constructed from memory.
- Plain dense prose/lists. No preamble, no closing summary.`;
}

/** N2 — Layer B structuring prompt. Input is Grok's raw report + the citation
 * URL list; output is the narrativeReportSchema JSON — one full token concept
 * per narrative. */
export function buildNarrativePrompt(opts: {
  userPrompt: string;
  windowDays: number;
  relatedTweets: number;
  grokText: string;
  citations: string[];
  grokModel: string;
}): string {
  const windowLabel = opts.windowDays === 1 ? "24 hours" : `${opts.windowDays} days`;
  return `You are turning a raw X (Twitter) trend report into discrete TOKENABLE narratives for a pump.fun deploy-study tool. The report below was produced minutes ago by ${opts.grokModel} with live X search restricted to the last ${windowLabel}. It is your ONLY source — do not search the web; the report carries everything you need.

USER'S FOCUS: ${opts.userPrompt.trim() || "the biggest viral narratives on X overall"}

GROK REPORT:
---
${opts.grokText}
---

CITED POST URLS (every URL the search returned):
${opts.citations.length > 0 ? opts.citations.join("\n") : "(none — use only URLs written inside the report text)"}

TASK:
1. Split the report into discrete narratives — one entry per genuinely distinct story/trend/meme. Merge duplicate angles on the same story into one narrative.
2. Tokenability filter: keep only narratives that work as a memecoin — a specific word, name, image, or moment the crowd is riffing on. Drop to stale_dropped (with reason) anything that is sports, routine corporate/headline news, or a story with no rifferable symbol. Also drop stale items: older than ${windowLabel} with no dated in-window development, or undatable from the report.
3. For each kept narrative, design the token:
   - ticker: the canonical word of the moment, UPPERCASE, 2-10 characters HARD LIMIT (pump.fun's), no $ prefix, spelled EXACTLY as the crowd spells it (the report's spelling is ground truth — launch-window fights are decided by canonical spelling, never "improve" it). When the canonical phrase is longer than 10 characters, compress to the strongest single word or the abbreviation the crowd already uses — never truncate mid-word.
   - token_name: the narrative's canonical phrasing as a pump.fun display name — what a buyer scanning the feed instantly recognizes.
   - fee_type + fee_reason (one line): creator_fees = the default engine, fits fast breaking-news plays where speed beats mechanics; holder_rewards = community/identity narratives where holding IS the point (pride, "we" stories, long-running memes); fee_share = narratives centered on a real person/account who could plausibly be gifted the fee share — the alignment is the signal; charity = disaster/cause/sympathy narratives where a charity flag completes the story.
4. key_posts: exactly ${opts.relatedTweets} post(s) per narrative, most viral first. Every URL MUST appear verbatim in the report or the citation list — never invent, repair, or extend a URL. Prefer x.com/<handle>/status/<id> post links; if the report carries fewer than ${opts.relatedTweets} usable URLs for a narrative, include what exists — never pad with invented links.
5. summary: what the narrative IS and why X cares right now, concrete, names spelled out. momentum from the report's virality signals; started as the report dates it.
6. Order narratives biggest-first, as the report's signals support.

HARD RULES:
- State what each narrative IS — positive assertions only, no elimination prose, no self-contradiction. A competing read you cannot dismiss gets one line in "unknowns".
- This is a study tool for the owner's own deploys: describe the narrative and design the token; never trading advice or "play"/"fade" phrasing about existing tokens.
- No fluff: every sentence carries information. No restating virality numbers already implied by momentum unless a number is itself the story.
- Momentum must come from the report's signals, not your assumptions; when the report gives no trajectory signal, lower confidence and note it in unknowns.
- Non-English narratives keep their romanized original phrasing in ticker/token_name — that IS the canonical spelling.`;
}
