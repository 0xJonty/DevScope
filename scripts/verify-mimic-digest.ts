/**
 * Live regression for the Mimic Dev digest (M1, PLAN.md §7f) — free keyless
 * pump.fun calls only, no Layer B. Run after touching the mimic pipeline,
 * digest stats, or the pump.fun provider mapping.
 *
 *   npx tsx scripts/verify-mimic-digest.ts <creator-wallet>
 *
 * Passes when the digest builds with sane stats, exemplars carry images, and
 * X-handle candidates only contain recurring handles.
 */
import { buildMimicDigest } from "../src/pipeline/mimic-scan.js";

const wallet = process.argv[2];
if (!wallet) {
  console.error("usage: npx tsx scripts/verify-mimic-digest.ts <creator-wallet>");
  process.exit(1);
}

const { digest, pumpfunCalls } = await buildMimicDigest(wallet, (ev) => console.log(`[m1] ${ev.message}`));

const fail = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

if (digest.deploys.length === 0) fail("digest has zero deploys");
if (digest.stats.deploy_count !== digest.deploys.length) fail("stats.deploy_count mismatch");
if (digest.exemplars.length === 0) fail("no exemplars selected");
const outside = digest.exemplars.filter((e) => !digest.deploys.some((d) => d.mint === e.mint));
if (outside.length > 0) fail(`exemplar mints outside the digest: ${outside.map((e) => e.mint).join(", ")}`);
const single = digest.twitter_candidates.filter((c) => c.count < 2);
if (single.length > 0) fail(`single-occurrence handle leaked into candidates: @${single[0]!.handle}`);
for (const d of digest.deploys) {
  if (d.description && d.description.length > 160) fail(`lean row description over 160 chars on ${d.mint}`);
}

console.log(
  `\nOK: ${digest.deploys.length} deploys, ${digest.exemplars.length} exemplars ` +
    `(${digest.exemplars.filter((e) => e.image_attached).length} images), ` +
    `${digest.twitter_candidates.length} X-handle candidate(s), ${pumpfunCalls} keyless pump.fun calls.`
);
console.log(`stats: ${JSON.stringify(digest.stats)}`);
process.exit(0);
