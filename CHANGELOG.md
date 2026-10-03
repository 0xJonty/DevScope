# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.0] — 2026-10-03 (M4: web UI)

### Added
- React/Vite/Tailwind v4 dark UI served statically by Fastify on localhost (PLAN.md §10): near-black `#0c0e12`, single muted steel-blue accent, Inter/system type.
- **Scan view**: wallet input, optional name, window + pinned-mint dials, live pre-flight quota estimate, per-provider quota meters, SSE stage rail (S1–S7) with live log, pause/resume, loud paused/failed reasons.
- **Library view**: profile cards (name/short wallet, verdict snippet, bond rate, best ATH, scan date), search, sort, inline rename.
- **Profile view**: rendered markdown with the Verdict pinned in an accent panel, pump.fun/solscan links, "Update scan".
- **Settings view**: quota meters, bands editor (bumps `bands_version` on save), auth-mode display, prompt versions, scan defaults.
- SSE route with event replay buffer and heartbeats; SPA fallback; `/images/` static route for cached token images.

## [0.3.0] — 2026-10-03 (M3: reasoning layer — the product)

### Added
- Layer B integration via `@anthropic-ai/claude-agent-sdk`: `runAgentJson()` wraps `query()` with JSON-schema structured output, WebSearch/WebFetch/Read tools (Read gives vision on the downloaded token image), per-call subscription-auth guard, and rate-limit detection that pauses the scan for auto-resume.
- S5 per-token theses: versioned prompt (`thesis-v1.0.0`), zod-validated output, one retry with the validation error appended, `generation_failed` fallback; evidence-empty theses are mechanically forced to `confidence: low`; re-scans copy prior theses verbatim.
- S6 profile synthesis: versioned prompt (`synthesis-v1.0.0`), model-routed (`config/reasoning.json`: sonnet theses / opus synthesis), prior-profile context on re-scans.
- S7 profile store: deterministic PROFILE.md assembly (Layer A renders frontmatter, fingerprint table, and thesis sections; Layer B contributes only verdict/works/fails/playbook/questions), profiles index upsert, scan log closure.

### Fixed
- `createScan` now persists the alias to the deployers table (it was silently dropped).

### Verified live
- End-to-end scan on a real wallet through the owner's subscription: 2 theses (web search + image vision ran), 1 synthesis, coherent PROFILE.md written — zero API-key usage.

## [0.2.0] — 2026-10-03 (M2: dossier selection + enrichment)

### Added
- S3 dossier selection: top-N by ATH (bonded first), "almost made it" mids, failures clustered by name-theme + week and sampled by instructiveness (reply count, lifespan, ATH), user-pinned mints fetched ad hoc; soft cap 20 / hard cap 25.
- S4 dossier enrichment: token image download (vision input), price-curve summary (time-to-ATH, lifespan, and for graduated tokens GeckoTerminal candle stats: days traded, volume, 7d retrace).

### Fixed
- Bonded-token ATH now takes `max(provider ATH, pump.fun curve-phase ATH)` — verified live that GeckoTerminal candles only cover the post-graduation pool ($569 vs the real $45k curve peak on the test wallet's graduate).
- Image downloads fail over pump.fun CDN → original URI → Pinata gateway (ipfs.io 429s hard).

### Verified on real data
- 60-deploy window of a live wallet: 10-token dossier, 10/10 images downloaded, real candle stats; only 2 GeckoTerminal calls and 0 Solana Tracker calls consumed.

## [0.1.0] — 2026-10-03 (M1: data layer)

### Added
- Project scaffold: TypeScript, Fastify/Drizzle/SQLite stack per PLAN.md §4; configs in `/config` (`bands.json` v1.0.0, `scan-defaults.json`, `providers.json`, `reasoning.json`); `.env.example` documenting every credential and where to obtain it.
- `DataProvider` interface with four implementations: pump.fun frontend API v3 (keyless enumeration), Solana Tracker (quota'd ATH/detail), Bitquery (lifetime aggregates), GeckoTerminal (last-resort OHLCV). All responses zod-validated; failures are loud and typed.
- Monthly quota ledger (`provider_usage`) with pre-flight headroom refusal and per-scan spend tracking.
- Permanent token cache (`tokens`) — authoritative ATHs are never downgraded; re-scans fetch deltas only.
- Pipeline stages S1 (enumerate + lifetime context) and S2 (exact scoring, classification, statistical fingerprint), both checkpointed and resumable; scan orchestrator with pause/resume and SSE event bus.
- CLI: `scan <wallet> [--through s2]`, `resume`, `estimate`, `quota`, `profiles`.
- Startup auth guard: `AUTH_MODE=subscription` + set `ANTHROPIC_API_KEY` aborts loudly.

### Decisions (spec silent / updated)
- **ATH source split**: pump.fun enumeration verifiably includes a USD `ath_market_cap` per token (not in the spec's assumptions), so non-bonded tokens use it for free; only bonded tokens + pinned out-of-window mints hit the quota'd Solana Tracker ATH endpoint. PLAN.md §5.2/§16 updated.
- Solana Tracker free tier is now 2,500 req/month (docs said 10k historically); `providers.json` soft limit set to 2,400.
- DB lives at `<repo>/data/app.db` (gitignored) rather than `~/deployer-intel/data/app.db` — same WSL filesystem, keeps the project self-contained; override with `DATA_DIR`.
- Drizzle migrations are generated files committed under `/drizzle` and applied automatically at startup.
- pump.fun page size clamps at 70; client paginates at 50/page with a 350ms politeness throttle.
