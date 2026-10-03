import { readFileSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { bands } from "../config.js";
import { db, schema } from "../db/index.js";
import { runAgentJson, RateLimitPause } from "../reasoning/agent.js";
import { synthesisSchema, synthesisJsonSchema } from "../reasoning/schemas.js";
import { buildSynthesisPrompt, SYNTHESIS_PROMPT_VERSION } from "../reasoning/prompts/synthesis.js";
import { getScan, getStageState, patchStageState } from "./checkpoint.js";
import { reasoningConfig } from "./s5-thesis.js";
import { ScanPausedError, type Fingerprint, type ScanCtx } from "./types.js";

/** S6 — one Layer B run: all theses + fingerprint + lifetime → profile sections. */
export async function runS6(ctx: ScanCtx): Promise<void> {
  const scan = getScan(ctx.scanId);
  const fingerprint = getStageState(ctx.scanId, "s2").fingerprint as Fingerprint;
  const deployer = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, ctx.wallet)).get();
  const thesisRows = db.select().from(schema.theses).where(eq(schema.theses.scanId, ctx.scanId)).all();

  // Re-scan context: prior profile markdown fed back in (PLAN.md §7 re-scan).
  const priorProfile = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, ctx.wallet)).get();
  const priorMd =
    priorProfile && existsSync(priorProfile.filePath) ? readFileSync(priorProfile.filePath, "utf8") : null;

  ctx.emit({ type: "agent", stage: "s6", message: `Synthesizing profile from ${thesisRows.length} theses…` });

  const prompt = buildSynthesisPrompt({
    wallet: ctx.wallet,
    alias: ctx.alias,
    window: {
      n: scan.windowN,
      from: scan.windowFrom ? new Date(scan.windowFrom).toISOString() : null,
      to: scan.windowTo ? new Date(scan.windowTo).toISOString() : null,
    },
    lifetime: {
      total_deploys: deployer?.lifetimeDeploys ?? null,
      best_ath_usd: deployer?.lifetimeBestAthUsd ?? null,
      best_mint: deployer?.lifetimeBestMint ?? null,
    },
    fingerprint: fingerprint as unknown as Record<string, unknown>,
    bands: { worked: "bonded == true", mid_min_ath_usd: bands.mid_min_ath_usd },
    theses: thesisRows.map((t) => t.json),
    prior_profile_md: priorMd,
  });

  try {
    const synthesis = await runAgentJson(prompt, synthesisSchema, {
      model: reasoningConfig.synthesis_model,
      maxTurns: reasoningConfig.max_turns_synthesis,
      jsonSchema: synthesisJsonSchema as unknown as Record<string, unknown>,
      onActivity: (m) => ctx.emit({ type: "agent", stage: "s6", message: `  ${m}` }),
    });
    patchStageState(ctx.scanId, "s6", { synthesis, done: true });
  } catch (err) {
    if (err instanceof RateLimitPause) throw new ScanPausedError(err.message);
    throw err;
  }
}
