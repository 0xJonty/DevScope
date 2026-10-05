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
