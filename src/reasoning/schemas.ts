import { z } from "zod";

/** Thesis output contract (PLAN.md §7 S5). Zod validates; the JSON schema
 * below is handed to the Agent SDK as outputFormat. */

export const thesisSchema = z.object({
  mint: z.string(),
  narrative_category: z.enum([
    "breaking_news",
    "celeb_moment",
    "meta_derivative",
    "original_meme",
    "coordinated_push",
    "unknown",
  ]),
  timing: z.enum(["first_mover", "fast_follow", "late_derivative", "n/a"]),
  thesis: z.string().min(40),
  evidence: z.array(
    z.object({
      claim: z.string(),
      source_url: z.string(),
      found: z.boolean(),
    })
  ),
  confidence: z.enum(["high", "medium", "low"]),
  unknowns: z.string(),
  image_notes: z.string().optional(),
});

export type Thesis = z.infer<typeof thesisSchema>;

export const thesisJsonSchema = {
  type: "object",
  properties: {
    mint: { type: "string" },
    narrative_category: {
      type: "string",
      enum: ["breaking_news", "celeb_moment", "meta_derivative", "original_meme", "coordinated_push", "unknown"],
    },
    timing: { type: "string", enum: ["first_mover", "fast_follow", "late_derivative", "n/a"] },
    thesis: { type: "string", description: "Why it worked / died, 3-8 sentences" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          source_url: { type: "string" },
          found: { type: "boolean" },
        },
        required: ["claim", "source_url", "found"],
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    unknowns: { type: "string" },
    image_notes: { type: "string", description: "What the token image signals about effort/origin" },
  },
  required: ["mint", "narrative_category", "timing", "thesis", "evidence", "confidence", "unknowns"],
} as const;

/** Vamp verdict output contract (PLAN.md §7c V4). Role is from the scanned
 * token's perspective; counterparts must be shortlist mints (checked
 * mechanically in the pipeline, not here). */
export const vampVerdictSchema = z.object({
  mint: z.string(),
  role: z.enum(["vamped_another", "got_vamped", "pvp_won", "pvp_no_winner", "no_vamp_found"]),
  counterparts: z.array(
    z.object({
      mint: z.string(),
      name: z.string(),
      relationship: z.enum(["victim", "vamper", "pvp_rival"]),
    })
  ),
  deciding_factors: z.array(z.enum(["ticker_name", "fees", "image", "token_details", "timing"])),
  what_let_it_run: z.string(),
  thesis: z.string().min(40),
  evidence: z.array(
    z.object({
      claim: z.string(),
      source_url: z.string(),
      found: z.boolean(),
    })
  ),
  confidence: z.enum(["high", "medium", "low"]),
  unknowns: z.string(),
});

export type VampVerdict = z.infer<typeof vampVerdictSchema>;

export const vampVerdictJsonSchema = {
  type: "object",
  properties: {
    mint: { type: "string" },
    role: {
      type: "string",
      enum: ["vamped_another", "got_vamped", "pvp_won", "pvp_no_winner", "no_vamp_found"],
      description: "Scanned token's role in the window's PvP, from its own perspective",
    },
    counterparts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          mint: { type: "string", description: "Candidate mint from the dossier — never a mint you invented" },
          name: { type: "string" },
          relationship: { type: "string", enum: ["victim", "vamper", "pvp_rival"] },
        },
        required: ["mint", "name", "relationship"],
      },
    },
    deciding_factors: {
      type: "array",
      items: { type: "string", enum: ["ticker_name", "fees", "image", "token_details", "timing"] },
      description: "What decided the fight, winner's edge — empty when role is no_vamp_found",
    },
    what_let_it_run: {
      type: "string",
      description: "Only when role is got_vamped: what let the scanned token reach its heights before losing. Empty string otherwise.",
    },
    thesis: { type: "string", description: "The PvP story in 3-8 sentences (or the lone-runner statement)" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          source_url: { type: "string" },
          found: { type: "boolean" },
        },
        required: ["claim", "source_url", "found"],
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    unknowns: { type: "string" },
  },
  required: [
    "mint",
    "role",
    "counterparts",
    "deciding_factors",
    "what_let_it_run",
    "thesis",
    "evidence",
    "confidence",
    "unknowns",
  ],
} as const;

/** Narrative report output contract (PLAN.md §7d N2). Layer B structures
 * Grok's raw X trend report into tokenable narratives — each one a ready
 * token concept (ticker/name/fee recommendation); every key_posts URL must
 * come from the report/citations (checked by prompt rule, spot-checked by the
 * pipeline against the citation list). Fee vocabulary matches the vamp
 * deciding-factor set: creator_fees | holder_rewards | fee_share | charity. */
export const NARRATIVE_FEE_TYPES = ["creator_fees", "holder_rewards", "fee_share", "charity"] as const;

export const narrativeSchema = z.object({
  title: z.string().min(2),
  summary: z.string().min(40),
  /** Normalized before validation ($ stripped, uppercased, trimmed) — the
   * JSON schema pins generation to 10 chars; zod allows 12 as headroom so a
   * near-miss never fails the whole report. */
  ticker: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().replace(/^\$+/, "").replace(/\s+/g, "").toUpperCase() : v),
    z.string().min(2).max(12)
  ),
  token_name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(2).max(48)
  ),
  fee_type: z.enum(NARRATIVE_FEE_TYPES),
  fee_reason: z.string(),
  category: z.enum([
    "breaking_news",
    "politics",
    "crypto",
    "meme",
    "culture",
    "tech",
    "drama",
    "other",
  ]),
  momentum: z.enum(["exploding", "rising", "peaking", "fading"]),
  started: z.string(),
  key_posts: z.array(
    z.object({
      url: z.string(),
      note: z.string(),
      /** Like count the report states — absent when the report gives none. */
      likes: z.number().int().min(0).nullish(),
      /** Non-X website the post links to, verbatim from the report (gated in N2). */
      website: z.string().nullish(),
    })
  ),
  confidence: z.enum(["high", "medium", "low"]),
  unknowns: z.string(),
});

export type Narrative = z.infer<typeof narrativeSchema>;

export const narrativeReportSchema = z.object({
  narratives: z.array(narrativeSchema),
  stale_dropped: z.array(
    z.object({
      title: z.string(),
      reason: z.string(),
    })
  ),
});

export type NarrativeReport = z.infer<typeof narrativeReportSchema>;

export const narrativeReportJsonSchema = {
  type: "object",
  properties: {
    narratives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short name for the narrative" },
          summary: {
            type: "string",
            description: "What the story/trend IS and why X cares right now, 2-5 sentences",
          },
          ticker: {
            type: "string",
            minLength: 2,
            maxLength: 10,
            description:
              "Optimal token ticker: the canonical word of the moment, 2-10 chars (pump.fun limit), UPPERCASE, no $ prefix, spelled exactly as the crowd spells it — a longer phrase compresses to the strongest word/abbreviation the crowd already uses",
          },
          token_name: {
            type: "string",
            minLength: 2,
            maxLength: 40,
            description: "Optimal token display name (pump.fun name field): the narrative's canonical phrasing, max 40 chars",
          },
          fee_type: {
            type: "string",
            enum: ["creator_fees", "holder_rewards", "fee_share", "charity"],
            description: "Fee configuration that best fits the narrative",
          },
          fee_reason: { type: "string", description: "One line: why this fee type fits this narrative" },
          category: {
            type: "string",
            enum: ["breaking_news", "politics", "crypto", "meme", "culture", "tech", "drama", "other"],
          },
          momentum: {
            type: "string",
            enum: ["exploding", "rising", "peaking", "fading"],
            description: "Trajectory right now, as the report's virality signals support",
          },
          started: { type: "string", description: "When the story broke, as the report states it (date or relative)" },
          key_posts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string", description: "Post URL taken from the report — never invented" },
                note: { type: "string", description: "What this post is / why it matters to the narrative" },
                likes: {
                  type: "integer",
                  minimum: 0,
                  description: "Like count the report states for this post — omit when the report gives none, never estimate",
                },
                website: {
                  type: "string",
                  description: "Non-X website this post links to, copied VERBATIM from the report — omit when none, never invent",
                },
              },
              required: ["url", "note"],
            },
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          unknowns: { type: "string" },
        },
        required: [
          "title",
          "summary",
          "ticker",
          "token_name",
          "fee_type",
          "fee_reason",
          "category",
          "momentum",
          "started",
          "key_posts",
          "confidence",
          "unknowns",
        ],
      },
    },
    stale_dropped: {
      type: "array",
      description: "Report items dropped as stale (outside the window) or non-tokenable (sports/generic news) — with reason",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          reason: { type: "string" },
        },
        required: ["title", "reason"],
      },
    },
  },
  required: ["narratives", "stale_dropped"],
} as const;

export const synthesisSchema = z.object({
  verdict: z.string().min(40),
  deployer_patterns_md: z.string(),
  what_works_md: z.string(),
  what_fails_md: z.string(),
  open_questions_md: z.string(),
});

export type Synthesis = z.infer<typeof synthesisSchema>;

export const synthesisJsonSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", description: "Deployer description: 3-5 lines of style/trends, no stat recaps" },
    deployer_patterns_md: { type: "string", description: "Markdown: cross-cutting deploy habits, each stated exactly once" },
    what_works_md: { type: "string", description: "Markdown: deploy/narrative types ranked by hit rate with examples" },
    what_fails_md: { type: "string", description: "Markdown: what reliably fails for them" },
    open_questions_md: { type: "string", description: "Markdown: low-confidence notes / open questions / anomalies" },
  },
  required: ["verdict", "deployer_patterns_md", "what_works_md", "what_fails_md", "open_questions_md"],
} as const;
