/**
 * Live check for the vanity grind pool (free, CPU only). Grinds a SHORT
 * suffix so it finishes in seconds, validates the pool file round-trip, then
 * projects the ETA for the real configured suffix from the measured rate.
 *
 *   npx tsx scripts/verify-vanity-grind.ts [suffix]   (default "p")
 */
import { cpus } from "node:os";
import { deployConfig } from "../src/config.js";

const suffix = process.argv[2] ?? "p";

// Patch the config before importing the pool module so the grind targets the
// short suffix and leaves the real pool untouched (pool_target stays as-is;
// we call grindOne indirectly via ensureVanityPool against a temp target).
deployConfig.vanity.suffix = suffix;
deployConfig.vanity.pool_target = 1;

const { ensureVanityPool, getVanityState, takeVanityKeypair } = await import(
  "../src/deploy/vanity.js"
);

const existing = takeVanityKeypair();
if (existing) console.log(`[vanity-verify] drained pre-existing pool key ${existing.publicKey.toBase58()}`);

const started = Date.now();
ensureVanityPool();

while (getVanityState().grinding || getVanityState().ready === 0) {
  await new Promise((r) => setTimeout(r, 500));
  const s = getVanityState();
  if (s.grinding) process.stdout.write(`\r[vanity-verify] grinding …${suffix}: ${s.attempts.toLocaleString()} tries @ ${s.ratePerSec.toLocaleString()}/s`);
  if (Date.now() - started > 120000) {
    console.error("\n[vanity-verify] FAILED: no key after 120s");
    process.exit(1);
  }
}
console.log();

const kp = takeVanityKeypair();
if (!kp) {
  console.error("[vanity-verify] FAILED: pool reported ready but take returned null");
  process.exit(1);
}
const addr = kp.publicKey.toBase58();
if (!addr.endsWith(suffix)) {
  console.error(`[vanity-verify] FAILED: ${addr} does not end with ${suffix}`);
  process.exit(1);
}

const elapsedSec = (Date.now() - started) / 1000;
const rate = getVanityState().ratePerSec || Math.round(Math.pow(58, suffix.length) / 2 / elapsedSec);
const pumpEtaMin = Math.pow(58, 4) / 2 / Math.max(rate, 1) / 60;
console.log(`[vanity-verify] OK — ground ${addr} in ${elapsedSec.toFixed(1)}s on ${cpus().length} cores`);
console.log(`[vanity-verify] measured ~${rate.toLocaleString()} tries/s → projected "pump" grind ≈ ${pumpEtaMin.toFixed(1)} min avg`);
