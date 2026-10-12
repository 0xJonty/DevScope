import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { narrativeConfig } from "../config.js";
import { db, schema } from "../db/index.js";
import { GrokApiError, GrokAuthRequiredError, grokNarrativeSearch } from "../providers/grok.js";
import { RateLimitPause, runAgentJson } from "../reasoning/agent.js";
import { buildGrokTrendPrompt, buildNarrativePrompt, NARRATIVE_PROMPT_VERSION } from "../reasoning/prompts/narrative.js";
import { narrativeReportJsonSchema, narrativeReportSchema, type NarrativeReport } from "../reasoning/schemas.js";
import { scanEvents } from "./events.js";
import { RATE_LIMIT_RESUME_MS, scanQueue } from "./orchestrator.js";
import { reasoningConfig } from "./s5-thesis.js";
import type { ScanEvent } from "./types.js";

/**
 * Narrative X Scan (PLAN.md §7d) — a two-step mini-pipeline:
 *   N1  Grok (xAI, subscription OAuth) researches live X trends via x_search,
 *       scoped to the user's freshness window. Checkpointed on grokRaw — a
 *       resume never re-spends the Grok call.
 *   N2  Layer B (Claude Agent SDK) structures the raw report into discrete
 *       narratives (narrativeReportSchema), dropping stale items. Idempotent:
 *       an existing narratives payload short-circuits.
 * Self-contained: nothing here touches `tokens` or the provider quota ledger.
 */

export function createNarrativeScan(prompt: string, windowDays: number): string {
  const id = randomUUID();
  db.insert(schema.narrativeScans)
    .values({
      id,
      prompt,
      windowDays,
      startedAt: Date.now(),
      status: "paused",
      statusReason: "queued",
    })
    .run();
  return id;
}

export function getNarrativeScan(id: string) {
  const scan = db.select().from(schema.narrativeScans).where(eq(schema.narrativeScans.id, id)).get();
  if (!scan) throw new Error(`Narrative scan ${id} not found`);
  return scan;
}

function setStatus(id: string, status: "running" | "paused" | "failed" | "done", reason?: string): void {
  db.update(schema.narrativeScans)
    .set({ status, statusReason: reason ?? null, ...(status === "done" ? { finishedAt: Date.now() } : {}) })
    .where(eq(schema.narrativeScans.id, id))
    .run();
}

export function startNarrativeScan(id: string): void {
  void scanQueue.add(() => executeNarrativeScan(id));
}

async function executeNarrativeScan(id: string): Promise<void> {
  let scan = getNarrativeScan(id);
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) =>
    scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  setStatus(id, "running");
  emit({ type: "resumed", message: "Narrative scan running." });

  try {
    // N1 — Grok live-X research (checkpointed; one subscription-quota call).
    if (!scan.grokRaw) {
      emit({ type: "progress", message: `Asking Grok for X narratives (window: ${scan.windowDays}d) — x_search runs multi-round, expect 1–3 min…` });
      const result = await grokNarrativeSearch({
        prompt: buildGrokTrendPrompt(scan.prompt, scan.windowDays),
        windowDays: scan.windowDays,
        onActivity: (message) => emit({ type: "agent", message }),
      });
      db.update(schema.narrativeScans)
        .set({ grokRaw: { text: result.text, citations: result.citations }, grokModel: result.model })
        .where(eq(schema.narrativeScans.id, id))
        .run();
      scan = getNarrativeScan(id);
      emit({
        type: "progress",
        message: `Grok report in: ${result.text.length.toLocaleString("en-US")} chars, ${result.citations.length} cited posts.`,
      });
    } else {
      emit({ type: "log", message: "Grok report already cached on this scan — skipping the Grok call." });
    }

    // N2 — Layer B structuring (idempotent).
    if (!scan.narratives) {
      emit({ type: "agent", message: "Structuring narratives (Claude)…" });
      const raw = scan.grokRaw!;
      const report = await runAgentJson<NarrativeReport>(
        buildNarrativePrompt({
          userPrompt: scan.prompt,
          windowDays: scan.windowDays,
          grokText: raw.text,
          citations: raw.citations,
          grokModel: scan.grokModel ?? narrativeConfig.grok.model,
        }),
        narrativeReportSchema,
        {
          model: reasoningConfig.narrative_model,
          maxTurns: reasoningConfig.max_turns_narrative,
          jsonSchema: narrativeReportJsonSchema as unknown as Record<string, unknown>,
          onActivity: (message) => emit({ type: "agent", message }),
        }
      );

      // Mechanical URL gate: a key_post must exist in the Grok report or its
      // citation list — invented/repaired URLs are dropped loudly.
      const known = new Set(raw.citations);
      for (const n of report.narratives) {
        const kept = n.key_posts.filter((p) => known.has(p.url) || raw.text.includes(p.url));
        if (kept.length < n.key_posts.length) {
          emit({
            type: "log",
            message: `Dropped ${n.key_posts.length - kept.length} un-sourced post link(s) from "${n.title}".`,
          });
          n.key_posts = kept;
        }
      }

      db.update(schema.narrativeScans)
        .set({ narratives: report as unknown as Record<string, unknown>, promptVersion: NARRATIVE_PROMPT_VERSION })
        .where(eq(schema.narrativeScans.id, id))
        .run();
      emit({
        type: "progress",
        message: `${report.narratives.length} narratives formed (${report.stale_dropped.length} stale item(s) dropped).`,
      });
    }

    setStatus(id, "done");
    emit({ type: "done", message: "Narrative scan complete." });
  } catch (err) {
    if (err instanceof GrokAuthRequiredError) {
      setStatus(id, "paused", err.message);
      emit({ type: "paused", message: err.message });
      return;
    }
    if (err instanceof RateLimitPause || (err instanceof GrokApiError && err.status === 429)) {
      const reason = err.message;
      setStatus(id, "paused", reason);
      emit({ type: "paused", message: reason });
      emit({ type: "log", message: `Auto-resume in ${RATE_LIMIT_RESUME_MS / 60000} min.` });
      setTimeout(() => {
        const s = getNarrativeScan(id);
        if (s.status === "paused") startNarrativeScan(id);
      }, RATE_LIMIT_RESUME_MS).unref();
      return;
    }
    const reason = err instanceof Error ? err.message : String(err);
    setStatus(id, "failed", reason);
    emit({ type: "error", message: reason });
  }
}

/** On server boot: surface narrative scans that were running when the process died. */
export function recoverInterruptedNarrativeScans(): void {
  const rows = db.select().from(schema.narrativeScans).where(eq(schema.narrativeScans.status, "running")).all();
  for (const row of rows) {
    setStatus(row.id, "paused", "process restarted mid-scan — resume manually");
  }
}
