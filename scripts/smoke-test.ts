/**
 * Post-credentials acceptance test. Run after filling .env:
 *   npm run smoke
 *
 * Validates the environment, makes ONE minimal live call per provider,
 * confirms the Agent SDK runs on subscription auth, and prints pass/fail per
 * item. Exits non-zero if any required item fails. Provider calls are real
 * and each increments the monthly quota ledger by 1.
 */
import "dotenv/config";
import { z } from "zod";

type Result = { item: string; ok: boolean; detail: string; optional?: boolean };
const results: Result[] = [];

function record(item: string, ok: boolean, detail: string, optional = false): void {
  results.push({ item, ok, detail, optional });
  console.log(`${ok ? "  ✓" : optional ? "  ○" : "  ✗"} ${item} — ${detail}`);
}

async function run(item: string, fn: () => Promise<string>, optional = false): Promise<void> {
  try {
    record(item, true, await fn(), optional);
  } catch (err) {
    record(item, false, err instanceof Error ? err.message.slice(0, 300) : String(err), optional);
  }
}

console.log("Deployer Intelligence Platform — smoke test\n");

// ── 1. Environment ─────────────────────────────────────────────────────────
console.log("Environment:");
const authMode = process.env.AUTH_MODE ?? "subscription";
{
  const set = !!process.env.SOLANA_TRACKER_API_KEY?.trim();
  record(".env SOLANA_TRACKER_API_KEY", set, set ? "set" : "missing — see .env.example for where to get it");
}
{
  const set = !!process.env.BITQUERY_API_KEY?.trim();
  record(
    ".env BITQUERY_API_KEY (optional)",
    set,
    set ? "set" : "missing — optional: only enriches lifetime best-ever ATH (archive dataset, paid plan)",
    true
  );
}
if (authMode === "subscription") {
  const stray = !!process.env.ANTHROPIC_API_KEY;
  record(
    ".env auth guard",
    !stray,
    stray
      ? "AUTH_MODE=subscription but ANTHROPIC_API_KEY is set — it WOULD bill silently; unset it"
      : "AUTH_MODE=subscription and no ANTHROPIC_API_KEY present"
  );
} else {
  record(".env auth mode", !!process.env.ANTHROPIC_API_KEY, `AUTH_MODE=api_key; key ${process.env.ANTHROPIC_API_KEY ? "set" : "MISSING"}`);
}

// ── 2. Providers (one minimal live call each) ──────────────────────────────
console.log("\nProviders:");
const UA = { "user-agent": "Mozilla/5.0 (smoke-test deployer-intel)" };
let sampleMint: string | null = null;
let sampleCreator: string | null = null;

await run("pump.fun frontend API (keyless)", async () => {
  const res = await fetch("https://frontend-api-v3.pump.fun/coins?offset=0&limit=5", {
    headers: UA,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const page = z
    .array(z.looseObject({ mint: z.string(), creator: z.string(), complete: z.boolean(), usd_market_cap: z.number().nullish() }))
    .parse(await res.json());
  if (page.length === 0) throw new Error("empty coin list — endpoint shape may have changed");
  const best = [...page].sort((a, b) => (b.usd_market_cap ?? 0) - (a.usd_market_cap ?? 0))[0]!;
  sampleMint = best.mint;
  sampleCreator = best.creator;
  return `OK — ${page.length} coins, schema valid (sample mint ${best.mint.slice(0, 8)}…)`;
});

await run("Solana Tracker /tokens/{mint}/ath (x-api-key)", async () => {
  const key = process.env.SOLANA_TRACKER_API_KEY?.trim();
  if (!key) throw new Error("SOLANA_TRACKER_API_KEY not set");
  if (!sampleMint) throw new Error("no sample mint from pump.fun step");
  const res = await fetch(`https://data.solanatracker.io/tokens/${sampleMint}/ath`, {
    headers: { ...UA, "x-api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`auth rejected (HTTP ${res.status}) — key invalid OR header name changed from x-api-key (TODO-VERIFY in PLAN.md §16)`);
  }
  if (res.status === 404) return "auth ACCEPTED (404 for a very fresh mint is normal) — header x-api-key confirmed";
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const body = z.looseObject({ highest_market_cap: z.number().nullish() }).parse(await res.json());
  return `OK — highest_market_cap=${body.highest_market_cap ?? "null"}; x-api-key header confirmed`;
});

await run("Solana Tracker /deployer lifetime totals", async () => {
  const key = process.env.SOLANA_TRACKER_API_KEY?.trim();
  if (!key) throw new Error("SOLANA_TRACKER_API_KEY not set");
  const wallet = sampleCreator ?? "BaA7Z6bCjwic9dK2j7VfJKP5grDsTTrfF7VPm4Zn72hD";
  const res = await fetch(`https://data.solanatracker.io/deployer/${wallet}?page=1&limit=1`, {
    headers: { ...UA, "x-api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const body = z
    .looseObject({ total: z.number(), graduated: z.union([z.number(), z.looseObject({ total: z.number() })]).nullish() })
    .parse(await res.json());
  const graduated = typeof body.graduated === "number" ? body.graduated : body.graduated?.total ?? "?";
  return `OK — wallet ${wallet.slice(0, 8)}… has ${body.total} lifetime creates, ${graduated} graduated`;
});

// Optional: free dev tier is realtime-only; archive (lifetime best ATH) needs a paid plan.
await run(
  "Bitquery token (optional — realtime probe)",
  async () => {
  const key = process.env.BITQUERY_API_KEY?.trim();
  if (!key) throw new Error("BITQUERY_API_KEY not set (optional — only enriches lifetime best-ever ATH)");
  const res = await fetch("https://streaming.bitquery.io/eap", {
    method: "POST",
    headers: { ...UA, "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      query: `query { Solana { Instructions(limit: {count: 1}) { Transaction { Signer } } } }`,
    }),
  });
  if (res.status === 401 || res.status === 403) throw new Error(`auth rejected (HTTP ${res.status}) — check the access token`);
  const body = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
  if (body.errors?.length) throw new Error(`GraphQL error: ${body.errors[0]!.message.slice(0, 150)}`);
  // Probe archive access so the report says whether lifetime best-ATH will fill.
  const archive = await fetch("https://streaming.bitquery.io/eap", {
    method: "POST",
    headers: { ...UA, "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ query: `query { Solana(dataset: archive) { Instructions(limit: {count: 1}) { Transaction { Signer } } } }` }),
  });
  const archiveOk = archive.ok && !((await archive.json()) as { errors?: unknown[] }).errors?.length;
  return archiveOk
    ? "OK — token valid, archive dataset available: lifetime best-ever ATH will fill"
    : "OK — token valid (realtime only; archive needs a paid plan, so lifetime best-ever ATH stays null)";
  },
  true
);

await run("GeckoTerminal OHLCV (keyless)", async () => {
  // SOL/USDC Raydium pool — a stable reference that always has candles.
  const pool = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
  const res = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/day?aggregate=1&limit=2&currency=usd`,
    { headers: { ...UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = z
    .object({ data: z.object({ attributes: z.object({ ohlcv_list: z.array(z.array(z.number())) }) }) })
    .parse(await res.json());
  return `OK — ${body.data.attributes.ohlcv_list.length} candles, schema valid`;
});

// ── 3. Agent SDK on subscription auth ──────────────────────────────────────
console.log("\nReasoning layer:");
await run("Claude Agent SDK minimal structured query", async () => {
  if (authMode === "subscription" && process.env.ANTHROPIC_API_KEY) {
    throw new Error("refusing: ANTHROPIC_API_KEY set in subscription mode (would bill)");
  }
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  let structured: unknown;
  for await (const message of query({
    prompt: 'Reply with exactly: {"ok": true}',
    options: {
      maxTurns: 1,
      allowedTools: [],
      outputFormat: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } },
    },
  })) {
    if (message.type === "result" && message.subtype === "success") {
      structured = (message as { structured_output?: unknown }).structured_output;
    }
  }
  const parsed = z.object({ ok: z.boolean() }).safeParse(structured);
  if (!parsed.success) throw new Error(`no valid structured output: ${JSON.stringify(structured).slice(0, 100)}`);
  return `OK — structured output on ${authMode} auth (logged in via \`claude\` CLI)`;
});

// ── Summary ────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok && !r.optional);
const softFailed = results.filter((r) => !r.ok && r.optional);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (softFailed.length > 0) {
  console.log("Optional items not available (scan still fully works):");
  for (const f of softFailed) console.log(`  ○ ${f.item}`);
}
if (failed.length > 0) {
  console.log("Failed items:");
  for (const f of failed) console.log(`  ✗ ${f.item}`);
  console.log("\nFix the above, then re-run: npm run smoke");
  process.exit(1);
}
console.log("All green — run your first scan: npm run dev, then open http://localhost:5717");
