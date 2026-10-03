import { randomUUID } from "node:crypto";
import PQueue from "p-queue";
import { desc, eq } from "drizzle-orm";
import { bands, scanDefaults } from "../config.js";
import { db, schema } from "../db/index.js";
import { QuotaExceededError } from "../providers/quota.js";
import { scanEvents } from "./events.js";
import { getScan, getStageState, setScanStatus, setStageState } from "./checkpoint.js";
import { runS1 } from "./s1-enumerate.js";
import { runS2 } from "./s2-score.js";
import { runS3 } from "./s3-select.js";
import { runS4 } from "./s4-enrich.js";
import { runS5 } from "./s5-thesis.js";
import { runS6 } from "./s6-synthesize.js";
import { runS7 } from "./s7-store.js";
import { ScanPausedError, STAGES, STAGE_LABELS, type ScanCtx, type ScanEvent, type StageId } from "./types.js";

const STAGE_RUNNERS: Record<StageId, (ctx: ScanCtx) => Promise<void>> = {
  s1: runS1,
  s2: runS2,
  s3: runS3,
  s4: runS4,
  s5: runS5,
  s6: runS6,
  s7: runS7,
};

const queue = new PQueue({ concurrency: 1 });
const pauseFlags = new Set<string>();
const RATE_LIMIT_RESUME_MS = 15 * 60 * 1000;

export interface NewScanOptions {
  wallet: string;
  alias?: string | null;
  windowN?: number;
  pinnedMints?: string[];
}

export function createScan(opts: NewScanOptions): string {
  const windowN = Math.min(opts.windowN ?? scanDefaults.window_n, scanDefaults.window_max);
  const id = randomUUID();

  db.insert(schema.deployers)
    .values({ wallet: opts.wallet, name: opts.alias ?? null, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.deployers.wallet,
      set: opts.alias ? { name: opts.alias } : { wallet: opts.wallet },
    })
    .run();

  // Re-scan (PLAN.md §7): if a finished scan exists, the new one carries the
  // prior window bounds so S1 delta-enumerates and S2+ see the combined window.
  const prior = db
    .select()
    .from(schema.scans)
    .where(eq(schema.scans.wallet, opts.wallet))
    .orderBy(desc(schema.scans.startedAt))
    .all()
    .find((s) => s.status === "done");

  db.insert(schema.scans)
    .values({
      id,
      wallet: opts.wallet,
      startedAt: Date.now(),
      status: "paused",
      statusReason: "queued",
      windowN,
      windowFrom: prior?.windowFrom ?? null,
      windowTo: prior?.windowTo ?? null,
      bandsVersion: bands.bands_version,
      stageState: prior?.windowTo ? { delta_since: { status: "done", sinceMs: prior.windowTo } } : {},
      pinnedMints: opts.pinnedMints ?? [],
      quotaSpent: {},
    })
    .run();
  return id;
}

function makeCtx(scanId: string): ScanCtx {
  const scan = getScan(scanId);
  const deployer = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, scan.wallet)).get();
  return {
    scanId,
    wallet: scan.wallet,
    alias: deployer?.name ?? null,
    windowN: scan.windowN,
    pinnedMints: scan.pinnedMints ?? [],
    emit: (ev) => {
      const full: ScanEvent = { ...ev, scanId, at: Date.now() };
      scanEvents.publish(full);
    },
    pauseRequested: () => pauseFlags.has(scanId),
  };
}

export function requestPause(scanId: string): void {
  pauseFlags.add(scanId);
}

export function startScan(scanId: string): void {
  pauseFlags.delete(scanId);
  void queue.add(() => executeScan(scanId));
}

async function executeScan(scanId: string): Promise<void> {
  const ctx = makeCtx(scanId);
  setScanStatus(scanId, "running");
  ctx.emit({ type: "resumed", message: "Scan running." });

  try {
    for (const stage of STAGES) {
      if (getStageState(scanId, stage).status === "done") continue;
      setStageState(scanId, stage, { ...getStageState(scanId, stage), status: "running" });
      ctx.emit({ type: "stage", stage, message: STAGE_LABELS[stage] });
      await STAGE_RUNNERS[stage](ctx);
      setStageState(scanId, stage, { ...getStageState(scanId, stage), status: "done" });
    }
    setScanStatus(scanId, "done");
    ctx.emit({ type: "done", message: "Scan complete." });
  } catch (err) {
    if (err instanceof ScanPausedError || err instanceof QuotaExceededError) {
      const reason = err.message;
      setScanStatus(scanId, "paused", reason);
      ctx.emit({ type: "paused", message: reason });
      // M5 polish: usage-window limits clear on their own — auto-resume.
      if (/usage limit|rate.?limit|overloaded/i.test(reason)) {
        ctx.emit({ type: "log", message: `Auto-resume in ${RATE_LIMIT_RESUME_MS / 60000} min.` });
        setTimeout(() => {
          const s = getScan(scanId);
          if (s.status === "paused" && !pauseFlags.has(scanId)) startScan(scanId);
        }, RATE_LIMIT_RESUME_MS).unref();
      }
    } else {
      const reason = err instanceof Error ? err.message : String(err);
      setScanStatus(scanId, "failed", reason);
      ctx.emit({ type: "error", message: reason });
    }
  }
}

/** Pre-flight quota estimate (PLAN.md §5.3, §10 Scan view). */
export function estimateScanCost(wallet: string, windowN: number): Record<string, { estimated: number; note: string }> {
  const cached = db.select().from(schema.tokens).where(eq(schema.tokens.wallet, wallet)).all();
  const cachedAuthoritative = cached.filter((t) => t.athSource === "solanatracker" && !t.bonded).length;
  const pumpfunPages = Math.ceil(windowN / 50);
  const bondedGuess = Math.max(1, Math.round(windowN * 0.015)); // typical ~1-2% bond rate
  return {
    pumpfun: { estimated: pumpfunPages, note: "keyless enumeration pages" },
    solanatracker: {
      estimated: Math.max(0, bondedGuess - cachedAuthoritative),
      note: "authoritative ATH for bonded tokens (non-bonded ATH is free via pump.fun)",
    },
    bitquery: { estimated: 2, note: "lifetime deploy count + best-ever ATH aggregates" },
    geckoterminal: { estimated: bondedGuess, note: "candles for bonded dossier tokens (keyless)" },
  };
}

/** On server boot: surface scans that were running when the process died. */
export function recoverInterruptedScans(): void {
  const rows = db.select().from(schema.scans).where(eq(schema.scans.status, "running")).all();
  for (const row of rows) {
    setScanStatus(row.id, "paused", "process restarted mid-scan — resume manually");
  }
}
