# DEVSCOPE — v1 SPEC (Deployer Scan)

Status: LOCKED for v1 development · Date: 2026-10-03
Owner: solo operator, personal local tool
Environment: WSL2 Ubuntu on Windows 11, used via Chrome (Windows side)
Reasoning budget: Claude Max 5x subscription (no API billing in v1)

---

## 1. Purpose

A local platform giving a pump.fun deployer an edge via AI-reasoned intelligence on other deployers. v1 ships one feature — **Deployer Scan** (UI: *Dev Scan*): given a wallet address, analyze its recent deploy history, generate AI theses for its most/least successful tokens, and synthesize a persistent `*-PROFILE.md` describing the deployer's style, strengths, failure modes, and actionable signals.

Added 0.9.0 — **Token Scan**: given a single contract address, run one research scan producing the same per-token thesis the deployer pipeline generates (§7b). Results live in their own *Token Library*, fully scoped apart from deployer profiles.

Added 0.10.0 — **Vamp Scan**: opt-in PvP analysis around any scanned token's launch window — who vamped whom, and what decided it (§7c).

v1 is the foundation. Later features (live launch alerts, narrative-meta scans, wallet clustering, self post-mortems) consume the same data layer and profile store. Nothing in v1 may assume it is the only feature.

---

## 2. Hard constraints

| Constraint | Consequence |
|---|---|
| Runs locally on WSL2 Ubuntu | Backend + DB + files live in WSL filesystem (`~/`, NOT `/mnt/c` — I/O perf). UI served on `localhost:PORT`, opened in Windows Chrome (WSL2 forwards localhost by default). |
| Reasoning on Claude Max 5x via Claude Agent SDK | No per-token cost; constraint is the plan's rolling usage windows. 1–2 scans/day fits comfortably. Scans must checkpoint + resume if a limit window is hit mid-scan. |
| Subscription auth is personal-use only | Auth mode is a config flag (`subscription` \| `api_key`) from day one. If this tool ever serves anyone else, flip to `api_key`. Code must guard against a stray `ANTHROPIC_API_KEY` env var silently billing the key. |
| Data budget ≈ $0 | Free tiers only, single quota'd provider + free unofficial sources, monthly quota tracking, permanent cache. |
| Usage ceiling | Max 2 deployer scans/day. Design for this scale; do not over-engineer for throughput. |

---

## 3. Architecture

Two strictly separated layers:

- **Layer A — Deterministic (code, near-free):** enumeration, metrics, classification, filtering, caching, quota accounting. Handles bulk. No AI calls, ever.
- **Layer B — Reasoning (Claude, rate-limited):** sees only a curated dossier set (≤ ~25 tokens/scan). Produces per-token theses + profile synthesis. No bulk data, ever.

```
UI (React/Vite, dark)  ←SSE progress─┐
        │ REST                       │
Backend (Node/Fastify) ── Scan orchestrator (p-queue, checkpointed stages)
        │                    │
   SQLite (Drizzle)     Claude Agent SDK (subscription auth)
   /profiles/*.md            │ web search + vision tools
        │
 DataProvider interface → [pumpfun-frontend] [solanatracker] [bitquery] [geckoterminal]
                                   └── per-provider monthly quota ledger (SQLite)
```

---

## 4. Tech stack (locked)

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Runtime | Node.js LTS via nvm (inside WSL) |
| Backend | Fastify + SSE for scan progress |
| ORM/DB | Drizzle + SQLite (single file, `<repo>/data/app.db`) |
| Reasoning | `@anthropic-ai/claude-agent-sdk`, auth via existing `claude` CLI login |
| Frontend | React + Vite + Tailwind, served statically by Fastify |
| Queue | `p-queue` in-process; scan state persisted per stage |
| Markdown | Profiles rendered client-side (e.g. `react-markdown`) |

Repo layout:

```
/src
  /providers      # DataProvider implementations + quota ledger
  /pipeline       # stages 1–7, each resumable
  /reasoning      # agent runners + prompt templates (versioned)
  /db             # drizzle schema + migrations
  /server         # fastify routes + SSE
/web              # vite app
/profiles         # *-PROFILE.md (source of truth)
/data             # sqlite, cached token images
/config           # bands.json, scan-defaults.json, providers.json
```

---

## 5. Data layer

### 5.1 Required data per token
mint, name, ticker, description, image URI, socials (x/tg/web), created_at, creator wallet, bonded/graduated flag, ATH market cap (USD), and where available: trade count, volume, dev-buy size, time-to-ATH.

### 5.2 Providers (priority order, behind `DataProvider` interface)

1. **pump.fun unofficial frontend API** — enumeration of a wallet's created coins + metadata + bonded flag. Free, no key. Fragile/undocumented → wrap with retries, strict response validation, and loud failure surfacing. Never the quota'd path. **Mayhem-mode launches are excluded at this boundary** (2026-10-07): rows carrying `mayhem_state` are opt-in AI-agent gambling charts (the agent randomly trades an extra 1B-token supply for 24h), not studyable deploys — they never reach the DB, fingerprint, dossiers, or profiles, and S1 purges any cached before the filter existed. Caveat: Solana Tracker's lifetime deploy/graduated totals cannot be filtered and still count mayhem launches.
2. **Solana Tracker Data API (free tier)** — per-token ATH + token detail. THE quota'd provider. Every call decrements the monthly ledger. *(Build note 2026-10-03: pump.fun enumeration already returns a USD `ath_market_cap` per token, so Solana Tracker is only hit for bonded tokens — whose post-graduation ATH pump.fun may not track (§16 TODO-VERIFY) — and ad-hoc pinned mints. This cuts quota use per scan from ~300 calls to single digits.)*
3. **Bitquery (free dev tier)** — *(revised 2026-10-05: the free dev tier is restricted to the realtime dataset — archive queries return 403 — and realtime is too shallow for lifetime aggregates. Lifetime totals (deploy count + graduated count) now come from Solana Tracker's `/deployer/{wallet}` in one quota'd call; Bitquery is attempted opportunistically for the lifetime best-ever ATH and fills it only on a plan with archive access. Key is optional.)* Separate quota ledger.
4. **GeckoTerminal (free)** — last-resort OHLCV; compute ATH from candles locally.

Exact endpoint paths, auth headers, pagination shapes, and current free-tier limits are **VERIFY-AT-BUILD** items (§16) — providers change these without notice.

### 5.3 Quota ledger
Table `provider_usage(provider, month, calls_used, soft_limit)`. Every provider call runs through a wrapper that increments the ledger and refuses to start a scan whose estimated cost exceeds remaining headroom (shows the estimate + remaining quota instead). UI displays per-provider meters. Soft limits configurable in `providers.json`.

### 5.4 Cache policy
On-chain history is immutable → cache forever. `tokens` table is permanent; a token's ATH is only refreshed if the token was still alive (recent trades) at last fetch. Re-scans fetch only the delta. Token images downloaded once to `/data/images/{mint}.*`.

---

## 6. Classification (config: `config/bands.json`)

```json
{
  "worked": "bonded == true",
  "mid":    "!bonded && ath_usd > 15000",
  "failed": "!bonded && ath_usd <= 15000"
}
```

Bands are config, not code — pump.fun's fee/graduation mechanics change frequently (Dynamic Fees V1 → Jan 2026 fee-sharing/cashback overhaul → Mar 2026 redirect cap). Every profile records the band definition used at scan time.

---

## 7. Pipeline — Deployer Scan

**Input:** wallet address; optional name; per-scan overrides (window N, dossier sizes).

**Defaults:** window = 300 most recent deploys (max 500) · dossier = top 10 + 2–3 mids + 5–8 sampled failures · hard dossier cap = 20 (25 absolute).

Each stage persists its output; a crashed/paused scan resumes at the last incomplete stage.

**S1 — Enumerate.** Fetch the wallet's most recent N deploys (metadata + bonded flag) via provider 1 — always the full window, including on re-scans (free calls; refreshes stale ATHs of tokens that pumped after the last scan). Then fetch **lifetime highlights**: the wallet's all-time top deploys via pump.fun's `sort=ath_market_cap` on the creator filter (1 free call, discovered 2026-10-05) — fills lifetime best ATH and feeds S3 auto-pins. Then **lifetime totals**: deploy + graduated counts via Solana Tracker `/deployer` (1 call); Bitquery archive cross-checks the best ATH when the plan allows it. Store all.

**S2 — Exact scoring.** For every in-window, non-bonded token not already cached: fetch ATH (quota'd provider). Classify all window tokens into WORKED/MID/FAILED. Compute the statistical fingerprint in code: deploys/day, cadence, active hours (UTC → inferred timezone), bond rate, ATH distribution (median/p90/max), naming patterns (regex buckets: dictionary words vs 3–4 letter caps, emoji, "AI"/animal/person-name themes), token lifespan distribution, dev-buy sizes where available.

**S3 — Dossier selection.**
- Top 10 by ATH (bonded first).
- 2–3 MIDs — prefer "almost made it" (highest ATH below migration).
- 5–8 FAILED — not the literal worst; cluster failures by name-theme + time, sample across clusters, weight toward instructive failures (had early volume, then died).
- Top K lifetime deploys by all-time ATH, auto-pinned (default K=3, `lifetime_top_k`) — career-defining tokens reach the dossier even when thousands of newer deploys buried them. Bonded ones get a Solana Tracker ATH max-merge.
- Any user-pinned mints (incl. out-of-window — fetched ad hoc).

**S4 — Dossier enrichment.** For selected tokens only: full metadata, downloaded image, socials, precise launch timestamp, price-curve summary (time-to-ATH, retrace speed, volume profile), peak holders if available.

**S5 — Per-token thesis (Layer B).** One agent run per dossier token. Inputs: dossier JSON + token image (vision) + launch timestamp. The agent web-searches for events around the launch time relevant to name/ticker/description. Output (structured, validated):

```json
{
  "mint": "...",
  "narrative_category": "breaking_news | celeb_moment | meta_derivative | original_meme | coordinated_push | unknown",
  "timing": "first_mover | fast_follow | late_derivative | n/a",
  "thesis": "why it worked / died (3–8 sentences)",
  "evidence": [{"claim": "...", "source_url": "...", "found": true}],
  "confidence": "high | medium | low",
  "unknowns": "what couldn't be verified"
}
```
Rule enforced in-prompt: unverified speculation must be labeled; empty `evidence` forces `confidence: low`. (Known limitation: historical X reconstruction is weak; recent windows mitigate this — tokens <2 weeks old reconstruct far better.)

**S6 — Profile synthesis (Layer B).** One agent run. Inputs: all theses + S2 fingerprint + lifetime context. Output: the full `*-PROFILE.md` (schema §9.2).

**S7 — Store & index.** Write `/profiles/{name|shortwallet}-PROFILE.md`, upsert index row, log the scan run (date, window, quota spent, agent runs, prompt versions). Profile appears in Library immediately.

**Re-scan (update):** delta-enumerate new deploys since `window.to`, re-score, re-select, generate theses only for *new* dossier entries, re-synthesize the profile with prior profile + new theses as context. Old theses are kept verbatim.

---

## 7b. Pipeline — Token Scan (added 0.9.0)

**Input:** one contract address (mint).

A mini-pipeline over the same primitives as §7, run as one queued job (shares the scan queue — Layer B never runs concurrently):

1. **Metadata** — free pump.fun single-coin lookup (`POST /coins/mints`, §16); refreshes mutable cached fields. Mayhem-mode launches are refused by policy at the provider boundary, and any pre-filter cached row (+ theses) is purged.
2. **ATH** — S2 rule verbatim: bonded tokens get the authoritative Solana Tracker ATH (max-merged with pump.fun's curve-phase value); a cached authoritative ATH is never re-fetched; non-bonded tokens keep the free enumeration ATH.
3. **Enrichment** — S4's per-token enrichment: image download (vision input), curve stats.
4. **Thesis (Layer B)** — S5's generator with `selection_reason: "token-scan"` and the standard classification bands. The re-scan rule applies: a prior successful thesis for the mint (from any scan) is copied verbatim — already-studied tokens cost zero Layer B.

State lives in `token_scans` (§9.1); the thesis lands in `theses` keyed `(mint, token_scan_id)`, so deployer-scan and token-scan results stay scoped by scan id with no overlap. Every step is idempotent — a paused/failed scan resumes by re-running. Pause/auto-resume semantics on Claude usage limits match §8. An optional `vamp` flag chains a Vamp Scan (§7c) after the thesis.

---

## 7c. Pipeline — Vamp Scan (added 0.10.0)

**Input:** one already-scanned mint. **Always opt-in** (bat button / token-scan flag) — never runs by default; identification is quota- and Layer-B-costly relative to its frequency of being needed.

Vamping = launching a competing version of a running token's narrative to suck its volume; the winner's edge is often a better ticker/name (spelling, canonical phrasing), fee configuration (creator fees vs holder rewards vs charity vs fee share), image, or finer token details. The scan answers: who vamped whom in this launch window, and what decided it.

Mini-pipeline (one queued job; every step checkpointed on the `vamp_scans` row):

1. **V1 — Window enumerate (quota'd).** Solana Tracker `/search` filter-only: every pump.fun deploy within ±`window_minutes` (default 5, config `scan-defaults.json → vamp`) of the scanned token's launch. ~350 deploys / 10 min observed; 1–2 calls (500-row pages). Checkpointed in `window_tokens`, so a resume never re-spends the search.
2. **V2 — Resolve + filter (free).** One pump.fun `POST /coins/mints` batch resolves all candidates: full metadata, `ath_market_cap`, fee flags. Mayhem rows dropped (boundary policy), then **ATH-mc floor** (default $10k — current mc is useless; every dead candidate sits at ~$0). Candidates deliberately **never enter the `tokens` table** — they'd skew per-wallet stats for any deployer who happens to own one; the shortlist snapshot on the scan row is the whole record.
3. **V3 — Similarity shortlist (Layer A).** Rank survivors: text identity (ticker/name edit distance + word overlap, cross-field name↔ticker) 0.5, ATH magnitude 0.3, launch proximity 0.2 — deliberately loose so differently-named same-narrative deploys survive on ATH + proximity alone. Cap `shortlist_cap` (12); top `image_candidates` (6) get image downloads. No pHash — V4's vision does the visual comparison better.
4. **V4 — Verdict (Layer B, 1 run).** Prompt `vamp-v*` with the scanned token (+ prior thesis as context) and the shortlist dossier; all images attached as labeled vision blocks. Light web use only (narrative-source confirmation). Output (validated; counterpart mints must come from the shortlist, role/counterpart consistency enforced mechanically): `role` (`vamped_another | got_vamped | pvp_won | pvp_no_winner | no_vamp_found`), `counterparts`, `deciding_factors` (`ticker_name | fees | image | token_details | timing`), `what_let_it_run`, thesis, evidence, confidence, unknowns. Evidence-gated: no competing deploy ⇒ `no_vamp_found` with empty counterparts, never "this wasn't a vamp" prose.

Verdict lands in `vamp_verdicts` keyed `(mint, vamp_scan_id)`. Entry points: 🦇 on dev-scan thesis cards (→ dev-scan token page, scoped under the profile — NOT a Token Library entry), 🦇 on the Token Library detail page, and the token-scan `vamp` flag. Typical cost: 1–2 Solana Tracker calls + 1 free pump.fun batch + 1 Layer B run. Vamp verdicts feeding S6 profile synthesis ("serial vamper") is a §15 future hook.

---

## 8. Reasoning layer details

- **Model routing:** theses on the default Sonnet-class model; synthesis may use a stronger model (config). Keep per-run context tight — one dossier per run, never the whole set.
- **Budget math (Max 5x):** one full scan ≈ 16–21 thesis runs + 1 synthesis, each with a handful of web searches. 1–2 scans/day is well inside plan limits; two back-to-back deep scans may approach a 5-hour-window cap → the orchestrator pauses on SDK rate-limit signals and auto-resumes (checkpointing makes this free).
- **Prompts are versioned files** in `/src/reasoning/prompts/`; every thesis/profile records `prompt_version`. Expect to iterate here more than anywhere else — this layer IS the product.
- **Vision is mandatory** for theses: image quality/style (effort level, AI-gen vs stolen vs original) is a real signal in deployment style.
- **Auth guard:** on startup, assert subscription auth is active and `ANTHROPIC_API_KEY` is unset (or explicitly whitelisted when mode=`api_key`).

---

## 9. Storage schemas

### 9.1 SQLite (core tables)
- `deployers(wallet PK, name, created_at, last_scanned_at, lifetime_deploys, lifetime_best_ath_usd, lifetime_best_mint, linked_wallets JSON)`
- `tokens(mint PK, wallet FK, name, ticker, description, image_path, socials JSON, created_at, bonded, ath_usd, ath_at, ath_source, curve_stats JSON, fetched_at)`
- `scans(id PK, wallet, started_at, finished_at, status, window_n, window_from, window_to, bands_version, quota_spent JSON, stage_state JSON)`
- `token_scans(id PK, mint, started_at, finished_at, status, status_reason, quota_spent JSON, vamp_requested, vamp_scan_id)` — Token Scan runs (§7b)
- `vamp_scans(id PK, mint, trigger_scan_id, started_at, finished_at, status, status_reason, window_minutes, ath_floor_usd, candidates_total, candidates_filtered, window_tokens JSON, shortlist JSON, quota_spent JSON)` — Vamp Scan runs (§7c)
- `vamp_verdicts(mint, vamp_scan_id, json, prompt_version)` — PK (mint, vamp_scan_id)
- `theses(mint, scan_id, json, prompt_version)` — scan_id is a deployer-scan OR token-scan id
- `profiles(wallet PK, file_path, updated_at, verdict_snippet)`
- `provider_usage(provider, month, calls_used, soft_limit)`

### 9.2 PROFILE.md

```markdown
---
wallet: <full address>
alias: <name or null>
scanned_at / updated_at
window: { n, from, to }
lifetime: { total_deploys, best_ath_usd, best_mint, best_at }
tokens_analyzed: { worked, mid, failed, dossier_count }
bands_version / prompt_version / data_providers
---
# Verdict            ← 3–5 line deployer description (style/trends, no stat recaps), pinned in UI
# Statistical fingerprint   ← table (cadence, hours UTC, bond rate, ATH dist, dev-buy)
# Deployer patterns         ← cross-cutting habits stated once (added 0.8.0; dedupes works/fails)
# What works for them       ← deploy/narrative types ranked, examples (removed "Playbook signals" 2026-10-05: trade-signal output is out of scope — the tool studies deploy styles as reference for the owner's own deploys)
# What fails for them
# Top deploys — theses      ← full thesis per token, evidence-linked
# Mid tier — theses
# Representative failures — theses
# Low-confidence notes / open questions
```

Markdown file is source of truth; DB indexes it. Renaming a deployer renames the file; wallet in frontmatter is the permanent key.

---

## 10. UI (v1)

Dark only: near-black background (#0c0e12-ish), one muted accent, high-contrast grey text, zero decorative color, generous spacing, system/Inter type.

1. **Dev Scan** (renamed from Scan, 0.9.0) — wallet input, optional name, window + dossier dials (prefilled defaults), pre-flight quota estimate vs remaining, start → live stage progress (SSE): current stage, tokens processed, current agent task, pause/resume.
2. **Token Scan** (added 0.9.0) — contract-address input, pre-flight estimate, start → live feed (SSE), finished thesis rendered inline with a jump to the Token Library. "Include vamp scan" flag (0.10.0) chains §7c after the thesis and folds its cost into the pre-flight estimate.
3. **Dev Library** (renamed from Library, 0.9.0) — profile cards (name/shortwallet, verdict snippet, bond rate, best ATH, scanned date), sort + search, rename inline. Deployer profiles only — token-scan results never appear here.
4. **Token Library** (added 0.9.0) — cards with token image, name, ticker, contract address (copy), classification/ATH, scan date; sort + search; click → token detail view (metadata, socials, deployer link, full thesis card, vamp panel with 🦇 start button). Individually scanned tokens only — deployer-scan dossiers never appear here.
4b. **Dev-scan token page** (added 0.10.0) — 🦇 on a profile thesis card lands here and auto-starts the vamp scan (the button press is the consent; a plain page open never starts one). Token header + dev-scan thesis + vamp panel, back-link to the profile. Scoped under the deployer profile — not a Token Library entry.
5. **Profile** — structured renderer (updated 2026-10-05): full-width desktop layout — header merges verdict with a stat/fingerprint tile grid, deployer-patterns panel + works/fails split below, thesis cards 3-per-row (2 when narrow) with token image/chips/collapsible evidence, open questions panel. The markdown file stays the source of truth; prose sections are parsed from it, token data comes from the DB. Links out to pump.fun/solscan per token.
6. **Settings** — quota meters per provider, defaults, bands editor, auth-mode flag, prompt version display.

---

## 11. Failure & edge handling

- Provider call fails → retry w/ backoff → failover provider → if all fail, stage pauses with a visible reason (never silent partial data).
- Wallet with < window deploys → scan whatever exists; < ~10 lifetime deploys → warn "insufficient history", still allow.
- Wallet with zero pump.fun creates → clean "not a pump.fun deployer" result.
- Fee-sharing wallets (fees split across up to 10 wallets) and ownership transfers mean *creator wallet* is the scan key, and some deploys may be attributed oddly → surface anomalies in the profile's open-questions section rather than guessing. `linked_wallets` field reserved for a future clustering feature.
- Agent output fails schema validation → one retry with the validation error appended → else mark thesis `generation_failed`, continue scan.

---

## 12. Security / hygiene

- No private keys anywhere in this system, ever. It reads public chain data only.
- Provider API keys in `.env` (gitignored). SQLite + profiles are local files; back up the repo’s `/data` + `/profiles` if valued.
- Server binds to localhost only.

---

## 13. Build order

| Milestone | Deliverable | Proves |
|---|---|---|
| M1 | Providers + cache + quota ledger + S1–S2 as CLI command | Data layer works on real wallets; quota math holds |
| M2 | S3–S4 selection + dossier builder | Filtering produces sane dossier sets |
| M3 | Agent SDK integration: thesis → synthesis → PROFILE.md | The product. Iterate prompts hard here against known deployers you can sanity-check |
| M4 | Fastify + React UI (Scan, Library, Profile) | Usable daily tool |
| M5 | Re-scan/delta, settings, pause/resume polish | Durable long-term use |

Validation at M3: run scans on 2–3 deployers whose history you already understand; grade the theses yourself; tune prompts until profiles match ground truth before trusting outputs on unknowns.

---

## 14. Known risks (accepted for v1)

1. pump.fun frontend API breaks without notice → provider abstraction + failover; worst case, enumeration moves to Bitquery free tier.
2. Historical X/Twitter reconstruction is weak → recency window + honest confidence labels; improves naturally for future live-analysis features.
3. pump.fun mechanics keep changing (fees, cashback coins, graduation) → bands + success logic in config; profiles record definitions used.
4. AI theses can be confidently wrong → evidence-link requirement, found/not-found flags, human spot-checks during M3.
5. Free-tier limits shrink → quota ledger makes it visible early; window dial (300→200) is the pressure valve; paid tier is the eventual escape hatch.

---

## 15. Future-feature hooks already in this design

- Live deploy alerts for profiled wallets (websocket create-streams exist) — consumes `deployers` + profiles.
- Narrative-meta scanner (what's working across ALL deployers right now) — same providers + reasoning layer.
- Self post-mortems on your own wallet — identical pipeline pointed at yourself.
- Wallet clustering (`linked_wallets`) once fee-sharing attribution matters.
- j7 integration (pre-set image-gen prompts informed by profile insights) — profiles are machine-readable for this.
- Multi-launchpad coverage (noted 2026-10-05: deployers also launch on Stonk etc., invisible to pump.fun-only enumeration) — Solana Tracker's `/deployer/{wallet}` already accepts a `launchpad` param, so this slots behind the existing `DataProvider` interface.
- Vamp verdicts feeding S6 profile synthesis ("serial vamper — N of M top deploys vamped running tokens") — decided 2026-10-09: token-page-only in v1; re-scan synthesis later gains `vamp_verdicts` as input. Cross-launchpad vamp candidates are the same quota question as multi-launchpad coverage above.

---

## 16. VERIFY-AT-BUILD checklist

- [x] pump.fun frontend API (verified live 2026-10-03): `GET https://frontend-api-v3.pump.fun/coins?offset=&limit=&creator=<wallet>` enumerates a wallet's creates, newest first; page hard-capped at 70 rows (client uses 50). Response includes full metadata **plus `usd_market_cap`, `ath_market_cap` (USD), `ath_market_cap_timestamp`, `complete` (= bonded) and `is_cashback_enabled`**. `/coins/user-created-coins/*` (v2 path) is dead; `advanced-api-v2` is Cloudflare-blocked server-side. No key; politeness throttle 350ms.
- [x] Solana Tracker (verified from published OpenAPI 2026-10-03): base `https://data.solanatracker.io`; `GET /tokens/{mint}`, `GET /tokens/{mint}/ath` → `{highest_price, highest_market_cap, timestamp}`, `GET /deployer/{wallet}`. **Free tier is now 2,500 req/month @ 3 req/s** (not 10k). Auth header `x-api-key` **confirmed live 2026-10-05** (smoke test). `/deployer/{wallet}` additionally returns lifetime `total` + `graduated` counts (verified live) — used for S1 lifetime context.
- [x] Bitquery (verified LIVE 2026-10-05): POST `https://streaming.bitquery.io/eap`, `Authorization: Bearer ory_at_…` — auth works, but **the free dev tier only allows the realtime dataset**: `dataset: archive` → 403 "your plan only allows realtime", and realtime saw 0 of a 230-deploy wallet's creates. Lifetime totals moved to Solana Tracker `/deployer/{wallet}` (returns `total` + `graduated`, verified live, 1 call). Bitquery archive queries kept for paid plans (opportunistic best-ever-ATH enrichment). Remaining TODO-VERIFY (needs paid plan): `UpdateAuthority == creator` assumption in the lifetime-ATH query.
- [x] Trade-count/volume proxies in enumeration: no trade counts, but `reply_count` + `last_trade_timestamp` (lifespan) are present and used for S3 instructive-failure weighting. Dev-buy sizes are NOT available from enumeration (noted in fingerprint).
- [x] Claude Agent SDK: `query()` with `outputFormat: {type:"json_schema"}` → `structured_output`; `allowedTools: ["WebSearch","WebFetch"]` plus the Scrapling MCP fetch tools (`mcp__scrapling__get`, `mcp__scrapling__stealthy_fetch`) when `SCRAPLING_MCP_COMMAND` is set — built-in WebFetch is bot-blocked on x.com (HTTP 402, verified 2026-10-07; Scrapling stealthy_fetch retrieves the same post fine). Vision via inline base64 content block (Read dropped in 0.7.1). Subscription auth = existing `claude` CLI login with `ANTHROPIC_API_KEY` unset — startup guard enforces. TODO-VERIFY (needs login): smoke test makes one minimal live SDK call.
- [x] Cashback-coin flag: **`is_cashback_enabled`** in every enumeration row; stored per token and surfaced in the fingerprint.
- [x] pump.fun `ath_market_cap` post-graduation coverage (verified 2026-10-05): it DOES track post-graduation trading — observed $130.5M on a graduated token, far above any graduation cap. It can lag low on recent graduates (one observed at $45k pump.fun vs $78k Solana Tracker), so bonded tokens keep the Solana Tracker max-merge.
- [x] `sort=ath_market_cap&order=DESC` works with `creator=` on `/coins` (verified live 2026-10-05) — one free call returns a wallet's all-time top deploys by ATH. Used for lifetime best + S3 auto-pins. `sort=market_cap` and `sort=last_trade_timestamp` also work; `sort=usd_market_cap` is a 400.
- [x] Mayhem-mode marker (verified live 2026-10-07): mayhem launches carry `mayhem_state` ∈ `'active' | 'paused' | 'completed'` in `/coins` enumeration rows; the field is **absent** on normal coins (70/70 top-ATH sample). `boost_mode` is a different feature (SOL-burn boost) — not a mayhem signal. No per-coin `GET /coins/{mint}` route exists on v3 (404), and `searchTerm` is fuzzy-only. Filter: drop any row where `mayhem_state` is present. Re-verified 2026-10-09: heuristic still discriminates — fresh global sample 56/70 absent (14 live mayhem), three known deployers 50/50 absent each; one all-mayhem wallet observed with 70/70 present including `'completed'` on week-old coins, so `completed` is a real historical mayhem marker, not a backfill artifact.
- [x] pump.fun single-coin lookup (verified live 2026-10-09, for Token Scan): `POST {base}/coins/mints` with JSON body `{"mints":[...]}` (≤500 mints, plain-array body is a 400) returns an array of full coin objects in the **same shape as `/coins` enumeration rows** (incl. `ath_market_cap`, `complete`, `is_cashback_enabled`, `mayhem_state` when mayhem). Keyless. Unknown mints are simply omitted from the response.
- [x] Solana Tracker `/search` (verified live 2026-10-09, for Vamp Scan): works **filter-only (no `query`) on the free tier**; `minCreatedAt`/`maxCreatedAt` (unix ms) reach arbitrary history; `market=pumpfun` restricts cleanly; `limit` max 500/page with `page` pagination + `hasMore`; rows carry mint/name/symbol/deployer/createdAt (+ current `marketCapUsd` — useless as a filter, dead tokens sit at ~$0; ATH comes from the free pump.fun batch instead). A 10-min global window = 347 pump.fun deploys, one page. Response may include up to 5 curated/promoted rows outside the window — client re-filters by bounds.
- [x] pump.fun global `sort=created_timestamp` (probed 2026-10-09): works but offset paging dies between 1,000–5,000 rows (~1–3h of history at ~25 deploys/min) — unusable for historical windows; Solana Tracker `/search` is the vamp-scan enumerator.
- [x] pump.fun fee-config flags (verified live 2026-10-09): every `/coins` row carries `is_holder_reward` and `transfer_fee_bps` alongside `is_cashback_enabled`. TODO-VERIFY: where creator-fee vs fee-share-target (wallet/X/github) vs charity config lives — not in enumeration rows; likely the coin page or metadata JSON (vamp V4 can Scrapling the coin page if it ever matters).
