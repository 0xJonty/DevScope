/**
 * Live check: pump.fun enumeration drops mayhem-mode launches (rows carrying
 * `mayhem_state`) and reports them via getMayhemExcludedMints(). Free calls.
 *
 *   npx tsx scripts/verify-mayhem-filter.ts <creator-wallet>
 *
 * Pass a creator that has mayhem launches — find one via a coin listed on
 * https://pump.fun/mayhem (its page shows the creator wallet).
 */
import { pumpfun } from "../src/providers/index.js";
import { getMayhemExcludedMints, getTopCreatedByAth } from "../src/providers/pumpfun.js";

const wallet = process.argv[2];
if (!wallet) {
  console.error("usage: npx tsx scripts/verify-mayhem-filter.ts <creator-wallet-with-mayhem-launches>");
  process.exit(1);
}

const tokens = await pumpfun.enumerateCreatedTokens!(wallet, 50);
const excluded = [...getMayhemExcludedMints()];
console.log(`enumerated ${tokens.length} tokens, excluded ${excluded.length} mayhem mints:`);
for (const m of excluded) console.log(`  ${m}`);

const leaked = tokens.filter((t) => excluded.includes(t.mint));
if (leaked.length > 0) {
  console.error(`FAIL: ${leaked.length} mayhem mints leaked into results`);
  process.exit(1);
}
if (excluded.length === 0) {
  console.error("FAIL: no mayhem launches excluded — wrong wallet, or the mayhem_state marker changed (re-verify PLAN.md §16)");
  process.exit(1);
}

const tops = await getTopCreatedByAth(wallet, 10);
const topLeaked = tops.filter((t) => getMayhemExcludedMints().includes(t.mint));
if (topLeaked.length > 0) {
  console.error("FAIL: mayhem mint leaked into all-time top list");
  process.exit(1);
}
console.log(`top-ATH list: ${tops.length} tokens, ${getMayhemExcludedMints().length} mayhem excluded`);
console.log("PASS");
