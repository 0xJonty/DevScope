import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type EstimateMap,
  type QuotaMap,
  type ScanEvent,
  type TokenDetail,
  type TokenScanInfo,
} from "../api";
import QuotaMeters from "../components/QuotaMeters";
import ThesisCard from "../components/ThesisCard";
import VampPanel, { BatIcon } from "../components/VampPanel";

const STATUS_STYLES: Record<string, string> = {
  done: "text-worked border-worked/40",
  failed: "text-failed border-failed/40",
  paused: "text-mid border-mid/40",
  running: "text-accent border-accent/40",
};

export default function TokenScanView({ openToken }: { openToken: (mint: string) => void }) {
  const [mint, setMint] = useState("");
  const [includeVamp, setIncludeVamp] = useState(false);
  const [estimate, setEstimate] = useState<EstimateMap | null>(null);
  const [quota, setQuota] = useState<QuotaMap | null>(null);
  const [scan, setScan] = useState<TokenScanInfo | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [result, setResult] = useState<TokenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Pre-flight estimate vs remaining quota (same contract as the dev scan).
  useEffect(() => {
    const t = setTimeout(() => {
      if (mint.length >= 32) {
        api.tokenEstimate(mint).then((r) => {
          setEstimate(r.estimate);
          setQuota(r.quota);
        }, () => undefined);
      } else {
        api.quota().then(setQuota, () => undefined);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [mint]);

  const refreshScan = useCallback((id: string) => {
    api.getTokenScan(id).then(
      (s) => {
        setScan(s);
        if (s.status === "done") api.tokenDetail(s.mint).then(setResult, () => undefined);
      },
      () => undefined
    );
  }, []);

  // Resume watching a running/last token scan on mount.
  useEffect(() => {
    api.listTokenScans().then((scans) => {
      const active = scans.find((s) => s.status === "running") ?? scans[0];
      if (active) refreshScan(active.id);
    }, () => undefined);
  }, [refreshScan]);

  useEffect(() => {
    if (!scan?.id) return;
    const unsubscribe = subscribeScanEvents(
      scan.id,
      (ev) => {
        setEvents((prev) => [...prev.slice(-400), ev]);
        if (ev.type === "done" || ev.type === "paused" || ev.type === "error") {
          refreshScan(scan.id);
        }
      },
      "token-scans"
    );
    return unsubscribe;
  }, [scan?.id, refreshScan]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const start = async () => {
    setError(null);
    setEvents([]);
    setResult(null);
    try {
      const res = await api.createTokenScan(mint.trim(), includeVamp);
      await api.startTokenScan(res.scanId);
      refreshScan(res.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = scan?.status === "running";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Token scan</h1>
        <p className="text-dim text-sm mt-1">
          Paste a contract address. One research scan: metadata, ATH, image — then a single Claude thesis on why the
          deploy worked or died.
        </p>
      </header>

      <section className="grid grid-cols-[1fr_auto] gap-10 items-start">
        <div className="space-y-4 max-w-xl">
          <div>
            <label className="text-dim text-xs block mb-1.5" htmlFor="mint">Contract address</label>
            <input
              id="mint"
              value={mint}
              onChange={(e) => setMint(e.target.value)}
              placeholder="token mint (base58)"
              spellCheck={false}
              className="w-full bg-surface border border-line rounded-md px-3 py-2 font-mono text-sm placeholder:text-faint focus:outline-none focus:border-accent"
            />
          </div>

          {estimate && (
            <div className="border border-line rounded-md px-4 py-3 text-xs space-y-1">
              <div className="text-dim mb-1.5">Pre-flight estimate</div>
              {Object.entries(estimate).map(([p, e]) => (
                <div key={p} className="flex gap-2">
                  <span className="w-28 text-faint">{p}</span>
                  <span>~{e.estimated} calls</span>
                  <span className="text-faint">· {e.note}</span>
                </div>
              ))}
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-dim cursor-pointer select-none w-fit">
            <input
              type="checkbox"
              checked={includeVamp}
              onChange={(e) => setIncludeVamp(e.target.checked)}
              className="accent-[#e0524f]"
            />
            <BatIcon className="w-4 h-4" />
            Include vamp scan (who vamped whom in the launch window — ~2 extra Solana Tracker calls + 1 Claude run)
          </label>

          <div className="flex gap-3 items-center">
            <button
              onClick={start}
              disabled={mint.trim().length < 32 || running}
              className="bg-accent text-bg font-medium rounded-md px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start token scan
            </button>
            {scan && scan.status === "paused" && (
              <button
                onClick={() => api.startTokenScan(scan.id).then(() => refreshScan(scan.id))}
                className="border border-line rounded-md px-4 py-2 text-sm hover:border-accent"
              >
                Resume scan
              </button>
            )}
            {error && <span className="text-failed text-sm">{error}</span>}
          </div>
        </div>

        <QuotaMeters quota={quota} />
      </section>

      {scan && (
        <section className="space-y-4">
          <div className="flex items-baseline gap-3">
            {scan.imageUrl && <img src={scan.imageUrl} alt="" className="w-6 h-6 rounded object-cover border border-line self-center" />}
            <h2 className="font-medium">
              {scan.name ? `${scan.name} ($${scan.ticker})` : `${scan.mint.slice(0, 4)}…${scan.mint.slice(-4)}`}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[scan.status] ?? "text-accent border-accent/40"}`}>
              {scan.status}
            </span>
          </div>
          {scan.statusReason && scan.status !== "running" && scan.status !== "done" && (
            <p className="text-sm text-mid border border-mid/30 rounded-md px-3 py-2 max-w-2xl whitespace-pre-wrap">
              {scan.statusReason}
            </p>
          )}

          <div
            ref={logRef}
            className="bg-surface border border-line rounded-md px-4 py-3 h-56 overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {events.length === 0 && <span className="text-faint">Waiting for events…</span>}
            {events.map((ev, i) => (
              <div key={i} className={ev.type === "error" ? "text-failed" : ev.type === "agent" ? "text-accent" : ev.type === "paused" ? "text-mid" : "text-dim"}>
                <span className="text-faint">{new Date(ev.at).toLocaleTimeString()} </span>
                {ev.message}
              </div>
            ))}
          </div>

          {result && (
            <div className="space-y-3 max-w-3xl">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-dim">Result</h3>
                <button onClick={() => openToken(result.mint)} className="text-accent text-sm hover:underline">
                  Open in Token Library →
                </button>
              </div>
              <ThesisCard
                t={{
                  mint: result.mint,
                  name: result.name,
                  ticker: result.ticker,
                  bonded: result.bonded,
                  athUsd: result.athUsd,
                  createdAt: result.createdAt,
                  imageUrl: result.imageUrl,
                  classification: result.classification,
                  reason: "token-scan",
                  thesis: result.thesis,
                }}
              />
              {scan.vampScanId && <VampPanel mint={result.mint} />}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
