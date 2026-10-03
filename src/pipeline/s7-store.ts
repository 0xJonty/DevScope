import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { bands } from "../config.js";
import { db, schema } from "../db/index.js";
import { getTokensByMints } from "../db/tokens.js";
import { SYNTHESIS_PROMPT_VERSION } from "../reasoning/prompts/synthesis.js";
import { THESIS_PROMPT_VERSION } from "../reasoning/prompts/thesis.js";
import type { Synthesis } from "../reasoning/schemas.js";
import { getScan, getStageState, patchStageState } from "./checkpoint.js";
import { renderProfile, type ThesisForRender } from "./profile-render.js";
import { classify } from "./s2-score.js";
import type { DossierEntry, Fingerprint, ScanCtx } from "./types.js";

/** S7 — write PROFILE.md (source of truth), upsert index row, close the scan log. */
export async function runS7(ctx: ScanCtx): Promise<void> {
  const scan = getScan(ctx.scanId);
  const fingerprint = getStageState(ctx.scanId, "s2").fingerprint as Fingerprint;
  const selection = (getStageState(ctx.scanId, "s3").selection ?? []) as DossierEntry[];
  const synthesis = getStageState(ctx.scanId, "s6").synthesis as Synthesis;
  const deployer = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, ctx.wallet)).get();
  const thesisRows = db.select().from(schema.theses).where(eq(schema.theses.scanId, ctx.scanId)).all();
  const tokenRows = new Map(getTokensByMints(selection.map((s) => s.mint)).map((r) => [r.mint, r]));

  const theses: ThesisForRender[] = selection
    .map((entry) => {
      const token = tokenRows.get(entry.mint);
      const row = thesisRows.find((t) => t.mint === entry.mint);
      if (!token || !row) return null;
      const cls = entry.classification === "pinned" ? classify(token.bonded, token.athUsd) : entry.classification;
      return { token, classification: entry.classification === "pinned" ? "pinned" : cls, json: row.json };
    })
    .filter((x): x is ThesisForRender => x !== null);

  const existingProfile = db.select().from(schema.profiles).where(eq(schema.profiles.wallet, ctx.wallet)).get();
  const now = new Date().toISOString();
  const shortWallet = `${ctx.wallet.slice(0, 4)}${ctx.wallet.slice(-4)}`;
  const fileName = `${(ctx.alias ?? deployer?.name ?? shortWallet).replace(/[^a-zA-Z0-9_-]/g, "_")}-PROFILE.md`;
  const filePath = existingProfile?.filePath ?? join(config.profilesDir, fileName);

  const md = renderProfile(
    {
      wallet: ctx.wallet,
      alias: ctx.alias ?? deployer?.name ?? null,
      scannedAt: existingProfile ? new Date(deployer?.lastScannedAt ?? Date.now()).toISOString() : now,
      updatedAt: now,
      window: {
        n: scan.windowN,
        from: scan.windowFrom ? new Date(scan.windowFrom).toISOString() : null,
        to: scan.windowTo ? new Date(scan.windowTo).toISOString() : null,
      },
      lifetime: {
        total_deploys: deployer?.lifetimeDeploys ?? null,
        best_ath_usd: deployer?.lifetimeBestAthUsd ?? null,
        best_mint: deployer?.lifetimeBestMint ?? null,
        best_at: null,
      },
      tokensAnalyzed: {
        worked: fingerprint.counts.worked,
        mid: fingerprint.counts.mid,
        failed: fingerprint.counts.failed,
        dossier_count: selection.length,
      },
      bandsVersion: bands.bands_version,
      promptVersions: { thesis: THESIS_PROMPT_VERSION, synthesis: SYNTHESIS_PROMPT_VERSION },
      dataProviders: ["pumpfun", "solanatracker", "bitquery", "geckoterminal"],
    },
    fingerprint,
    synthesis,
    theses
  );

  writeFileSync(filePath, md, "utf8");

  db.insert(schema.profiles)
    .values({
      wallet: ctx.wallet,
      filePath,
      updatedAt: Date.now(),
      verdictSnippet: synthesis.verdict.slice(0, 280),
    })
    .onConflictDoUpdate({
      target: schema.profiles.wallet,
      set: { filePath, updatedAt: Date.now(), verdictSnippet: synthesis.verdict.slice(0, 280) },
    })
    .run();

  db.update(schema.deployers)
    .set({ lastScannedAt: Date.now() })
    .where(eq(schema.deployers.wallet, ctx.wallet))
    .run();

  patchStageState(ctx.scanId, "s7", { done: true, filePath });
  ctx.emit({ type: "progress", stage: "s7", message: `Profile written: ${filePath}` });
}
