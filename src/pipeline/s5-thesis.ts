import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getTokensByMints, type TokenRow } from "../db/tokens.js";
import { runAgentJson, AgentOutputError, RateLimitPause } from "../reasoning/agent.js";
import { thesisSchema, thesisJsonSchema, type Thesis } from "../reasoning/schemas.js";
import { buildThesisPrompt, THESIS_PROMPT_VERSION, type ThesisDossier } from "../reasoning/prompts/thesis.js";
import { config } from "../config.js";
import { classify } from "./s2-score.js";
import { getStageState, patchStageState } from "./checkpoint.js";
import { ScanPausedError, type DossierEntry, type ScanCtx } from "./types.js";
import { z } from "zod";

const reasoningConfig = z
  .object({
    thesis_model: z.string(),
    synthesis_model: z.string(),
    max_turns_thesis: z.number(),
    max_turns_synthesis: z.number(),
  })
  .parse(JSON.parse(readFileSync(resolve(config.root, "config/reasoning.json"), "utf8")));

export { reasoningConfig };

function toDossier(row: TokenRow, entry: DossierEntry): ThesisDossier {
  return {
    mint: row.mint,
    name: row.name,
    ticker: row.ticker,
    description: row.description,
    socials: (row.socials ?? {}) as Record<string, string>,
    created_at_iso: new Date(row.createdAt).toISOString(),
    bonded: row.bonded,
    cashback_coin: row.cashback,
    ath_usd: row.athUsd,
    ath_at_iso: row.athAt ? new Date(row.athAt).toISOString() : null,
    classification: entry.classification === "pinned" ? classify(row.bonded, row.athUsd) : entry.classification,
    selection_reason: entry.reason,
    curve_stats: row.curveStats ?? null,
    reply_count: row.replyCount,
    image_path: row.imagePath,
  };
}

/**
 * S5 — one Layer B run per dossier token (PLAN.md §7). Each stored thesis is
 * its own checkpoint; schema failure retries once with the validation error
 * appended, then marks generation_failed and continues (PLAN.md §11).
 */
export async function runS5(ctx: ScanCtx): Promise<void> {
  const selection = (getStageState(ctx.scanId, "s3").selection ?? []) as DossierEntry[];
  const rows = new Map(getTokensByMints(selection.map((s) => s.mint)).map((r) => [r.mint, r]));

  for (const [i, entry] of selection.entries()) {
    const existing = db
      .select()
      .from(schema.theses)
      .where(and(eq(schema.theses.mint, entry.mint), eq(schema.theses.scanId, ctx.scanId)))
      .get();
    if (existing) continue;
    if (ctx.pauseRequested()) throw new ScanPausedError("pause requested");

    // Re-scan rule (PLAN.md §7): old theses are kept verbatim — copy the most
    // recent successful thesis for this mint instead of regenerating.
    const prior = db
      .select()
      .from(schema.theses)
      .where(eq(schema.theses.mint, entry.mint))
      .all()
      .filter((t) => !(t.json as { generation_failed?: boolean }).generation_failed)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (prior) {
      db.insert(schema.theses)
        .values({ ...prior, scanId: ctx.scanId, createdAt: prior.createdAt })
        .run();
      ctx.emit({
        type: "progress",
        stage: "s5",
        message: `Thesis ${i + 1}/${selection.length}: reused prior thesis for ${entry.mint} (verbatim).`,
        current: i + 1,
        total: selection.length,
      });
      continue;
    }

    const row = rows.get(entry.mint);
    if (!row) continue;
    const dossier = toDossier(row, entry);
    ctx.emit({
      type: "agent",
      stage: "s5",
      message: `Thesis ${i + 1}/${selection.length}: ${row.name} (${row.ticker})`,
      current: i + 1,
      total: selection.length,
    });

    let thesis: (Thesis & { generation_failed?: boolean }) | null = null;
    let prompt = buildThesisPrompt(dossier);
    for (let attempt = 1; attempt <= 2 && !thesis; attempt++) {
      try {
        thesis = await runAgentJson(prompt, thesisSchema, {
          model: reasoningConfig.thesis_model,
          maxTurns: reasoningConfig.max_turns_thesis,
          jsonSchema: thesisJsonSchema as unknown as Record<string, unknown>,
          imagePath: dossier.image_path,
          onActivity: (m) => ctx.emit({ type: "agent", stage: "s5", message: `  ${m}` }),
        });
        if (thesis.mint !== entry.mint) {
          throw new AgentOutputError(`mint mismatch: got ${thesis.mint}, expected ${entry.mint}`);
        }
        if (thesis.evidence.filter((e) => e.found).length === 0 && thesis.confidence !== "low") {
          thesis = { ...thesis, confidence: "low" }; // enforce the in-prompt rule mechanically too
        }
        // Soft style lint (prompt standards, CLAUDE.md): longevity/elimination
        // phrasing surfaces in the feed as a flag only — never fails the run.
        const lintHit = thesis.thesis.match(/retrace|drawdown|over the following|rather than|\bnot a\b/i);
        if (lintHit) {
          ctx.emit({
            type: "log",
            stage: "s5",
            message: `style lint (${row.ticker}): thesis contains "${lintHit[0]}" — check against prompt standards (longevity/elimination phrasing).`,
          });
        }
      } catch (err) {
        if (err instanceof RateLimitPause) throw new ScanPausedError(err.message);
        if (err instanceof AgentOutputError && attempt === 1) {
          prompt = `${buildThesisPrompt(dossier)}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly this and try again:\n${err.message}`;
          continue;
        }
        ctx.emit({ type: "log", stage: "s5", message: `thesis failed for ${entry.mint}: ${String(err)}` });
        db.insert(schema.theses)
          .values({
            mint: entry.mint,
            scanId: ctx.scanId,
            json: { mint: entry.mint, generation_failed: true, error: String(err).slice(0, 500) },
            promptVersion: THESIS_PROMPT_VERSION,
            createdAt: Date.now(),
          })
          .run();
        break;
      }
    }
    if (thesis) {
      db.insert(schema.theses)
        .values({
          mint: entry.mint,
          scanId: ctx.scanId,
          json: thesis as unknown as Record<string, unknown>,
          promptVersion: THESIS_PROMPT_VERSION,
          createdAt: Date.now(),
        })
        .run();
    }
  }
  patchStageState(ctx.scanId, "s5", { done: true });
}
