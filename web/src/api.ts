export interface QuotaMap {
  [provider: string]: { used: number; limit: number };
}

export interface EstimateMap {
  [provider: string]: { estimated: number; note: string };
}

export interface StageInfo {
  id: string;
  label: string;
  status: "pending" | "running" | "done";
}

export interface ScanInfo {
  id: string;
  wallet: string;
  status: "running" | "paused" | "failed" | "done";
  statusReason: string | null;
  startedAt: number;
  finishedAt: number | null;
  windowN: number;
  stages: StageInfo[];
  quotaSpent: Record<string, number> | null;
}

export interface LibraryEntry {
  wallet: string;
  name: string | null;
  verdictSnippet: string | null;
  updatedAt: number;
  bondRate: number | null;
  bestAthUsd: number | null;
  tokenCount: number;
  lifetimeDeploys: number | null;
}

export interface ScanEvent {
  type: string;
  scanId: string;
  stage?: string;
  message: string;
  current?: number;
  total?: number;
  at: number;
}

export interface TokenScanInfo {
  id: string;
  mint: string;
  status: "running" | "paused" | "failed" | "done";
  statusReason: string | null;
  startedAt: number;
  finishedAt: number | null;
  quotaSpent: Record<string, number> | null;
  name: string | null;
  ticker: string | null;
  imageUrl: string | null;
  vampRequested: boolean | null;
  vampScanId: string | null;
}

export interface VampScanInfo {
  id: string;
  mint: string;
  triggerScanId: string | null;
  status: "running" | "paused" | "failed" | "done";
  statusReason: string | null;
  startedAt: number;
  finishedAt: number | null;
  windowMinutes: number;
  athFloorUsd: number;
  candidatesTotal: number | null;
  candidatesFiltered: number | null;
  quotaSpent: Record<string, number> | null;
}

export interface VampCounterpart {
  mint: string;
  name: string;
  relationship: "victim" | "vamper" | "pvp_rival";
}

export interface VampVerdictJson {
  role?: "vamped_another" | "got_vamped" | "pvp_won" | "pvp_no_winner" | "no_vamp_found";
  counterparts?: VampCounterpart[];
  deciding_factors?: string[];
  what_let_it_run?: string;
  thesis?: string;
  evidence?: ThesisEvidence[];
  confidence?: string;
  unknowns?: string;
  generation_failed?: boolean;
  error?: string;
}

export interface VampState {
  scan: VampScanInfo | null;
  verdict: VampVerdictJson | null;
  promptVersion: string | null;
}

export interface DevTokenDetail {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  socials: { twitter?: string; telegram?: string; website?: string };
  wallet: string;
  walletName: string | null;
  bonded: boolean;
  athUsd: number | null;
  athAt: number | null;
  createdAt: number;
  imageUrl: string | null;
  classification: string;
  curveStats: Record<string, unknown> | null;
  replyCount: number | null;
  promptVersion: string | null;
  thesis: ThesisJson | null;
}

export interface TokenLibraryEntry {
  mint: string;
  name: string;
  ticker: string;
  imageUrl: string | null;
  wallet: string;
  bonded: boolean;
  athUsd: number | null;
  createdAt: number;
  classification: string;
  scannedAt: number;
  scanId: string;
}

export interface TokenDetail {
  mint: string;
  name: string;
  ticker: string;
  description: string | null;
  socials: { twitter?: string; telegram?: string; website?: string };
  wallet: string;
  bonded: boolean;
  athUsd: number | null;
  athAt: number | null;
  createdAt: number;
  imageUrl: string | null;
  classification: string;
  curveStats: Record<string, unknown> | null;
  replyCount: number | null;
  scannedAt: number;
  promptVersion: string | null;
  thesis: ThesisJson | null;
}

export interface BandSettings {
  worked_mode: "bonded" | "ath_usd";
  worked_min_ath_usd: number;
  mid_min_ath_usd: number;
}

export interface Settings {
  authMode: string;
  scanDefaults: { window_n: number; window_max: number; dossier: { cap: number } };
  bands: BandSettings & { bands_version: string };
  bandDefaults: BandSettings;
  filters: { include_mayhem: boolean };
  promptVersions: { thesis: string; synthesis: string };
  quota: QuotaMap;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    // API errors come back as { error: "message" } — surface just the message.
    let message = `${res.status}: ${body.slice(0, 300)}`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      /* non-JSON body — keep the raw fallback */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export interface Fingerprint {
  windowDays: number;
  deploysPerDay: number;
  medianGapMinutes: number | null;
  activeHoursUtc: number[];
  peakHourUtc: number | null;
  inferredTimezoneGuess: string | null;
  bondRate: number;
  counts: { worked: number; mid: number; failed: number; total: number };
  athUsd: { median: number | null; p90: number | null; max: number | null };
  namingPatterns: Record<string, number>;
  lifespanHours: { median: number | null; p90: number | null };
  cashbackShare: number | null;
  devBuyNote: string;
}

export interface ThesisEvidence {
  claim: string;
  source_url: string;
  found: boolean;
}

export interface ThesisJson {
  narrative_category?: string;
  timing?: string;
  thesis?: string;
  evidence?: ThesisEvidence[];
  confidence?: string;
  unknowns?: string;
  image_notes?: string;
  generation_failed?: boolean;
  error?: string;
}

export interface StructuredThesis {
  mint: string;
  name: string;
  ticker: string;
  bonded: boolean;
  athUsd: number | null;
  createdAt: number;
  imageUrl: string | null;
  classification: string;
  reason: string;
  thesis: ThesisJson | null;
}

export interface StructuredProfile {
  wallet: string;
  name: string | null;
  updatedAt: number;
  scan: { windowN: number; from: number | null; to: number | null; finishedAt: number | null } | null;
  lifetime: { deploys: number | null; graduated: number | null; bestAthUsd: number | null; bestMint: string | null };
  fingerprint: Fingerprint | null;
  sections: {
    verdict: string | null;
    patterns: string | null;
    works: string | null;
    fails: string | null;
    questions: string | null;
  };
  theses: StructuredThesis[];
}

export const api = {
  createScan: (body: { wallet: string; alias?: string; windowN?: number; pinnedMints?: string[] }) =>
    fetch("/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ scanId: string; estimate: EstimateMap; quota: QuotaMap }>(r)),
  startScan: (id: string) => fetch(`/api/scans/${id}/start`, { method: "POST" }).then(json),
  pauseScan: (id: string) => fetch(`/api/scans/${id}/pause`, { method: "POST" }).then(json),
  getScan: (id: string) => fetch(`/api/scans/${id}`).then((r) => json<ScanInfo>(r)),
  listScans: () => fetch("/api/scans").then((r) => json<ScanInfo[]>(r)),
  estimate: (wallet: string, windowN: number) =>
    fetch(`/api/estimate?wallet=${encodeURIComponent(wallet)}&window=${windowN}`).then((r) =>
      json<{ estimate: EstimateMap | null; quota: QuotaMap }>(r)
    ),
  createTokenScan: (mint: string, vamp = false) =>
    fetch("/api/token-scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint, vamp }),
    }).then((r) => json<{ scanId: string; estimate: EstimateMap; quota: QuotaMap }>(r)),
  createVampScan: (mint: string, triggerScanId?: string) =>
    fetch("/api/vamp-scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint, triggerScanId }),
    }).then((r) => json<{ scanId: string; estimate: EstimateMap; quota: QuotaMap }>(r)),
  startVampScan: (id: string) => fetch(`/api/vamp-scans/${id}/start`, { method: "POST" }).then(json),
  getVampScan: (id: string) => fetch(`/api/vamp-scans/${id}`).then((r) => json<VampScanInfo>(r)),
  vampState: (mint: string) => fetch(`/api/vamp/${mint}`).then((r) => json<VampState>(r)),
  vampEstimate: () =>
    fetch("/api/vamp-scans/estimate").then((r) => json<{ estimate: EstimateMap; quota: QuotaMap }>(r)),
  devToken: (mint: string) => fetch(`/api/dev-tokens/${mint}`).then((r) => json<DevTokenDetail>(r)),
  startTokenScan: (id: string) => fetch(`/api/token-scans/${id}/start`, { method: "POST" }).then(json),
  getTokenScan: (id: string) => fetch(`/api/token-scans/${id}`).then((r) => json<TokenScanInfo>(r)),
  listTokenScans: () => fetch("/api/token-scans").then((r) => json<TokenScanInfo[]>(r)),
  tokenEstimate: (mint: string) =>
    fetch(`/api/token-scans/estimate?mint=${encodeURIComponent(mint)}`).then((r) =>
      json<{ estimate: EstimateMap | null; quota: QuotaMap }>(r)
    ),
  tokenLibrary: () => fetch("/api/token-library").then((r) => json<TokenLibraryEntry[]>(r)),
  tokenDetail: (mint: string) =>
    fetch(`/api/token-library/${mint}`).then((r) => json<TokenDetail>(r)),
  library: () => fetch("/api/library").then((r) => json<LibraryEntry[]>(r)),
  profile: (wallet: string) =>
    fetch(`/api/profiles/${wallet}`).then((r) => json<{ wallet: string; name: string | null; markdown: string; updatedAt: number }>(r)),
  profileStructured: (wallet: string) =>
    fetch(`/api/profiles/${wallet}/structured`).then((r) => json<StructuredProfile>(r)),
  rename: (wallet: string, name: string) =>
    fetch(`/api/profiles/${wallet}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(json),
  settings: () => fetch("/api/settings").then((r) => json<Settings>(r)),
  setBands: (bands: BandSettings) =>
    fetch("/api/settings/bands", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bands),
    }).then((r) => json<{ ok: boolean; bands_version: string }>(r)),
  resetBands: () =>
    fetch("/api/settings/bands/reset", { method: "POST" }).then((r) =>
      json<{ ok: boolean; bands_version: string }>(r)
    ),
  setFilters: (include_mayhem: boolean) =>
    fetch("/api/settings/filters", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include_mayhem }),
    }).then((r) => json<{ ok: boolean; include_mayhem: boolean }>(r)),
  quota: () => fetch("/api/quota").then((r) => json<QuotaMap>(r)),
};

export function subscribeScanEvents(
  scanId: string,
  onEvent: (ev: ScanEvent) => void,
  kind: "scans" | "token-scans" | "vamp-scans" = "scans"
): () => void {
  const source = new EventSource(`/api/${kind}/${scanId}/events`);
  source.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as ScanEvent);
    } catch {
      /* heartbeat */
    }
  };
  return () => source.close();
}

/** Base58 Solana address (no 0, O, I, l), 32–44 chars — mirrors the server rule. */
export const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Simple inline-error message for an address input, or null when fine.
 * Empty input returns null — emptiness is handled by disabling the button. */
export const addressError = (value: string, kind: "wallet" | "contract"): string | null => {
  const v = value.trim();
  if (!v || BASE58_ADDRESS.test(v)) return null;
  return `Not a valid ${kind} address — expected base58, 32–44 characters.`;
};

/** Parse a user-typed number input; returns an error message or null. */
export const numberError = (
  value: string,
  label: string,
  opts: { min?: number; max?: number } = {}
): string | null => {
  if (value.trim() === "") return `${label} is required.`;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number.`;
  if (opts.min != null && n < opts.min) return `${label} must be at least ${opts.min.toLocaleString("en-US")}.`;
  if (opts.max != null && n > opts.max) return `${label} must be at most ${opts.max.toLocaleString("en-US")}.`;
  return null;
};

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
