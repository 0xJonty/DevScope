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

export interface Settings {
  authMode: string;
  scanDefaults: { window_n: number; window_max: number; dossier: { cap: number } };
  bands: { bands_version: string; mid_min_ath_usd: number };
  promptVersions: { thesis: string; synthesis: string };
  quota: QuotaMap;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
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
  createTokenScan: (mint: string) =>
    fetch("/api/token-scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mint }),
    }).then((r) => json<{ scanId: string; estimate: EstimateMap; quota: QuotaMap }>(r)),
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
  setBands: (mid_min_ath_usd: number) =>
    fetch("/api/settings/bands", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mid_min_ath_usd }),
    }).then((r) => json<{ ok: boolean; bands_version: string }>(r)),
  quota: () => fetch("/api/quota").then((r) => json<QuotaMap>(r)),
};

export function subscribeScanEvents(
  scanId: string,
  onEvent: (ev: ScanEvent) => void,
  kind: "scans" | "token-scans" = "scans"
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

export const fmtUsd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
