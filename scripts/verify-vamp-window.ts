/**
 * Live regression check for the vamp scan's deterministic half (V1–V3):
 * window enumeration (1–2 Solana Tracker calls), free pump.fun batch resolve,
 * ATH floor filter, similarity ranking. No DB writes, no Layer B.
 *
 *   npx tsx scripts/verify-vamp-window.ts <mint>
 *
 * Run after touching provider schemas, the search endpoint client, or the
 * similarity scorer. Fixture mints are passed as args — never committed.
 */
import { scanDefaults } from "../src/config.js";
import { getCoinsBatch, pumpfun } from "../src/providers/pumpfun.js";
import { searchWindowTokens } from "../src/providers/solanatracker.js";
import { scoreCandidate } from "../src/pipeline/vamp-similarity.js";

const mint = process.argv[2];
if (!mint) {
  console.error("usage: npx tsx scripts/verify-vamp-window.ts <mint>");
  process.exit(1);
}

const scanned = await pumpfun.getTokenDetail!(mint);
console.log(`scanned: ${scanned.name} (${scanned.ticker}) launched ${new Date(scanned.createdAt).toISOString()} ATH $${Math.round(scanned.athUsd ?? 0).toLocaleString()}`);

const { window_minutes, ath_floor_usd, shortlist_cap } = scanDefaults.vamp;
const windowMs = window_minutes * 60_000;
const { tokens, calls } = await searchWindowTokens(scanned.createdAt - windowMs, scanned.createdAt + windowMs);
const others = tokens.filter((t) => t.mint !== mint);
console.log(`V1: ${others.length} deploys in ±${window_minutes} min (${calls} quota'd calls)`);

const { coins, mayhemExcluded } = await getCoinsBatch(others.map((t) => t.mint));
const survivors = coins.filter((c) => (c.ath_market_cap ?? 0) >= ath_floor_usd);
console.log(`V2: ${coins.length} resolved, ${mayhemExcluded.length} mayhem excluded, ${survivors.length} ≥ $${ath_floor_usd.toLocaleString()} ATH floor`);

const ranked = survivors
  .map((c) => ({
    c,
    ...scoreCandidate(
      { name: scanned.name, ticker: scanned.ticker, description: scanned.description },
      {
        name: c.name,
        ticker: c.symbol,
        description: c.description ?? null,
        athUsd: c.ath_market_cap ?? null,
        createdDeltaMs: c.created_timestamp - scanned.createdAt,
      },
      windowMs,
      ath_floor_usd
    ),
  }))
  .sort((a, b) => b.score - a.score)
  .slice(0, shortlist_cap);

console.log(`V3: shortlist (cap ${shortlist_cap}):`);
for (const { c, score, textSim } of ranked) {
  const dt = Math.round((c.created_timestamp - scanned.createdAt) / 1000);
  console.log(
    `  ${score.toFixed(3)} (text ${textSim.toFixed(2)}) ${c.symbol.padEnd(10)} ${c.name.slice(0, 32).padEnd(32)} ` +
      `ATH $${Math.round(c.ath_market_cap ?? 0).toLocaleString().padStart(12)} ${dt >= 0 ? "+" : ""}${dt}s ` +
      `${c.creator === scanned.wallet ? "SELF" : ""}`
  );
}
process.exit(0);
