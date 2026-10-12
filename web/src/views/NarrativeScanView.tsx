import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type GrokStatus,
  type NarrativeScanInfo,
  type NarrativeTokenCard,
  type ScanEvent,
} from "../api";
import NarrativeTokenTile from "../components/NarrativeTokenTile";
import DeployModal from "../components/DeployModal";
import GrokConnect from "../components/GrokConnect";

const STATUS_STYLES: Record<string, string> = {
  done: "text-success border-success/40",
  failed: "text-failed border-failed/40",
  paused: "text-mid border-mid/40",
  running: "text-accent border-accent/40",
};

const windowLabel = (days: number) => (days === 1 ? "last 24 hours" : `last ${days} days`);

export default function NarrativeScanView({
  openLibrary,
  openToken,
}: {
  openLibrary: () => void;
  openToken: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [days, setDays] = useState(2);
  const [maxDays, setMaxDays] = useState(7);
  const [tweets, setTweets] = useState(3);
  const [maxTweets, setMaxTweets] = useState(5);
  const [tokens, setTokens] = useState<NarrativeTokenCard[] | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);
  const [grok, setGrok] = useState<GrokStatus | null>(null);
  const [scan, setScan] = useState<NarrativeScanInfo | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const daysInitialized = useRef(false);

  // GrokConnect owns the status fetch/poll; the view just mirrors it to gate
  // the start button and seed the slider bounds once.
  const handleGrokStatus = useCallback((s: GrokStatus) => {
    setGrok(s);
    setMaxDays(s.windowDaysMax);
    setMaxTweets(s.relatedTweetsMax);
    if (!daysInitialized.current) {
      daysInitialized.current = true;
      setDays(s.windowDaysDefault);
      setTweets(s.relatedTweetsDefault);
    }
  }, []);

  const refreshScan = useCallback((id: string) => {
    api.getNarrativeScan(id).then(
      (s) => {
        setScan(s);
        if (s.status === "done") api.listNarrativeTokens(id).then(setTokens, () => undefined);
      },
      () => undefined
    );
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

  const start = async () => {
    setError(null);
    setEvents([]);
    setTokens(null);
    try {
      const res = await api.createNarrativeScan(prompt.trim(), days, tweets);
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
        <GrokConnect onStatus={handleGrokStatus} />

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

        <div>
          <span className="text-dim text-xs block mb-1.5">Related tweets per narrative</span>
          <div className="flex gap-1.5" role="group" aria-label="Related tweets per narrative">
            {Array.from({ length: maxTweets }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => setTweets(n)}
                className={`w-9 h-8 rounded-md border text-sm ${
                  tweets === n ? "border-accent text-accent" : "border-line text-dim hover:text-ink"
                }`}
              >
                {n}
              </button>
            ))}
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
          {scan && (scan.status === "paused" || scan.status === "failed") && (
            <button
              onClick={() => api.startNarrativeScan(scan.id).then(() => refreshScan(scan.id))}
              className="border border-line rounded-md px-4 py-2 text-sm hover:border-accent"
              title="The Grok report is cached on the scan — a retry only re-runs the Claude structuring step."
            >
              {scan.status === "failed" ? "Retry scan" : "Resume scan"}
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

          {scan.status === "done" && tokens && (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium text-dim">Narratives — one token concept each</h3>
                <button onClick={openLibrary} className="text-accent text-sm hover:underline">
                  Open in Narratives →
                </button>
              </div>
              <div className="grid grid-cols-2 min-[1500px]:grid-cols-3 gap-4">
                {tokens.map((t) => (
                  <NarrativeTokenTile key={t.id} t={t} onOpen={openToken} onDeploy={setDeployId} />
                ))}
              </div>
              {deployId && (
                <DeployModal narrativeTokenId={deployId} onClose={() => setDeployId(null)} />
              )}
              {scan.narratives && scan.narratives.stale_dropped.length > 0 && (
                <details>
                  <summary className="text-faint text-xs cursor-pointer select-none">
                    {scan.narratives.stale_dropped.length} item(s) filtered out (stale or non-tokenable)
                  </summary>
                  <ul className="mt-2 space-y-1 border-l border-line pl-3">
                    {scan.narratives.stale_dropped.map((s, i) => (
                      <li key={i} className="text-xs text-dim">
                        <span className="text-ink/80">{s.title}</span> — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
