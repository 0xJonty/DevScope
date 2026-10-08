# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

## [0.8.3] — 2026-10-08 (prompt standards: ATH-centric, positive assertions)

### Changed
- `thesis-v1.4.0`: lifecycle-reality framing — deploys live minutes to hours and ~99% retrace to zero, so retrace/drawdown/multi-day price history are never findings; performance = the ATH reached + how the narrative performed at its moment, with longevity mentioned only when anomalous. `curve_stats` reframed as attention-spike measures (time-to-ATH = how buying arrived: near-instant ≈ bundled/sniped, gradual ≈ organic; retrace speed ignored). Positive-assertion style rule: state what the deploy IS — no elimination reasoning ("this is X, not Y"), no self-contradiction; a competing read gets one line in `unknowns`. Vamp check reports PvP findings only on evidence — no "this wasn't a vamp" prose.
- `synthesis-v1.3.0`: same lifecycle framing (quantity-over-quality deployer model; never discuss token sustainability or long-term performance); verdict must describe style positively (no "not a X deployer" constructions).
- S5 soft style lint: fresh theses matching longevity/elimination phrasing (`retrace|drawdown|over the following|rather than|not a`) are flagged in the scan feed (log only, never fails the run) to surface prompt-standard drift between versions.
- CLAUDE.md reasoning-prompt standards extended with the two new owner-set rules (ATH-centric judgment, positive assertions).

## [0.8.2] — 2026-10-07 (mayhem-mode filter)

### Added
- Mayhem-mode launches are excluded from all results. pump.fun's Mayhem mode (opt-in AI agent randomly trades an extra 1B-token supply for the first 24h) produces gambling charts, not studyable deploys. Verified live: mayhem rows carry `mayhem_state` (`active`/`paused`/`completed`) in `/coins` enumeration; the field is absent on normal coins (`boost_mode` is a different, SOL-burn feature). Rows with `mayhem_state` are dropped at the provider boundary — they never reach the DB, fingerprint, dossiers, theses, or profiles — the enumeration window fills with real deploys instead, and the scan feed reports each exclusion. S1 also purges mayhem tokens (and their theses) cached before the filter existed. Known caveat: Solana Tracker lifetime deploy/graduated totals still count mayhem launches (not filterable there). Regression check: `scripts/verify-mayhem-filter.ts`.

## [0.8.1] — 2026-10-07 (fix: agent link access)

### Fixed
- Thesis agents could not open X/Instagram/protected links ("could not be opened HTTP 402" unknowns): Layer B sessions only had the SDK's built-in `WebFetch` — a plain bot fetch that x.com answers with HTTP 402 (pay-per-crawl) — and `settingSources: []` (0.7.1) strips user-level MCP servers, so the Scrapling server never reached them. Agents now get the Scrapling MCP passed explicitly (`mcp__scrapling__get` + `mcp__scrapling__stealthy_fetch`) via the new `SCRAPLING_MCP_COMMAND` env var. `thesis-v1.3.0` routes link-opening through those tools (get → stealthy_fetch escalation; css_selector/markdown to keep outputs lean; unreachable links recorded in "unknowns", never guessed). Unset var degrades loudly to WebFetch-only; a configured-but-missing binary aborts.

### Changed
- `max_turns_thesis` 12 → 16: the get → stealthy_fetch escalation can double per-link tool calls.

## [0.8.0] — 2026-10-05 (reasoning prompt rework)

### Added
- **Deployer patterns** profile section (`deployer_patterns_md`, rendered as `# Deployer patterns`, shown as its own panel in the Profile view): cross-cutting deploy habits (relaunch cadence, paid dex, bundling, image sourcing, handle reuse) stated once instead of repeated through works/fails.
- S6 enriches each thesis passed to synthesis with token `name`/`ticker`/`ath_usd`/`socials` so synthesis can cite tokens properly and detect a recurring dev X handle.

### Changed
- `synthesis-v1.2.0`: verdict reframed as a deployer *description* — deploy-style trends statistics can't show (e.g. consistent minimum ATH ⇒ bundling/snipers), recurring dev X-handle callout, no fingerprint stat recaps (UI shows them beside the text), explicit study-not-trade framing (no "fade"-style phrasing), no-fluff style rule; works/fails sections restricted to token-level detail with no generalized deployer stats and no repetition across sections.
- `thesis-v1.2.0`: reframed as a deploy post-mortem — answers "why did people buy this / why did nobody" rather than buyer guidance; narrative verification through the dossier's attached links, narrative-age dating (fresh vs days-old catalyst and how the meta was performing), vamp PvP analysis (who vamped whom, what decided it — ticker/name/image/finer token details, what let it run before getting vamped), deploy-craft judgement, no-fluff style rule.
- Profiles produced before 0.8.0 lack the new section; the UI simply hides the panel (no migration needed).

## [0.7.4] — 2026-10-05

### Changed
- Crosshair mark recolored red (#e0524f) in favicon and sidebar.

## [0.7.3] — 2026-10-05

### Changed
- Crosshair/scope mark added: SVG favicon + sidebar icon beside the DevScope name (accent color); "pump.fun scanner" subtitle removed.

## [0.7.2] — 2026-10-05 (rename)

### Changed
- Project renamed **DevScope** (was Deployer Intelligence Platform / DIP): package names, UI branding, CLI/server/smoke-test banners, provider user-agents, docs (PLAN.md, CLAUDE.md, README). GitHub repo renamed to `0xJonty/DevScope` (old `DIP` URLs redirect); remote updated. Historical changelog entries keep the old name.

## [0.7.1] — 2026-10-05 (fix: thesis image vision)

### Fixed
- Thesis agents could not see token images: SDK sessions default to loading the user's filesystem settings, so a global PreToolUse hook (`cbm-code-discovery-gate`) blocked their Read calls — every thesis reported "image could not be viewed". Fix is two-fold: `settingSources: []` makes pipeline sessions hermetic (no user/project hooks, settings, or CLAUDE.md leak in), and the token image now rides along as an inline base64 content block instead of a Read instruction (`thesis-v1.1.0`). Read dropped from the agent tool list. Verified live: the model described a token image accurately with no tool calls.
- Missing image files are now logged to the scan feed instead of silently running without vision.

## [0.7.0] — 2026-10-05 (profile layout rework; playbook removed)

### Changed — profile format (breaking for new profiles)
- **Playbook signals removed end-to-end** (synthesis schema, prompt, PROFILE.md section, API, UI): the tool's purpose is studying deploy styles as reference for the owner's own deploys, not generating trade signals — dropping it cuts synthesis cost and noise. `prompt_version` bumped to `synthesis-v1.1.0`; the synthesis prompt now explicitly targets "what deploy choices separate hits from misses". Old profiles keep their playbook text in markdown; the UI no longer shows it.
- **Full-width desktop layout** (max 1800px, centred): header now merges the verdict panel with a combined stats + statistical-fingerprint tile grid (bond rate, cadence, lifetime totals, ATH distribution, lifespan, cashback, naming patterns); works/fails split sits directly below; thesis cards flow 3-per-row above ~1500px, 2 below; open questions flows into two columns on wide screens. Standalone fingerprint section removed (merged into header). Library cards go 3-wide on very wide screens.

## [0.6.0] — 2026-10-05 (lifetime highlights + structured profile UI)

### Added
- **Lifetime highlights (S1)**: discovered that pump.fun's `/coins` supports `sort=ath_market_cap` with the creator filter — one free call returns a wallet's all-time top deploys. Fills `lifetime_best_ath_usd`/`best_mint` exactly (found a $130.5M graduate buried behind ~22.5k newer deploys on the first test) and feeds S3.
- **S3 auto-pins** the top `lifetime_top_k` (default 3) career deploys into the dossier with a Solana Tracker ATH max-merge for bonded ones — out-of-window career-defining tokens now always get theses.
- **Structured profile UI**: new `/api/profiles/:wallet/structured` endpoint (DB-backed theses/fingerprint + prose sections parsed from the markdown source of truth) and a rebuilt Profile view — stat-tile header, playbook panel, works/fails split, grouped thesis cards with images, chips, and collapsible evidence, fingerprint grid.

### Fixed
- Re-scans now always re-enumerate the full window (free keyless calls) instead of delta-only, refreshing stale ATHs for tokens that pumped after the previous scan (observed: $6.6k at scan time → token kept moving after). Thesis reuse remains per-mint in S5, so re-scan reasoning cost is unchanged.
- PLAN.md §16: pump.fun `ath_market_cap` post-graduation coverage VERIFIED (a graduated token shows $130.5M); max-merge kept because it can lag low on fresh graduates.

### Investigated, not a bug
- A "Sí 419k" deploy shown by Axiom for the test wallet was launched on Stonk, a different launchpad — out of v1 scope (pump.fun only, PLAN.md §1). pump.fun's own Sí from this wallet peaked at $6.6k, which our data reports correctly. Other-launchpad deploys are a future `DataProvider` addition (Solana Tracker's `/deployer` already takes a `launchpad` param).

## [0.5.1] — 2026-10-05 (post-credentials verification)

### Fixed
- Lifetime context rerouted: Bitquery's free dev tier is **realtime-only** (archive queries 403, verified live; realtime saw 0 of a 230-deploy wallet). Lifetime deploy + graduated totals now come from Solana Tracker `/deployer/{wallet}` (one quota'd call, `graduated` object shape handled); Bitquery archive is attempted opportunistically for the lifetime best-ever ATH and surfaces its plan restriction loudly without blocking the scan. `BITQUERY_API_KEY` is now optional.
- New `lifetime_graduated` column on deployers (migration 0001); profile frontmatter and synthesis input carry `total_graduated`.
- Smoke test: Bitquery checks downgraded to optional (reported, non-gating); added the `/deployer` lifetime-totals check; probes whether the token has archive access.

### Verified live (keys in hand)
- 9/9 smoke checks green. Solana Tracker auth header `x-api-key` CONFIRMED (PLAN.md §16 item closed). Full S1–S2 with real lifetime context: 230 deploys, 6 graduated.

## [0.5.0] — 2026-10-03 (M5: re-scan, polish, acceptance)

### Added
- Delta re-scan wired end to end: a new scan on a profiled wallet enumerates only deploys newer than the prior window, merges window bounds, reuses prior theses verbatim, and feeds the prior profile into synthesis (verified live: "No new deploys since the last scan").
- `scripts/smoke-test.ts` (`npm run smoke`): post-credentials acceptance — validates .env naming each missing variable, one minimal live call per provider (confirms the Solana Tracker `x-api-key` header and Bitquery Bearer auth), and a minimal Agent SDK structured query on subscription auth. Pass/fail per item, non-zero exit on failure.
- README: WSL setup (nvm, claude CLI login), key sources, run/dev/smoke commands, first-scan walkthrough.

### Notes
- Pause/resume polish (auto-resume after usage-window limits, interrupted-scan recovery on boot) and the Settings view shipped in 0.3.0/0.4.0; M5 verified them against the delta path.

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
