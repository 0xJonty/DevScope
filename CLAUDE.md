# CLAUDE.md — DevScope

Personal local tool (WSL2 Ubuntu, Windows 11 Chrome client). v1 features: Dev Scan (deployer profiling, S1–S7) + Token Scan (single-contract thesis, 0.9.0) + Vamp Scan (opt-in launch-window PvP analysis, 0.10.0) + Narrative X Scan (Grok-sourced live-X narrative research, 0.12.0) + Token Deploy (built-in pump.fun launcher, 0.14.0) + Mimic Dev (deploy-pattern studies on a profiled dev's last ~100 deploys, 0.18.0).
**`PLAN.md` is the authoritative spec — read it before architectural work. This file governs how you work in this repo.**

## Project snapshot

- TypeScript everywhere. Node LTS. Fastify backend + SSE, React/Vite/Tailwind frontend, SQLite via Drizzle.
- Two-layer rule (never violate): **Layer A** deterministic code handles all bulk data (enumeration, ATH scoring, classification, filtering, quota, cache). **Layer B** Claude Agent SDK (subscription auth) only ever receives curated dossiers (≤ ~25 tokens/scan) for theses + profile synthesis.
- Data providers sit behind the `DataProvider` interface with a monthly quota ledger. Cache is permanent (on-chain history is immutable).
- Reasoning runs on the owner's Claude Max 5x subscription: assert subscription auth on startup; never let a stray `ANTHROPIC_API_KEY` bill silently. Auth mode stays a config flag (`subscription` | `api_key`).
- Grok (xAI) is the second subscription-auth provider (Narrative X Scan only, PLAN.md §7d): device-code OAuth tokens in `data/grok-auth.json`, `GROK_AUTH_MODE` flag with the same silent-billing guard (`assertGrokAuthMode`). It is NOT a `DataProvider` and never enters the monthly quota ledger — xAI's own weekly allowance is the quota. The OAuth surface is unofficial (Grok CLI client id); `api_key` is the sanctioned fallback if xAI 403s the tier.
- Server binds localhost only. No private keys exist anywhere in this system EXCEPT the deploy wallets (`data/wallets.json`, gitignored, 0600, imported via Settings → Wallets; one is "main") that sign pump.fun deploys (PLAN.md §7e) — fund only what you'll spend. Secrets never leave `src/deploy/wallets.ts`, are never logged and never returned by any API. The pump.fun session cookie for charity deploys lives in `data/pump-auth.json` (same rules).

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
- Cheap pipeline testing: `npm run cli -- scan <wallet> --through s2|s4` runs stages without Layer B cost; one-off tsx scripts must live inside the repo (module resolution fails from /tmp; `npx tsx -e` also can't resolve repo imports — write a temp file in scripts/ and delete it).
- Quick boot test without the dev server: `(PORT=5799 npx tsx src/server/index.ts &) && sleep 4 && curl -s localhost:5799/api/<route> && kill $(lsof -ti:5799)` — confirms migrations apply and routes register.
- Live regression checks: `npx tsx scripts/verify-mayhem-filter.ts <creator>` (free) after touching provider schemas/filters; `scripts/verify-scrapling-agent.ts` (one small Layer B call) after touching agent tooling; `scripts/verify-vamp-window.ts <mint>` (1–2 Solana Tracker calls, no Layer B) after touching the search client or vamp similarity scorer; `scripts/verify-grok-narrative.ts` (1 Grok subscription-quota call, no Layer B) after touching the Grok client or its parser; `scripts/verify-deploy-pin.ts` (free) after touching the pinner, `scripts/verify-vanity-grind.ts <suffix>` (free, CPU) after touching the grind, `scripts/verify-deploy-dryrun.ts` (free mainnet simulate; clean pass needs a funded burner) after touching anything in `src/deploy/`. Fixture wallets/mints are passed as args — never committed.
- Policy exclusions (e.g. mayhem-mode tokens) filter at the provider boundary — excluded rows never enter the DB; S1 purges stale cached rows and reports exclusions in the scan feed. Mayhem exclusion is user-flaggable (0.11.0): `config/filters.json` `include_mayhem` (Settings toggle); flag on = mayhem rows flow through as ordinary deploys, flag off purges them again on the next scan.
- Stop the dev server with `kill $(lsof -ti:5717)` — `pkill -f` matches the shell wrapper and kills itself (exit 144).
- Pipeline stages (S1–S7) are individually resumable; never write a stage that can't checkpoint. The Token Scan mini-pipeline (PLAN.md §7b) follows the same rule via idempotent steps, and shares S2's ATH rule, S4's enrichment, and S5's thesis generator (`generateOrReuseThesis`) — change those in one place only. The Vamp Scan (§7c) checkpoints on its own row (`window_tokens`/`shortlist` columns) so a resume never re-spends the quota'd search.
- Vamp candidates NEVER enter the `tokens` table — they'd skew per-wallet stats for any deployer who owns one. The shortlist JSON on `vamp_scans` is the whole record. Vamp scans are always opt-in (🦇 button / token-scan flag) — never run one by default.
- Mimic Dev studies (§7f) checkpoint on their own row (`digest`/`study` columns) — a resume never re-fetches. The digest is a fresh free enumeration snapshot: mimic reads/writes NOTHING in `tokens` (stale cache must never skew a study). Example-mapping mints and the X handle are mechanically gated against the digest/candidate list — invented references are dropped loudly, never kept; a null handle forces a null twitter-style section. The canonicality rule runs in reverse here: describe the dev's spelling/casing exactly as shipped, never "improved". One study in flight per wallet. Regression: `npx tsx scripts/verify-mimic-digest.ts <wallet>` (free, no Layer B) after touching the mimic pipeline/digest stats; `npm run cli -- mimic <wallet> --digest-only` is the cheap iteration path.
- Narrative X Scans (§7d) checkpoint on their own row (`grok_raw` column) — a resume never re-spends the Grok call. Layer B never searches in N2 (the Grok report is its only source), and every `key_posts` URL is mechanically gated against the report/citations — invented links are dropped loudly, never kept (per-post `website` strings gated the same way, 0.17.0). Narrative tokens (`narrative_tokens`, one row per tokenable narrative) NEVER enter the `tokens` table — concepts, not deployed coins. Ticker/name canonicality rule: the crowd's exact spelling from the report is ground truth — prompts must never let the agent "improve" it.
- Token Deploys (§7e) are pure Layer A — the Agent SDK must never appear anywhere in `src/deploy/`. Deployed tokens NEVER enter the `tokens` table (confirmed deploys mark `narrative_tokens` via the `deployments.narrative_token_id` link instead). One deploy in flight at a time, own queue — never `scanQueue`. A `confirming` row with a signature is never auto-failed; reconcile against the chain. Never commit real mints/signatures/wallet addresses from deploys (public repo — same rule as fixture wallets). No slippage/priority-fee UI fields ever (0.15.0, verified against pump.fun's own frontend constants — internal config only). Fee shares (`updateFeeSharesV2`) can be set ONCE per coin; a failed charity split never un-confirms a deploy. Never call per-mint `resolveQuoteMint` in a loop — the quote list resolves in bulk (~380 RPC calls otherwise, hung live).
- Validate every external response (providers, agent outputs) against schemas; fail loud, never silently degrade data.
- Agent SDK `outputFormat` JSON schemas: hard constraints (minLength/maxLength/enum) must be in the schema properties themselves — a limit written only in a `description` is not enforced and WILL drift (live failure 0.13.1). Keep the zod gate slightly looser than the JSON schema and normalize formatting (case/$/whitespace) before validating.
- Reasoning prompts live in `/src/reasoning/prompts/` as versioned files — treat prompt edits like code changes (commit, version, changelog if behavior shifts).
- Reasoning prompt standards (owner-set, keep on every edit): study-not-trade framing (never "fade X"-style trader phrasing), no fluff, no fingerprint-stat recaps in prose sections, cross-cutting patterns stated once in `deployer_patterns_md`, ATH-centric performance judgment (full retrace is the default outcome — never narrate retrace/drawdown/longevity as findings; time-to-ATH only as a buying-arrival signal), positive assertions (state what a deploy IS — no elimination framing or self-contradiction; competing reads go to `unknowns`). S5 soft-lints fresh theses for drift against these (flag in feed, never fails).
- Adding a profile section touches the whole chain: `schemas.ts` (zod + JSON schema) → `profile-render.ts` → `routes.ts` section() → `web/src/api.ts` → `ProfileView.tsx`. Old profiles lack new sections; UI must null-hide them.
- Test data-layer work against real deployer wallets early; quota estimates before scans, always.
- Keep it simple: this runs at 1–2 scans/day for one user. No premature scaling, no unnecessary abstraction beyond the `DataProvider` interface.
