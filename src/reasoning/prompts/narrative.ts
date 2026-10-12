/**
 * Narrative X Scan prompts — versioned (PLAN.md §7d). Two prompts live here
 * because they form one contract: the Grok-side research prompt (N1, sent to
 * xAI with the x_search tool) and the Layer B structuring prompt (N2, Claude
 * Agent SDK). Bump NARRATIVE_PROMPT_VERSION on any change that could shift
 * outputs; narrative scans record it.
 */
// narrative-v1.0.0 (2026-10-12): initial version. Grok is the only live-X
// source; Layer B never searches — it structures Grok's report into discrete
// narratives, drops stale items, and may only cite post URLs present in the
// report. Owner prompt standards apply: study-not-trade framing, no fluff,
// positive assertions (competing reads go to unknowns).
export const NARRATIVE_PROMPT_VERSION = "narrative-v1.0.0";

/** N1 — what Grok researches on X. The x_search tool rides along scoped to
 * [from_date, to_date); the prose restates the window because date params are
 * day-granular. */
export function buildGrokTrendPrompt(userPrompt: string, windowDays: number): string {
  const windowLabel = windowDays === 1 ? "the last 24 hours" : `the last ${windowDays} days`;
  return `Research what is genuinely viral on X (Twitter) right now, restricted to ${windowLabel}. Use X search extensively.

FOCUS: ${userPrompt.trim() || "the biggest talking points, trends, memes, and news on X overall"}

For each distinct story/trend/meme you find (aim for the 5-10 biggest), report:
1. What it is — the actual story or joke, concretely, with names/events spelled out.
2. When it started and what the catalyst was.
3. How big it is — virality signals you can see (view/like/repost counts, how many large accounts are on it, whether it's still accelerating or already cooling).
4. The most viral posts driving it — include the direct post URL for each (x.com/<handle>/status/<id>), the author handle, and roughly how large each post is.

RULES:
- Only stories with real traction inside ${windowLabel}. An older story qualifies only if it had a major NEW development inside the window — then report the new development, dated.
- Date every story. If you cannot place a story inside the window, say so explicitly.
- Post URLs must be real posts you found via search — never constructed from memory.
- Plain dense prose/lists. No preamble, no closing summary.`;
}

/** N2 — Layer B structuring prompt. Input is Grok's raw report + the citation
 * URL list; output is the narrativeReportSchema JSON. */
export function buildNarrativePrompt(opts: {
  userPrompt: string;
  windowDays: number;
  grokText: string;
  citations: string[];
  grokModel: string;
}): string {
  const windowLabel = opts.windowDays === 1 ? "24 hours" : `${opts.windowDays} days`;
  return `You are structuring a raw X (Twitter) trend report into discrete narratives for a study tool. The report below was produced minutes ago by ${opts.grokModel} with live X search restricted to the last ${windowLabel}. It is your ONLY source — do not search the web; the report carries everything you need.

USER'S FOCUS: ${opts.userPrompt.trim() || "the biggest talking points, trends, memes, and news on X overall"}

GROK REPORT:
---
${opts.grokText}
---

CITED POST URLS (every URL the search returned):
${opts.citations.length > 0 ? opts.citations.join("\n") : "(none — use only URLs written inside the report text)"}

TASK:
1. Split the report into discrete narratives — one entry per genuinely distinct story/trend/meme. Merge duplicate angles on the same story into one narrative.
2. For each: state what it IS (concrete, names spelled out), its category, its momentum as the report's virality signals support, and when it started.
3. key_posts: the most viral posts for that narrative. Every URL MUST appear verbatim in the report or the citation list — never invent, repair, or extend a URL. Prefer x.com/<handle>/status/<id> post links over profile or search links.
4. Freshness filter: a narrative older than ${windowLabel} with no dated development inside the window goes to stale_dropped with the reason — never into narratives. A story the report could not date inside the window is stale.
5. Order narratives biggest-first, as the report's signals support.

HARD RULES:
- State what each narrative IS — positive assertions only, no elimination prose, no self-contradiction. A competing read you cannot dismiss gets one line in "unknowns".
- This is a study tool: describe the narrative and its audience, never trading advice or "play"/"fade" phrasing.
- No fluff: every sentence carries information. No restating virality numbers already implied by momentum unless a number is itself the story.
- Momentum must come from the report's signals, not your assumptions; when the report gives no trajectory signal, use confidence to say so and note it in unknowns.`;
}
