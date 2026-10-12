/**
 * Live regression: one Grok x_search call (subscription weekly-allowance quota,
 * no Layer B, no DB writes). Run after touching src/providers/grok.ts or its
 * response parser, and once after the first grok-login to verify the base URL
 * + tier allowlist (PLAN.md §16).
 *
 *   npx tsx scripts/verify-grok-narrative.ts ["focus prompt"] [--days N]
 */
import { parseArgs } from "node:util";
import { grokNarrativeSearch } from "../src/providers/grok.js";
import { buildGrokTrendPrompt } from "../src/reasoning/prompts/narrative.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: { days: { type: "string", default: "1" } },
  allowPositionals: true,
});

const focus = positionals[0] ?? "the single biggest story on X right now";
const days = Number(values.days);

const result = await grokNarrativeSearch({
  prompt: buildGrokTrendPrompt(focus, days),
  windowDays: days,
  onActivity: (m) => console.log(`[grok] ${m}`),
});

console.log(`\nmodel:      ${result.model}`);
console.log(`text:       ${result.text.length.toLocaleString()} chars`);
console.log(`citations:  ${result.citations.length}`);
console.log(`\n--- first 800 chars ---\n${result.text.slice(0, 800)}`);
console.log(`\n--- citations (first 10) ---`);
for (const c of result.citations.slice(0, 10)) console.log(`  ${c}`);
if (result.citations.length === 0) {
  console.warn("\nWARN: zero citations — x_search may not have run; check the tools block / base_url.");
  process.exit(1);
}
console.log("\nOK — Grok client + parser verified live.");
