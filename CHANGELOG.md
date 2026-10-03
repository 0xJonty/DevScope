# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
