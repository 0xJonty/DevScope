# CLAUDE.md — DevScope

Personal local tool (WSL2 Ubuntu, Windows 11 Chrome client). v1 features: Dev Scan (deployer profiling, S1–S7) + Token Scan (single-contract thesis, 0.9.0) + Vamp Scan (opt-in launch-window PvP analysis, 0.10.0).
**`PLAN.md` is the authoritative spec — read it before architectural work. This file governs how you work in this repo.**

## Project snapshot

- TypeScript everywhere. Node LTS. Fastify backend + SSE, React/Vite/Tailwind frontend, SQLite via Drizzle.
- Two-layer rule (never violate): **Layer A** deterministic code handles all bulk data (enumeration, ATH scoring, classification, filtering, quota, cache). **Layer B** Claude Agent SDK (subscription auth) only ever receives curated dossiers (≤ ~25 tokens/scan) for theses + profile synthesis.
- Data providers sit behind the `DataProvider` interface with a monthly quota ledger. Cache is permanent (on-chain history is immutable).
- Reasoning runs on the owner's Claude Max 5x subscription: assert subscription auth on startup; never let a stray `ANTHROPIC_API_KEY` bill silently. Auth mode stays a config flag (`subscription` | `api_key`).
- Server binds localhost only. No private keys exist anywhere in this system.

## Git policy — commit and push automatically

- **Every completed change is committed AND pushed without asking for permission.** Do not ask "should I commit?" — commit, push, report.
- Commit at logical units of work (a feature, a fix, a doc sync), not one giant end-of-session commit.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`. Imperative, specific subject lines.
- Never commit: `.env`, `/data/` (SQLite, images), provider keys, anything secret. Keep `.gitignore` current.
- **Repo is PUBLIC.** Never commit scanned-wallet aliases or addresses, personal emails/paths, or anything identifying scan targets — CHANGELOG/PLAN references stay anonymized ("test wallet"). Audit with `git grep <value> $(git rev-list --all)` before pushing anything doubtful.
- If a push fails (no remote / auth), say so once and continue working — don't block on it.

## Documentation freshness — no stale docs

- Any change that outdates existing information **must update that information in the same commit**: `PLAN.md`, this file, `README.md`, `CHANGELOG.md`, `/config/*` comments, prompt files.
- This applies especially to: provider endpoints/limits (PLAN.md §16 verify-at-build items), classification bands, pipeline stages, schemas, commands, and anything in "Project snapshot" above.
- When you verify a VERIFY-AT-BUILD item, check it off in PLAN.md §16 and record the confirmed detail where it belongs.
- If reality and PLAN.md diverge during implementation, update PLAN.md to match reality (with a short note why) — the spec must never describe a system that doesn't exist.

## Versioning

- Semver, tracked in `package.json` + `CHANGELOG.md` (Keep a Changelog format).
- Bump **patch** for fixes/internal changes, **minor** for new user-facing capability (new pipeline stage, new UI view, new provider), **major** for breaking changes to schemas, profile format, or config.
- Every version bump: update `CHANGELOG.md` in the same commit and tag `vX.Y.Z` (`git tag` + push tags).
- Milestones from PLAN.md §13 map to minors: M1 → 0.1.0, M2 → 0.2.0, M3 → 0.3.0, M4 → 0.4.0, M5 → 0.5.0. 1.0.0 = daily-driver stable.
- `prompt_version` (reasoning prompts) and `bands_version` (classification config) are versioned separately inside their files; bump them whenever those files change, since profiles record them.

## Plugins & MCP servers — use these

| Tool | Type | Use for |
|---|---|---|
| **context7** | MCP | Pull current docs before writing code against any library (Fastify, Drizzle, Vite, Claude Agent SDK, Tailwind). Prefer this over memory — API surfaces drift. |
| **ScraplingServer** | MCP | Scraping/inspecting the unofficial pump.fun frontend API and provider docs during VERIFY-AT-BUILD; building the provider-1 client against real responses. |
| **codebase-memory-mcp** | MCP | Record architecture decisions, verified provider endpoint shapes, and gotchas as they're discovered; query it before re-deriving past decisions. |
| **github** | Plugin | Repo operations beyond plain git (issues, releases for version tags, PRs if ever needed). |
| **frontend-design** | Plugin | M4 UI work — the dark-mode interface (PLAN.md §10). Load before building views. |
| **ui-ux-pro-max** | Plugin | M4 alongside frontend-design for layout/UX decisions on Scan/Library/Profile views. |
| **claude-md-management** | Plugin | Maintaining/refactoring this CLAUDE.md when it grows stale (which the docs-freshness rule will trigger). |
| **skill-creator** | Plugin | If a repeated workflow emerges (e.g., "run scan + grade theses"), package it as a skill. |
| **caveman** | Plugin (user) | General user plugin — invoke its skills when their descriptions match the task at hand. |
| **cowork-plugin-management** | Plugin | Only if customizing/creating plugins for this project's workflows. |

Built-in `cc-plugin-*` plugins need no special handling.

## Working conventions

- Layer B (Agent SDK) calls MUST set `settingSources: []` — SDK sessions otherwise inherit user-level hooks/settings (a global PreToolUse hook blocked agents' Read calls). Never have agents Read local files; attach them as inline base64 content blocks (see `src/reasoning/agent.ts`).
- `settingSources: []` also strips user-level MCP servers, so any MCP an agent needs must be passed explicitly via the `mcpServers` query option. Link fetching uses the Scrapling MCP (`SCRAPLING_MCP_COMMAND` in `.env`) — the SDK's built-in WebFetch is a plain bot fetch that x.com answers with HTTP 402 and Instagram/protected sites block.
- Cheap pipeline testing: `npm run cli -- scan <wallet> --through s2|s4` runs stages without Layer B cost; one-off tsx scripts must live inside the repo (module resolution fails from /tmp).
- Live regression checks: `npx tsx scripts/verify-mayhem-filter.ts <creator>` (free) after touching provider schemas/filters; `scripts/verify-scrapling-agent.ts` (one small Layer B call) after touching agent tooling; `scripts/verify-vamp-window.ts <mint>` (1–2 Solana Tracker calls, no Layer B) after touching the search client or vamp similarity scorer. Fixture wallets/mints are passed as args — never committed.
- Policy exclusions (e.g. mayhem-mode tokens) filter at the provider boundary — excluded rows never enter the DB; S1 purges stale cached rows and reports exclusions in the scan feed. Mayhem exclusion is user-flaggable (0.11.0): `config/filters.json` `include_mayhem` (Settings toggle); flag on = mayhem rows flow through as ordinary deploys, flag off purges them again on the next scan.
- Stop the dev server with `kill $(lsof -ti:5717)` — `pkill -f` matches the shell wrapper and kills itself (exit 144).
- Pipeline stages (S1–S7) are individually resumable; never write a stage that can't checkpoint. The Token Scan mini-pipeline (PLAN.md §7b) follows the same rule via idempotent steps, and shares S2's ATH rule, S4's enrichment, and S5's thesis generator (`generateOrReuseThesis`) — change those in one place only. The Vamp Scan (§7c) checkpoints on its own row (`window_tokens`/`shortlist` columns) so a resume never re-spends the quota'd search.
- Vamp candidates NEVER enter the `tokens` table — they'd skew per-wallet stats for any deployer who owns one. The shortlist JSON on `vamp_scans` is the whole record. Vamp scans are always opt-in (🦇 button / token-scan flag) — never run one by default.
- Validate every external response (providers, agent outputs) against schemas; fail loud, never silently degrade data.
- Reasoning prompts live in `/src/reasoning/prompts/` as versioned files — treat prompt edits like code changes (commit, version, changelog if behavior shifts).
- Reasoning prompt standards (owner-set, keep on every edit): study-not-trade framing (never "fade X"-style trader phrasing), no fluff, no fingerprint-stat recaps in prose sections, cross-cutting patterns stated once in `deployer_patterns_md`, ATH-centric performance judgment (full retrace is the default outcome — never narrate retrace/drawdown/longevity as findings; time-to-ATH only as a buying-arrival signal), positive assertions (state what a deploy IS — no elimination framing or self-contradiction; competing reads go to `unknowns`). S5 soft-lints fresh theses for drift against these (flag in feed, never fails).
- Adding a profile section touches the whole chain: `schemas.ts` (zod + JSON schema) → `profile-render.ts` → `routes.ts` section() → `web/src/api.ts` → `ProfileView.tsx`. Old profiles lack new sections; UI must null-hide them.
- Test data-layer work against real deployer wallets early; quota estimates before scans, always.
- Keep it simple: this runs at 1–2 scans/day for one user. No premature scaling, no unnecessary abstraction beyond the `DataProvider` interface.
