import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { assertAuthMode, scanDefaults } from "./config.js";
import { db, schema } from "./db/index.js";
import { getAllUsage } from "./providers/quota.js";
import { createScan, estimateScanCost, startScan } from "./pipeline/orchestrator.js";
import { getScan, getStageState } from "./pipeline/checkpoint.js";
import { scanEvents } from "./pipeline/events.js";
import { STAGES, type Fingerprint, type StageId } from "./pipeline/types.js";

const USAGE = `DevScope CLI

Usage:
  npm run cli -- scan <wallet> [--name <alias>] [--window <n>] [--pin <mint,mint>] [--through <s1..s7>]
  npm run cli -- resume <scanId>
  npm run cli -- estimate <wallet> [--window <n>]
  npm run cli -- vamp <mint>
  npm run cli -- narrative "<prompt>" [--days <1-7>] [--tweets <1-5>]
  npm run cli -- grok-login
  npm run cli -- grok-logout
  npm run cli -- quota

  --through s2   stop after S2 (M1 data-layer mode: enumerate + score, no AI)
`;

function printQuota(): void {
  console.log("Provider quota (this month):");
  for (const [p, u] of Object.entries(getAllUsage())) {
    console.log(`  ${p.padEnd(14)} ${u.used}/${u.limit}`);
  }
}

async function runAndStream(scanId: string, through: StageId): Promise<void> {
  const stopAfter = STAGES.indexOf(through);
  scanEvents.on(`scan:${scanId}`, (ev) => {
    const prefix = ev.stage ? `[${ev.stage}]` : "[scan]";
    console.log(`${prefix} ${ev.message}`);
  });

  // Mark stages beyond --through as done so the orchestrator stops there.
  if (stopAfter < STAGES.length - 1) {
    for (const stage of STAGES.slice(stopAfter + 1)) {
      const { setStageState } = await import("./pipeline/checkpoint.js");
      setStageState(scanId, stage, { status: "done", skipped: `--through ${through}` });
    }
  }

  startScan(scanId);
  await new Promise<void>((resolveDone) => {
    const timer = setInterval(() => {
      const scan = getScan(scanId);
      if (scan.status === "done" || scan.status === "failed" || scan.status === "paused") {
        clearInterval(timer);
        resolveDone();
      }
    }, 1000);
  });

  const scan = getScan(scanId);
  console.log(`\nScan ${scanId}: ${scan.status}${scan.statusReason ? ` — ${scan.statusReason}` : ""}`);
  if (getStageState(scanId, "s2").status === "done") {
    const fp = getStageState(scanId, "s2").fingerprint as Fingerprint | undefined;
    if (fp) {
      console.log(
        `Fingerprint: ${fp.counts.total} tokens | bond rate ${(fp.bondRate * 100).toFixed(1)}% | ` +
          `${fp.deploysPerDay}/day | ATH median $${Math.round(fp.athUsd.median ?? 0).toLocaleString()} max $${Math.round(fp.athUsd.max ?? 0).toLocaleString()}`
      );
    }
  }
  console.log();
  printQuota();
  process.exit(scan.status === "failed" ? 1 : 0);
}

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(command === "quota" ? 3 : 4),
    options: {
      name: { type: "string" },
      window: { type: "string" },
      pin: { type: "string" },
      through: { type: "string", default: "s7" },
      days: { type: "string" },
      tweets: { type: "string" },
    },
    strict: false,
  });

  switch (command) {
    case "scan": {
      if (!target) throw new Error("wallet address required");
      assertAuthMode();
      const windowN = values.window ? Number(values.window) : scanDefaults.window_n;
      console.log("Pre-flight quota estimate:");
      for (const [p, e] of Object.entries(estimateScanCost(target, windowN))) {
        console.log(`  ${p.padEnd(14)} ~${e.estimated}  (${e.note})`);
      }
      const scanId = createScan({
        wallet: target,
        alias: (values.name as string) ?? null,
        windowN,
        pinnedMints: values.pin ? String(values.pin).split(",") : [],
      });
      console.log(`Scan ${scanId} created.\n`);
      await runAndStream(scanId, (values.through as StageId) ?? "s7");
      break;
    }
    case "resume": {
      if (!target) throw new Error("scanId required");
      assertAuthMode();
      await runAndStream(target, "s7");
      break;
    }
    case "estimate": {
      if (!target) throw new Error("wallet address required");
      const windowN = values.window ? Number(values.window) : scanDefaults.window_n;
      for (const [p, e] of Object.entries(estimateScanCost(target, windowN))) {
        console.log(`  ${p.padEnd(14)} ~${e.estimated}  (${e.note})`);
      }
      printQuota();
      break;
    }
    case "vamp": {
      if (!target) throw new Error("token mint required");
      assertAuthMode();
      const { createVampScan, estimateVampScanCost, getVampScan, startVampScan } = await import(
        "./pipeline/vamp-scan.js"
      );
      console.log("Pre-flight quota estimate:");
      for (const [p, e] of Object.entries(estimateVampScanCost())) {
        console.log(`  ${p.padEnd(14)} ~${e.estimated}  (${e.note})`);
      }
      const vampId = createVampScan(target);
      console.log(`Vamp scan ${vampId} created.\n`);
      scanEvents.on(`scan:${vampId}`, (ev) => console.log(`[vamp] ${ev.message}`));
      startVampScan(vampId);
      await new Promise<void>((resolveDone) => {
        const timer = setInterval(() => {
          const s = getVampScan(vampId);
          if (s.status === "done" || s.status === "failed" || s.status === "paused") {
            clearInterval(timer);
            resolveDone();
          }
        }, 1000);
      });
      const s = getVampScan(vampId);
      console.log(`\nVamp scan ${vampId}: ${s.status}${s.statusReason ? ` — ${s.statusReason}` : ""}`);
      printQuota();
      process.exit(s.status === "failed" ? 1 : 0);
      break;
    }
    case "grok-login": {
      const { startGrokDeviceLogin, grokLoggedIn } = await import("./providers/grok.js");
      if (grokLoggedIn()) console.log("Already logged in — continuing re-links the account.");
      const login = await startGrokDeviceLogin();
      console.log(`\nOpen:  ${login.verificationUri}`);
      console.log(`Code:  ${login.userCode}`);
      console.log(`\nWaiting for approval (expires in ${Math.round(login.expiresInSeconds / 60)} min)…`);
      await login.done;
      console.log("Grok login saved — Narrative X Scans will bill the subscription allowance.");
      break;
    }
    case "grok-logout": {
      const { grokLogout } = await import("./providers/grok.js");
      grokLogout();
      console.log("Grok OAuth tokens deleted.");
      break;
    }
    case "narrative": {
      const { narrativeConfig } = await import("./config.js");
      const days = values.days ? Number(values.days) : narrativeConfig.window_days_default;
      if (!Number.isInteger(days) || days < 1 || days > narrativeConfig.window_days_max) {
        throw new Error(`--days must be an integer 1-${narrativeConfig.window_days_max}`);
      }
      const tweets = values.tweets ? Number(values.tweets) : narrativeConfig.related_tweets_default;
      if (!Number.isInteger(tweets) || tweets < 1 || tweets > narrativeConfig.related_tweets_max) {
        throw new Error(`--tweets must be an integer 1-${narrativeConfig.related_tweets_max}`);
      }
      const { createNarrativeScan, getNarrativeScan, startNarrativeScan } = await import(
        "./pipeline/narrative-scan.js"
      );
      const scanId = createNarrativeScan(target ?? "", days, tweets);
      console.log(`Narrative scan ${scanId} created (window ${days}d, ${tweets} posts/narrative).\n`);
      scanEvents.on(`scan:${scanId}`, (ev) => console.log(`[narrative] ${ev.message}`));
      startNarrativeScan(scanId);
      await new Promise<void>((resolveDone) => {
        const timer = setInterval(() => {
          const s = getNarrativeScan(scanId);
          if (s.status === "done" || s.status === "failed" || s.status === "paused") {
            clearInterval(timer);
            resolveDone();
          }
        }, 1000);
      });
      const s = getNarrativeScan(scanId);
      console.log(`\nNarrative scan ${scanId}: ${s.status}${s.statusReason ? ` — ${s.statusReason}` : ""}`);
      if (s.narratives) console.log(JSON.stringify(s.narratives, null, 2));
      process.exit(s.status === "failed" ? 1 : 0);
      break;
    }
    case "quota":
      printQuota();
      break;
    case "profiles": {
      const rows = db.select().from(schema.profiles).all();
      for (const r of rows) {
        const d = db.select().from(schema.deployers).where(eq(schema.deployers.wallet, r.wallet)).get();
        console.log(`${d?.name ?? r.wallet}: ${r.filePath}`);
      }
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
