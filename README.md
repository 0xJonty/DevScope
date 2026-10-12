# DevScope

Local tool giving a pump.fun deployer an edge: paste a rival deployer's wallet, get a persistent AI-reasoned `*-PROFILE.md` of their style, strengths, failure modes, and actionable signals. Spec in [PLAN.md](PLAN.md). Three scan types: **Dev Scan** (full deployer profile), **Token Scan** (single contract address → one research thesis, kept in its own Token Library), and **Narrative X Scan** (Grok searches live X globally for viral memes/politics/breaking news; Claude turns each into a ready token concept — ticker, name, fee type, viral posts — kept in the Narratives library). Plus a built-in **Token Deploy** page (0.14.0): launch pump.fun tokens straight from DevScope — direct program calls via the official pump SDK, zero third-party fee, one click from any narrative token.

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
git clone https://github.com/0xJonty/DevScope.git ~/build/DevScope
cd ~/build/DevScope
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

**Grok (Narrative X Scan)** follows the same pattern: `GROK_AUTH_MODE=subscription` (default) uses a one-time `npm run cli -- grok-login` device-code login with the X account that holds your X Premium / SuperGrok subscription — scans then bill the subscription's weekly Grok allowance, not API credit. `XAI_API_KEY` must stay unset in that mode. Fallback (or if xAI rejects your tier on the OAuth surface): set `GROK_AUTH_MODE=api_key` with a key from <https://console.x.ai>.

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
npm run cli -- vamp <mint>                         # vamp scan: launch-window PvP analysis
npm run cli -- narrative "<focus>" --days 2 --tweets 3   # narrative X scan (empty focus = whole timeline)
npm run cli -- grok-login                          # one-time Grok OAuth (device code)
npm run cli -- quota                               # monthly ledger
```

## First real scan (from Chrome)

1. `npm run smoke` — all green.
2. `npm run dev`, open http://localhost:5717.
3. **Dev Scan** tab → paste a deployer wallet you know well (PLAN.md §13: grade the output against ground truth first), optionally name it, keep window 300.
4. Check the pre-flight estimate against the quota meters, hit **Start scan**.
5. Watch the stage rail: S1–S4 are deterministic and fast; S5 runs one Claude thesis per dossier token (web search + token-image vision); S6 synthesizes the profile. A usage-window limit pauses the scan and auto-resumes ~15 min later.
6. When S7 finishes the profile appears in **Dev Library**; the markdown source of truth is written to `/profiles/`.
7. Re-scan any time via **Update scan** — it delta-fetches only new deploys and keeps old theses verbatim.

For a single token instead: **Token Scan** tab → paste the contract address → one research scan (metadata, ATH, image, one Claude thesis). The result renders inline and lands in **Token Library**; a token that already has a thesis (from any scan) reuses it verbatim at zero Claude cost.

**Vamp scan** (opt-in, 🦇): from a profile thesis card, the Token Library detail page, or the Token Scan "include vamp scan" flag. Enumerates every pump.fun deploy within ±5 min of the token's launch (1–2 Solana Tracker calls), filters by ATH floor, and asks Claude who vamped whom — and whether the fight was decided by ticker/name, fees, image, or finer token details.

**Narrative X Scan**: connect Grok once (button on the page, or `grok-login`), optionally type a focus, set the freshness slider (24h–7d) and how many viral posts you want per narrative (1–5), hit **Find narratives**. Grok researches live X globally with its x_search tool (1–3 min) — trending memes, political flashpoints and breaking news with meme energy only (no sports, no generic headlines); Claude turns each narrative into a token concept: optimal ticker + name in the crowd's exact spelling, a recommended fee type with reason, and the viral posts linked. Each narrative gets its own token page in the **Narratives** tab, grouped by scan date (token images are placeholders until image gen lands).

**Token Deploy**: the **Deploy** tab (or the deploy button on any narrative token, which prefills the form from the narrative). Import your deploy wallets in **Settings → Wallets** (base58 Phantom export or 64-byte JSON array; keys stay in `data/wallets.json`, 0600) and mark one **main** — the default signer, switchable per deploy in the form. Fund wallets only with what you'll spend. Pick a **pairing** (SOL, USDC, or any quote pump currently accepts), optionally flip **holder rewards**, or add up to 5 **verified charities** with fee percentages (routed via donate.gg — needs your pump.fun session cookie pasted once in Settings → Wallets). Mints are pre-ground to end in `…pump` (toggleable). No slippage/priority-fee fields — both are internal constants matching pump.fun's own frontend. `SOLANA_RPC_URL` defaults to the public endpoint; a free [Helius](https://www.helius.dev) key makes sends reliable. Metadata pins through pump.fun's own endpoint by default; fallback `pin_backend: "pinata"` + free `PINATA_JWT`. **Dry run** simulates the whole deploy without spending.

## Repo map

```
src/providers/    DataProvider implementations + quota ledger (every call metered); grok.ts (xAI OAuth + x_search)
src/pipeline/     S1–S7, each checkpointed + resumable; orchestrator; fingerprint
src/reasoning/    Agent SDK wrapper + versioned prompts (thesis/synthesis)
src/deploy/       Token Deploy (PLAN.md §7e): burner keypair, IPFS pinning, vanity grind, tx pipeline
src/db/           Drizzle schema (SQLite at data/app.db); migrations in /drizzle
src/server/       Fastify (localhost only) + SSE + static UI
web/              React/Vite/Tailwind dark UI
config/           bands.json, filters.json, scan-defaults.json, providers.json, reasoning.json, narrative.json
profiles/         *-PROFILE.md output (source of truth, gitignored)
scripts/          smoke-test.ts + verify-*.ts live regression checks
```

## Versioning & docs

Semver tracked in `package.json` + [CHANGELOG.md](CHANGELOG.md); milestone tags `v0.1.0`–`v0.5.0`. Prompts and classification bands carry their own versions (`prompt_version`, `bands_version`) — every profile records the versions it was generated with.
