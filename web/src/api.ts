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
  library: () => fetch("/api/library").then((r) => json<LibraryEntry[]>(r)),
  profile: (wallet: string) =>
    fetch(`/api/profiles/${wallet}`).then((r) => json<{ wallet: string; name: string | null; markdown: string; updatedAt: number }>(r)),
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

export function subscribeScanEvents(scanId: string, onEvent: (ev: ScanEvent) => void): () => void {
  const source = new EventSource(`/api/scans/${scanId}/events`);
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
