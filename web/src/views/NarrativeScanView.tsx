import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type GrokStatus,
  type NarrativeScanInfo,
  type ScanEvent,
} from "../api";
import NarrativeCards from "../components/NarrativeCards";

const STATUS_STYLES: Record<string, string> = {
  done: "text-worked border-worked/40",
  failed: "text-failed border-failed/40",
  paused: "text-mid border-mid/40",
  running: "text-accent border-accent/40",
};

const windowLabel = (days: number) => (days === 1 ? "last 24 hours" : `last ${days} days`);

export default function NarrativeScanView({ openLibrary }: { openLibrary: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(2);
  const [maxDays, setMaxDays] = useState(7);
  const [grok, setGrok] = useState<GrokStatus | null>(null);
  const [login, setLogin] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [scan, setScan] = useState<NarrativeScanInfo | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshGrok = useCallback(() => api.grokStatus().then(setGrok, () => undefined), []);

  useEffect(() => {
    api.grokStatus().then((s) => {
      setGrok(s);
      setDays(s.windowDaysDefault);
      setMaxDays(s.windowDaysMax);
    }, () => undefined);
  }, []);

  // While a device login is pending, watch for the server-side poll to land.
  useEffect(() => {
    if (!grok?.loginPending) return;
    const t = setInterval(() => void refreshGrok(), 3000);
    return () => clearInterval(t);
  }, [grok?.loginPending, refreshGrok]);
  useEffect(() => {
    if (grok?.loggedIn) setLogin(null);
  }, [grok?.loggedIn]);

  const refreshScan = useCallback((id: string) => {
    api.getNarrativeScan(id).then(setScan, () => undefined);
  }, []);

  // Resume watching the latest narrative scan on mount.
  useEffect(() => {
    api.listNarrativeScans().then((scans) => {
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
        if (ev.type === "done" || ev.type === "paused" || ev.type === "error") refreshScan(scan.id);
      },
      "narrative-scans"
    );
    return unsubscribe;
  }, [scan?.id, refreshScan]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const connect = async () => {
    setError(null);
    try {
      const l = await api.grokLogin();
      setLogin(l);
      await refreshGrok();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const start = async () => {
    setError(null);
    setEvents([]);
    try {
      const res = await api.createNarrativeScan(prompt.trim(), days);
      await api.startNarrativeScan(res.scanId);
      refreshScan(res.scanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const running = scan?.status === "running";
  const needsLogin = grok != null && !grok.loggedIn;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Narrative X Scan</h1>
        <p className="text-dim text-sm mt-1">
          Grok searches live X for what's actually moving right now; Claude shapes the raw report into discrete
          narratives with the most viral posts linked. Billed to your X Premium allowance, not API credit.
        </p>
      </header>

      <section className="space-y-4 max-w-xl">
        {needsLogin && (
          <div className="border border-mid/40 rounded-md px-4 py-3 text-sm space-y-2">
            <p className="text-mid">Grok is not connected{grok.authMode === "subscription" ? " — sign in with the X account that holds your subscription." : ""}.</p>
            {login ? (
              <div className="space-y-1">
                <p className="text-ink">
                  Open{" "}
                  <a href={login.verificationUri} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
                    {login.verificationUri}
                  </a>{" "}
                  and enter code <span className="font-mono text-accent">{login.userCode}</span>
                </p>
                <p className="text-faint text-xs">{grok.loginPending ? "Waiting for approval…" : "Login window expired — connect again."}</p>
              </div>
            ) : (
              <button onClick={connect} className="bg-accent text-bg font-medium rounded-md px-4 py-1.5 text-sm">
                Connect Grok
              </button>
            )}
            {grok.loginError && <p className="text-failed text-xs">{grok.loginError}</p>}
          </div>
        )}

        <div>
          <label className="text-dim text-xs block mb-1.5" htmlFor="narrative-prompt">
            What to look for (optional — empty scans the whole timeline)
          </label>
          <textarea
            id="narrative-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. crypto drama, AI model releases, political flashpoints — or leave empty for the biggest stories overall"
            rows={2}
            maxLength={500}
            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-sm placeholder:text-faint focus:outline-none focus:border-accent resize-y"
          />
        </div>

        <div>
          <label className="text-dim text-xs block mb-1.5" htmlFor="narrative-window">
            Freshness window — <span className="text-ink">{windowLabel(days)}</span>
          </label>
          <input
            id="narrative-window"
            type="range"
            min={1}
            max={maxDays}
            step={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-full accent-[#e0524f]"
          />
          <div className="flex justify-between text-faint text-xs mt-0.5">
            <span>24h</span>
            <span>{maxDays} days</span>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          <button
            onClick={start}
            disabled={running || needsLogin}
            className="bg-accent text-bg font-medium rounded-md px-5 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Find narratives
          </button>
          {scan && scan.status === "paused" && (
            <button
              onClick={() => api.startNarrativeScan(scan.id).then(() => refreshScan(scan.id))}
              className="border border-line rounded-md px-4 py-2 text-sm hover:border-accent"
            >
              Resume scan
            </button>
          )}
          {error && <span className="text-failed text-sm">{error}</span>}
        </div>
      </section>

      {scan && (
        <section className="space-y-4">
          <div className="flex items-baseline gap-3">
            <h2 className="font-medium">
              {scan.prompt || "Timeline-wide"} · {windowLabel(scan.windowDays)}
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
            className="bg-surface border border-line rounded-md px-4 py-3 h-56 overflow-y-auto font-mono text-xs leading-relaxed max-w-3xl"
          >
            {events.length === 0 && <span className="text-faint">Waiting for events…</span>}
            {events.map((ev, i) => (
              <div key={i} className={ev.type === "error" ? "text-failed" : ev.type === "agent" ? "text-accent" : ev.type === "paused" ? "text-mid" : "text-dim"}>
                <span className="text-faint">{new Date(ev.at).toLocaleTimeString()} </span>
                {ev.message}
              </div>
            ))}
          </div>

          {scan.status === "done" && scan.narratives && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between max-w-3xl">
                <h3 className="text-sm font-medium text-dim">Narratives</h3>
                <button onClick={openLibrary} className="text-accent text-sm hover:underline">
                  Open in Narratives →
                </button>
              </div>
              <NarrativeCards report={scan.narratives} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
