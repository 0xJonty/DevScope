import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import type { StageId, StageState } from "./types.js";

/** Stage state lives in scans.stage_state (PLAN.md §7: every stage resumable). */

export function getScan(scanId: string) {
  const scan = db.select().from(schema.scans).where(eq(schema.scans.id, scanId)).get();
  if (!scan) throw new Error(`Scan ${scanId} not found`);
  return scan;
}

export function getStageState(scanId: string, stage: StageId): StageState {
  const scan = getScan(scanId);
  const all = (scan.stageState ?? {}) as Record<string, StageState>;
  return all[stage] ?? { status: "pending" };
}

export function setStageState(scanId: string, stage: StageId, state: StageState): void {
  const scan = getScan(scanId);
  const all = { ...((scan.stageState ?? {}) as Record<string, StageState>), [stage]: state };
  db.update(schema.scans).set({ stageState: all }).where(eq(schema.scans.id, scanId)).run();
}

export function patchStageState(scanId: string, stage: StageId, patch: Record<string, unknown>): StageState {
  const next = { ...getStageState(scanId, stage), ...patch } as StageState;
  setStageState(scanId, stage, next);
  return next;
}

export function setScanStatus(
  scanId: string,
  status: "running" | "paused" | "failed" | "done",
  reason?: string
): void {
  db.update(schema.scans)
    .set({
      status,
      statusReason: reason ?? null,
      ...(status === "done" ? { finishedAt: Date.now() } : {}),
    })
    .where(eq(schema.scans.id, scanId))
    .run();
}

export function recordQuotaSpent(scanId: string, provider: string, calls: number): void {
  const scan = getScan(scanId);
  const spent = { ...(scan.quotaSpent ?? {}) };
  spent[provider] = (spent[provider] ?? 0) + calls;
  db.update(schema.scans).set({ quotaSpent: spent }).where(eq(schema.scans.id, scanId)).run();
}
