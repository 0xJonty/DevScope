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
