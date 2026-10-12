import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { assertGrokAuthMode, config, narrativeConfig, requireEnv } from "../config.js";

/**
 * Grok (xAI) client for the Narrative X Scan (PLAN.md §7d). Not a DataProvider
 * — it serves live X trend data, not Solana chain data — but it follows the
 * same house rules: schema-validated responses, loud failures, no silent
 * billing.
 *
 * Subscription mode uses xAI's public OIDC surface at https://auth.x.ai
 * (RFC 8628 device-code flow + refresh tokens) with the Grok CLI client id —
 * the same flow Hermes / Kilo / pi-grok-cli use, verified 2026-10-12. Calls
 * then bill the owner's X Premium / SuperGrok weekly allowance instead of API
 * credit. UNOFFICIAL: xAI has been seen to 403 some subscription tiers on this
 * surface; GROK_AUTH_MODE=api_key is the sanctioned fallback.
 */

// Grok CLI public OAuth client (shared by the third-party ecosystem).
const XAI_ISSUER = "https://auth.x.ai";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const REFRESH_SKEW_MS = 120_000;

export class GrokAuthRequiredError extends Error {
  constructor(detail: string) {
    super(`Grok login required — ${detail}. Run \`npm run cli -- grok-login\` or use the Connect button on the Narrative X Scan page.`);
    this.name = "GrokAuthRequiredError";
  }
}

export class GrokApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(`[grok] ${message}`);
    this.name = "GrokApiError";
  }
}

// ── Token store ───────────────────────────────────────────────────────────

interface GrokTokens {
  access_token: string;
  refresh_token: string;
  /** ms epoch when access_token expires. */
  expires_at: number;
}

const tokenStoreSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number(),
});

const tokenPath = () => join(config.dataDir, "grok-auth.json");

function loadTokens(): GrokTokens | null {
  const path = tokenPath();
  if (!existsSync(path)) return null;
  try {
    return tokenStoreSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null; // corrupt store — treated as logged out, overwritten on next login
  }
}

function saveTokens(t: GrokTokens): void {
  writeFileSync(tokenPath(), JSON.stringify(t, null, 2) + "\n");
  chmodSync(tokenPath(), 0o600);
}

export function grokLogout(): void {
  if (existsSync(tokenPath())) unlinkSync(tokenPath());
}

export function grokLoggedIn(): boolean {
  return loadTokens() !== null;
}

// ── OAuth (device-code flow, RFC 8628) ────────────────────────────────────

const discoverySchema = z.object({
  token_endpoint: z.string().url(),
  device_authorization_endpoint: z.string().url(),
});

async function discover(): Promise<z.infer<typeof discoverySchema>> {
  const res = await fetch(`${XAI_ISSUER}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new GrokApiError(`OIDC discovery failed: HTTP ${res.status}`, res.status);
  const parsed = discoverySchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new GrokApiError(`OIDC discovery response failed validation: ${parsed.error.message.slice(0, 200)}`);
  }
  return parsed.data;
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(30_000),
  });
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
});

function toStoredTokens(payload: z.infer<typeof tokenResponseSchema>, fallbackRefresh?: string): GrokTokens {
  const refresh = payload.refresh_token ?? fallbackRefresh;
  if (!refresh) throw new GrokApiError("token response carried no refresh_token");
  return {
    access_token: payload.access_token,
    refresh_token: refresh,
    expires_at: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  /** Resolves when the user approves in the browser (tokens then saved). */
  done: Promise<void>;
}

/** Start the device-code login. Caller shows userCode + verificationUri and
 * awaits `done`; polling runs here. */
export async function startGrokDeviceLogin(): Promise<DeviceLogin> {
  const discovery = await discover();
  const res = await postForm(discovery.device_authorization_endpoint, {
    client_id: XAI_CLIENT_ID,
    scope: XAI_SCOPE,
  });
  if (!res.ok) {
    throw new GrokApiError(`device authorization failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`, res.status);
  }
  const payload = z
    .object({
      device_code: z.string().min(1),
      user_code: z.string().min(1),
      verification_uri: z.string().optional(),
      verification_uri_complete: z.string().optional(),
      interval: z.number().optional(),
      expires_in: z.number().optional(),
    })
    .parse(await res.json());
  const verificationUri = payload.verification_uri_complete ?? payload.verification_uri;
  if (!verificationUri) throw new GrokApiError("device authorization returned no verification_uri");
  const intervalMs = (payload.interval ?? 5) * 1000;
  const expiresInSeconds = payload.expires_in ?? 900;
  const deadline = Date.now() + expiresInSeconds * 1000;

  const done = (async () => {
    for (;;) {
      if (Date.now() >= deadline) throw new GrokApiError("device login timed out — restart the login");
      await new Promise((r) => setTimeout(r, intervalMs));
      const poll = await postForm(discovery.token_endpoint, {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_CLIENT_ID,
        device_code: payload.device_code,
      });
      if (poll.ok) {
        saveTokens(toStoredTokens(tokenResponseSchema.parse(await poll.json())));
        return;
      }
      const body = (await poll.text()).slice(0, 300);
      // RFC 8628: authorization_pending / slow_down are keep-polling signals.
      if (/authorization_pending/.test(body)) continue;
      if (/slow_down/.test(body)) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      throw new GrokApiError(`device login rejected: HTTP ${poll.status} ${body}`, poll.status);
    }
  })();

  return { userCode: payload.user_code, verificationUri, expiresInSeconds, done };
}

async function refreshTokens(current: GrokTokens): Promise<GrokTokens> {
  const discovery = await discover();
  const res = await postForm(discovery.token_endpoint, {
    grant_type: "refresh_token",
    client_id: XAI_CLIENT_ID,
    refresh_token: current.refresh_token,
  });
  if (!res.ok) {
    // 400/401/403 = dead grant — the store is useless, force re-login.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      grokLogout();
      throw new GrokAuthRequiredError(`token refresh rejected (HTTP ${res.status})`);
    }
    throw new GrokApiError(`token refresh failed: HTTP ${res.status}`, res.status);
  }
  const next = toStoredTokens(tokenResponseSchema.parse(await res.json()), current.refresh_token);
  saveTokens(next);
  return next;
}

/** Access token for the configured auth mode; refreshes when near expiry. */
async function getAccessToken(forceRefresh = false): Promise<string> {
  assertGrokAuthMode();
  if (config.grokAuthMode === "api_key") return requireEnv("XAI_API_KEY");
  let tokens = loadTokens();
  if (!tokens) throw new GrokAuthRequiredError("no stored Grok OAuth tokens");
  if (forceRefresh || Date.now() >= tokens.expires_at - REFRESH_SKEW_MS) {
    tokens = await refreshTokens(tokens);
  }
  return tokens.access_token;
}

// ── Narrative search (Responses API + x_search server-side tool) ──────────

export interface GrokNarrativeResult {
  text: string;
  citations: string[];
  model: string;
}

/** Tolerant shape for the Responses API — xAI's surface drifts, so only the
 * fields we consume are pinned; everything else passes through. */
const responsesSchema = z.looseObject({
  output: z
    .array(
      z.looseObject({
        type: z.string(),
        content: z
          .array(
            z.looseObject({
              type: z.string(),
              text: z.string().optional(),
              annotations: z.array(z.looseObject({ type: z.string(), url: z.string().optional() })).optional(),
            })
          )
          .optional(),
      })
    )
    .optional(),
  output_text: z.string().optional(),
  citations: z.array(z.string()).optional(),
});

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * One Grok trend-research call: the prompt plus an x_search tool scoped to the
 * freshness window. Returns Grok's full report text + every cited post URL.
 */
export async function grokNarrativeSearch(opts: {
  prompt: string;
  windowDays: number;
  onActivity?: (message: string) => void;
}): Promise<GrokNarrativeResult> {
  const { base_url, model, timeout_ms } = narrativeConfig.grok;
  // x_search dates are day-granular, inclusive-from / exclusive-to (UTC).
  const fromDate = fmtDate(Date.now() - opts.windowDays * 86_400_000);
  const toDate = fmtDate(Date.now() + 86_400_000);

  const call = async (token: string): Promise<Response> =>
    fetch(`${base_url}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        input: opts.prompt,
        tools: [{ type: "x_search", from_date: fromDate, to_date: toDate }],
      }),
      signal: AbortSignal.timeout(timeout_ms),
    });

  opts.onActivity?.(`Grok ${model} x_search ${fromDate}→${toDate} (window ${opts.windowDays}d)…`);
  let res = await call(await getAccessToken());
  if (res.status === 401 && config.grokAuthMode === "subscription") {
    opts.onActivity?.("Grok returned 401 — refreshing OAuth token and retrying once…");
    res = await call(await getAccessToken(true));
  }
  if (res.status === 401 || res.status === 403) {
    const body = (await res.text()).slice(0, 300);
    throw new GrokAuthRequiredError(
      `xAI rejected the call (HTTP ${res.status}: ${body}). If this persists on a valid login, the subscription tier may not be allowlisted — set GROK_AUTH_MODE=api_key as fallback`
    );
  }
  if (res.status === 429) {
    throw new GrokApiError(`rate/usage limit hit (HTTP 429): ${(await res.text()).slice(0, 300)}`, 429);
  }
  if (!res.ok) {
    throw new GrokApiError(`responses call failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`, res.status);
  }

  const parsed = responsesSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new GrokApiError(`response failed schema validation: ${parsed.error.message.slice(0, 300)}`);
  }

  let text = parsed.data.output_text ?? "";
  const citations = new Set<string>(parsed.data.citations ?? []);
  let toolCalls = 0;
  for (const item of parsed.data.output ?? []) {
    if (/search|tool/.test(item.type)) toolCalls += 1;
    if (item.type !== "message") continue;
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && block.text) {
        if (!parsed.data.output_text) text += (text ? "\n\n" : "") + block.text;
        for (const a of block.annotations ?? []) {
          if (a.url) citations.add(a.url);
        }
      }
    }
  }
  if (toolCalls > 0) opts.onActivity?.(`Grok ran ${toolCalls} search tool call(s).`);
  if (!text.trim()) {
    throw new GrokApiError(`response carried no output text — raw keys: ${Object.keys(parsed.data).join(",")}`);
  }
  return { text, citations: [...citations], model };
}
