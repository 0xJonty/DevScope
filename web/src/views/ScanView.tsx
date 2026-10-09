import { useCallback, useEffect, useRef, useState } from "react";
import {
  addressError,
  api,
  BASE58_ADDRESS,
  numberError,
  subscribeScanEvents,
  type EstimateMap,
  type QuotaMap,
  type ScanEvent,
  type ScanInfo,
} from "../api";
import QuotaMeters from "../components/QuotaMeters";

const STAGE_ORDER = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

export default function ScanView() {
  const [wallet, setWallet] = useState("");
  const [alias, setAlias] = useState("");
  const [windowStr, setWindowStr] = useState("300");
  const [pinned, setPinned] = useState("");
  const [estimate, setEstimate] = useState<EstimateMap | null>(null);
  const [quota, setQuota] = useState<QuotaMap | null>(null);
  const [scan, setScan] = useState<ScanInfo | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Inline validation — simple messages next to each field.
  const walletErr = addressError(wallet, "wallet");
  const windowErr = numberError(windowStr, "Window", { min: 10, max: 500 });
  const aliasErr = alias.length > 60 ? "Name must be 60 characters or fewer." : null;
  const pinnedErr = (() => {
    const mints = pinned.trim() ? pinned.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (mints.length > 5) return "At most 5 pinned mints.";
    const bad = mints.find((m) => !BASE58_ADDRESS.test(m));
    return bad ? `"${bad.slice(0, 12)}…" is not a valid mint address (base58, 32–44 chars).` : null;
  })();
  const windowN = Number(windowStr);
  const formValid = wallet.trim().length > 0 && !walletErr && !windowErr && !aliasErr && !pinnedErr;

  // Pre-flight estimate vs remaining quota (PLAN.md §10).
  useEffect(() => {
    const t = setTimeout(() => {
      if (BASE58_ADDRESS.test(wallet.trim()) && !numberError(windowStr, "w", { min: 10, max: 500 })) {
        api.estimate(wallet.trim(), Number(windowStr)).then((r) => {
          setEstimate(r.estimate);
          setQuota(r.quota);
        }, () => undefined);
      } else {
        api.quota().then(setQuota, () => undefined);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [wallet, windowStr]);

  const refreshScan = useCallback((id: string) => {
    api.getScan(id).then(setScan, () => undefined);
  }, []);

  // Resume watching a running/last scan on mount.
  useEffect(() => {
    api.listScans().then((scans) => {
      const active = scans.find((s) => s.status === "running") ?? scans[0];
      if (active) {
        refreshScan(active.id);
      }
    }, () => undefined);
  }, [refreshScan]);

  useEffect(() => {
    if (!scan?.id) return;
    const unsubscribe = subscribeScanEvents(scan.id, (ev) => {
      setEvents((prev) => [...prev.slice(-400), ev]);
      if (ev.type === "stage" || ev.type === "done" || ev.type === "paused" || ev.type === "error") {
        refreshScan(scan.id);
      }
    });
    return unsubscribe;
  }, [scan?.id, refreshScan]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const start = async () => {
    setError(null);
    if (!formValid) {
      setError(walletErr ?? windowErr ?? aliasErr ?? pinnedErr ?? "Enter a wallet address first.");
      return;
    }
    setEvents([]);
    try {
      const res = await api.createScan({
        wallet: wallet.trim(),
        alias: alias.trim() || undefined,
        windowN,
        pinnedMints: pinned.trim() ? pinned.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
      });
      await api.startScan(res.scanId);
      refreshScan(res.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = scan?.status === "running";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Dev scan</h1>
        <p className="text-dim text-sm mt-1">
          Paste a wallet. Layer A enumerates and scores every deploy; Claude writes theses for the dossier only.
        </p>
      </header>

      <section className="grid grid-cols-[1fr_auto] gap-10 items-start">
        <div className="space-y-4 max-w-xl">
          <div>
            <label className="text-dim text-xs block mb-1.5" htmlFor="wallet">Wallet address</label>
            <input
              id="wallet"
              value={wallet}
              onChange={(e) => setWallet(e.target.value)}
              placeholder="creator wallet (base58)"
              spellCheck={false}
              className={`w-full bg-surface border rounded-md px-3 py-2 font-mono text-sm placeholder:text-faint focus:outline-none ${walletErr ? "border-failed/60" : "border-line focus:border-accent"}`}
            />
            {walletErr && <p className="text-failed text-xs mt-1">{walletErr}</p>}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="text-dim text-xs block mb-1.5" htmlFor="alias">Name (optional)</label>
              <input
                id="alias"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className={`w-full bg-surface border rounded-md px-3 py-2 text-sm focus:outline-none ${aliasErr ? "border-failed/60" : "border-line focus:border-accent"}`}
              />
              {aliasErr && <p className="text-failed text-xs mt-1">{aliasErr}</p>}
            </div>
            <div>
              <label className="text-dim text-xs block mb-1.5" htmlFor="window">Window (deploys)</label>
              <input
                id="window"
                type="number"
                min={10}
                max={500}
                value={windowStr}
                onChange={(e) => setWindowStr(e.target.value)}
                className={`w-full bg-surface border rounded-md px-3 py-2 text-sm focus:outline-none ${windowErr ? "border-failed/60" : "border-line focus:border-accent"}`}
              />
              {windowErr && <p className="text-failed text-xs mt-1">{windowErr}</p>}
            </div>
            <div>
              <label className="text-dim text-xs block mb-1.5" htmlFor="pinned">Pin mints (comma-sep)</label>
              <input
                id="pinned"
                value={pinned}
                onChange={(e) => setPinned(e.target.value)}
                className={`w-full bg-surface border rounded-md px-3 py-2 font-mono text-sm focus:outline-none ${pinnedErr ? "border-failed/60" : "border-line focus:border-accent"}`}
              />
              {pinnedErr && <p className="text-failed text-xs mt-1">{pinnedErr}</p>}
            </div>
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

          <div className="flex gap-3 items-center">
            <button
              onClick={start}
              disabled={!formValid || running}
              className="bg-accent text-bg font-medium rounded-md px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Start scan
            </button>
            {scan && running && (
              <button onClick={() => api.pauseScan(scan.id)} className="text-dim text-sm hover:text-ink">
                Pause
              </button>
            )}
            {scan && scan.status === "paused" && (
              <button
                onClick={() => api.startScan(scan.id).then(() => refreshScan(scan.id))}
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
            <h2 className="font-medium">
              {scan.wallet.slice(0, 4)}…{scan.wallet.slice(-4)}
            </h2>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${
                scan.status === "done"
                  ? "text-worked border-worked/40"
                  : scan.status === "failed"
                    ? "text-failed border-failed/40"
                    : scan.status === "paused"
                      ? "text-mid border-mid/40"
                      : "text-accent border-accent/40"
              }`}
            >
              {scan.status}
            </span>
          </div>
          {scan.statusReason && scan.status !== "running" && (
            <p className="text-sm text-mid border border-mid/30 rounded-md px-3 py-2 max-w-2xl whitespace-pre-wrap">
              {scan.statusReason}
            </p>
          )}

          <ol className="flex gap-0 items-center">
            {scan.stages.map((stage, i) => (
              <li key={stage.id} className="flex items-center">
                {i > 0 && <span className="w-6 h-px bg-line" />}
                <span
                  title={stage.label}
                  className={`text-xs px-2.5 py-1 rounded-md border ${
                    stage.status === "done"
                      ? "border-worked/40 text-worked"
                      : stage.status === "running"
                        ? "border-accent text-accent"
                        : "border-line text-faint"
                  }`}
                >
                  {stage.id.toUpperCase()}
                </span>
              </li>
            ))}
          </ol>

          <div
            ref={logRef}
            className="bg-surface border border-line rounded-md px-4 py-3 h-72 overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {events.length === 0 && <span className="text-faint">Waiting for events…</span>}
            {events.map((ev, i) => (
              <div key={i} className={ev.type === "error" ? "text-failed" : ev.type === "agent" ? "text-accent" : ev.type === "paused" ? "text-mid" : "text-dim"}>
                <span className="text-faint">{new Date(ev.at).toLocaleTimeString()} </span>
                {ev.stage ? `[${ev.stage}] ` : ""}
                {ev.message}
                {ev.current != null && ev.total != null ? `  (${ev.current}/${ev.total})` : ""}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
