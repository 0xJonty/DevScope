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
import { ScanPausedError, type Classification, type DossierEntry, type ScanCtx, type StageId } from "./types.js";
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

function toDossier(row: TokenRow, classification: Classification, selectionReason: string): ThesisDossier {
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
    classification,
    selection_reason: selectionReason,
    curve_stats: row.curveStats ?? null,
    reply_count: row.replyCount,
    image_path: row.imagePath,
  };
}

export interface ThesisJobArgs {
  /** Deployer-scan id or token-scan id — the thesis is stored under it. */
  scanId: string;
  row: TokenRow;
  classification: Classification;
  selectionReason: string;
  /** Feed prefix, e.g. "Thesis 3/12" or "Thesis". */
  label: string;
  stage?: StageId;
  emit: ScanCtx["emit"];
}

/**
 * Produce the thesis for one token and store it under (mint, scanId). Shared
 * by S5 and the token-scan pipeline. Re-scan rule (PLAN.md §7): a prior
 * successful thesis for the mint is copied verbatim instead of regenerated.
 * Schema failure retries once with the validation error appended, then marks
 * generation_failed (PLAN.md §11). Claude usage-window limits surface as
 * ScanPausedError.
 */
export async function generateOrReuseThesis(args: ThesisJobArgs): Promise<"reused" | "generated" | "failed"> {
  const { scanId, row, emit, stage } = args;

  const prior = db
    .select()
    .from(schema.theses)
    .where(eq(schema.theses.mint, row.mint))
    .all()
    .filter((t) => !(t.json as { generation_failed?: boolean }).generation_failed)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (prior) {
    db.insert(schema.theses)
      .values({ ...prior, scanId, createdAt: prior.createdAt })
      .run();
    emit({ type: "progress", stage, message: `${args.label}: reused prior thesis for ${row.mint} (verbatim).` });
    return "reused";
  }

  const dossier = toDossier(row, args.classification, args.selectionReason);
  emit({ type: "agent", stage, message: `${args.label}: ${row.name} (${row.ticker})` });

  let thesis: Thesis | null = null;
  let prompt = buildThesisPrompt(dossier);
  for (let attempt = 1; attempt <= 2 && !thesis; attempt++) {
    try {
      thesis = await runAgentJson(prompt, thesisSchema, {
        model: reasoningConfig.thesis_model,
        maxTurns: reasoningConfig.max_turns_thesis,
        jsonSchema: thesisJsonSchema as unknown as Record<string, unknown>,
        imagePath: dossier.image_path,
        onActivity: (m) => emit({ type: "agent", stage, message: `  ${m}` }),
      });
      if (thesis.mint !== row.mint) {
        throw new AgentOutputError(`mint mismatch: got ${thesis.mint}, expected ${row.mint}`);
      }
      if (thesis.evidence.filter((e) => e.found).length === 0 && thesis.confidence !== "low") {
        thesis = { ...thesis, confidence: "low" }; // enforce the in-prompt rule mechanically too
      }
      // Soft style lint (prompt standards, CLAUDE.md): longevity/elimination
      // phrasing surfaces in the feed as a flag only — never fails the run.
      const lintHit = thesis.thesis.match(/retrace|drawdown|over the following|rather than|\bnot a\b/i);
      if (lintHit) {
        emit({
          type: "log",
          stage,
          message: `style lint (${row.ticker}): thesis contains "${lintHit[0]}" — check against prompt standards (longevity/elimination phrasing).`,
        });
      }
    } catch (err) {
      if (err instanceof RateLimitPause) throw new ScanPausedError(err.message);
      if (err instanceof AgentOutputError && attempt === 1) {
        prompt = `${buildThesisPrompt(dossier)}\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION — fix exactly this and try again:\n${err.message}`;
        continue;
      }
      emit({ type: "log", stage, message: `thesis failed for ${row.mint}: ${String(err)}` });
      db.insert(schema.theses)
        .values({
          mint: row.mint,
          scanId,
          json: { mint: row.mint, generation_failed: true, error: String(err).slice(0, 500) },
          promptVersion: THESIS_PROMPT_VERSION,
          createdAt: Date.now(),
        })
        .run();
      return "failed";
    }
  }
  if (thesis) {
    db.insert(schema.theses)
      .values({
        mint: row.mint,
        scanId,
        json: thesis as unknown as Record<string, unknown>,
        promptVersion: THESIS_PROMPT_VERSION,
        createdAt: Date.now(),
      })
      .run();
  }
  return "generated";
}

/**
 * S5 — one Layer B run per dossier token (PLAN.md §7). Each stored thesis is
 * its own checkpoint (generateOrReuseThesis handles reuse/retry/failure).
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

    const row = rows.get(entry.mint);
    if (!row) continue;
    await generateOrReuseThesis({
      scanId: ctx.scanId,
      row,
      classification: entry.classification === "pinned" ? classify(row.bonded, row.athUsd) : entry.classification,
      selectionReason: entry.reason,
      label: `Thesis ${i + 1}/${selection.length}`,
      stage: "s5",
      emit: ctx.emit,
    });
  }
  patchStageState(ctx.scanId, "s5", { done: true });
}
