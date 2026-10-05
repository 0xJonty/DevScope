# Deployer Intelligence Platform

Local tool giving a pump.fun deployer an edge: paste a rival deployer's wallet, get a persistent AI-reasoned `*-PROFILE.md` of their style, strengths, failure modes, and actionable signals. Spec in [PLAN.md](PLAN.md) — v1 ships one feature, **Deployer Scan**.

Two strictly separated layers: deterministic code handles all bulk data (enumeration, ATH scoring, classification, quota, cache); Claude (via the Agent SDK on your Max subscription) only ever sees ≤ ~25 curated token dossiers per scan.

## Setup (WSL2 Ubuntu)

Everything lives in the WSL filesystem (not `/mnt/c`). The UI is opened from Windows Chrome via localhost forwarding (automatic in WSL2).

```bash
# 1. Node LTS via nvm (inside WSL)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
exec $SHELL
nvm install --lts

# 2. Claude Code CLI — the reasoning layer authenticates through its login
npm install -g @anthropic-ai/claude-code
claude   # complete the login with your Claude Max account, then exit

# 3. Project
git clone https://github.com/0xJonty/DIP.git ~/build/DIP
cd ~/build/DIP
npm install
npm --prefix web install

# 4. Credentials
cp .env.example .env
# fill in the two keys (see below), leave AUTH_MODE=subscription
```

### Where to get each key

| Variable | Where | Free tier |
|---|---|---|
| `SOLANA_TRACKER_API_KEY` | <https://www.solanatracker.io/data-api> → sign up → API key | 2,500 req/month @ 3 req/s, no card |
| `BITQUERY_API_KEY` *(optional)* | <https://account.bitquery.io> → API → Access Tokens | free tier is realtime-only; only enriches lifetime best-ever ATH (needs archive dataset = paid plan) |
| pump.fun frontend API | no key needed (unofficial) | — |
| GeckoTerminal | no key needed | ~30 req/min |

`ANTHROPIC_API_KEY` must stay **unset** in subscription mode — startup aborts if it's present, so your key can never be billed silently. If you ever want API billing instead, set `AUTH_MODE=api_key` explicitly.

## Run

```bash
npm run smoke       # acceptance test: validates .env, one live call per provider,
                    # confirms the Agent SDK runs on subscription auth

npm run dev         # builds the UI + starts the server (watch mode)
npm start           # same without watch
```

Open **http://localhost:5717** in Chrome (Windows side).

CLI equivalents:

```bash
npm run cli -- scan <wallet> --name <alias>        # full scan S1→S7
npm run cli -- scan <wallet> --through s2          # data layer only (no AI)
npm run cli -- resume <scanId>                     # resume a paused scan
npm run cli -- estimate <wallet>                   # pre-flight quota estimate
npm run cli -- quota                               # monthly ledger
```

## First real scan (from Chrome)

1. `npm run smoke` — all green.
2. `npm run dev`, open http://localhost:5717.
3. **Scan** tab → paste a deployer wallet you know well (PLAN.md §13: grade the output against ground truth first), optionally name it, keep window 300.
4. Check the pre-flight estimate against the quota meters, hit **Start scan**.
5. Watch the stage rail: S1–S4 are deterministic and fast; S5 runs one Claude thesis per dossier token (web search + token-image vision); S6 synthesizes the profile. A usage-window limit pauses the scan and auto-resumes ~15 min later.
6. When S7 finishes the profile appears in **Library**; the markdown source of truth is written to `/profiles/`.
7. Re-scan any time via **Update scan** — it delta-fetches only new deploys and keeps old theses verbatim.

## Repo map

```
src/providers/    DataProvider implementations + quota ledger (every call metered)
src/pipeline/     S1–S7, each checkpointed + resumable; orchestrator; fingerprint
src/reasoning/    Agent SDK wrapper + versioned prompts (thesis/synthesis)
src/db/           Drizzle schema (SQLite at data/app.db); migrations in /drizzle
src/server/       Fastify (localhost only) + SSE + static UI
web/              React/Vite/Tailwind dark UI
config/           bands.json, scan-defaults.json, providers.json, reasoning.json
profiles/         *-PROFILE.md output (source of truth, gitignored)
scripts/          smoke-test.ts
```

## Versioning & docs

Semver tracked in `package.json` + [CHANGELOG.md](CHANGELOG.md); milestone tags `v0.1.0`–`v0.5.0`. Prompts and classification bands carry their own versions (`prompt_version`, `bands_version`) — every profile records the versions it was generated with.
