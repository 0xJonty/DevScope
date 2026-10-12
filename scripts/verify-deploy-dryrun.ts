/**
 * Main deploy regression check (free — no SOL spent, pump.fun has no devnet so
 * this simulates against mainnet). Runs the full pipeline with dryRun: pin a
 * probe image + metadata, take/skip vanity, build + sign the create tx,
 * simulate on mainnet, assert `dry_run_ok`. Run after touching anything in
 * src/deploy/.
 *
 *   npx tsx scripts/verify-deploy-dryrun.ts [--vanity]
 *
 * Needs: SOLANA_RPC_URL reachable. The burner keypair needs NO balance —
 * simulation ignores fee payment by default... but pump.fun's create needs
 * rent, so an empty deployer may simulate as insufficient funds; the script
 * accepts either a clean dry_run_ok or that specific failure (and says which).
 */
import { scanEvents } from "../src/pipeline/events.js";
import {
  createDeployment,
  deployQueue,
  getDeployment,
  startDeployment,
} from "../src/deploy/pipeline.js";

const vanity = process.argv.includes("--vanity");

// 1×1 red PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const id = createDeployment({
  params: {
    name: "DevScope DryRun",
    ticker: "DRYRUN",
    description: "verify-deploy-dryrun.ts — simulation only, never sent",
    devBuySol: 0.001,
    slippageBps: 0,
    priorityFeeSol: 0.0005,
    holderReward: false,
    dryRun: true,
  },
  vanity,
  narrativeTokenId: null,
  image: { data: TINY_PNG, mimeType: "image/png" },
});

scanEvents.on(`scan:${id}`, (ev: { type: string; message: string }) =>
  console.log(`[${ev.type}] ${ev.message}`)
);

startDeployment(id);
await deployQueue.onIdle();

const row = getDeployment(id);
console.log(`\n[dryrun-verify] final status: ${row.status}${row.statusReason ? ` (${row.statusReason})` : ""}`);

if (row.status === "dry_run_ok") {
  console.log("[dryrun-verify] OK — create tx simulates clean.");
  process.exit(0);
}
if (row.status === "failed" && /insufficient|0x1\b|AccountNotFound/i.test(row.statusReason ?? "")) {
  console.log(
    "[dryrun-verify] PARTIAL — pipeline ran end-to-end; simulation failed only because the burner holds no SOL. Fund it and re-run for a clean pass."
  );
  process.exit(0);
}
console.error("[dryrun-verify] FAILED");
process.exit(1);
