import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type EstimateMap,
  type ScanEvent,
  type VampState,
} from "../api";
import { Chip } from "./ThesisCard";

const ROLE_LABELS: Record<string, string> = {
  vamped_another: "vamped another",
  got_vamped: "got vamped",
  pvp_won: "won the PvP",
  pvp_no_winner: "PvP — no winner",
  no_vamp_found: "no vamp found",
};

const ROLE_STYLES: Record<string, string> = {
  vamped_another: "text-worked border-worked/40",
  pvp_won: "text-worked border-worked/40",
  got_vamped: "text-failed border-failed/40",
  pvp_no_winner: "text-mid border-mid/40",
  no_vamp_found: "text-dim border-line",
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  victim: "vamped by this token",
  vamper: "vamped this token",
  pvp_rival: "PvP rival",
};

export function BatIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 5c-.6 1.6-2 2.6-3.6 2.8C7 6.2 4.9 5.3 2 5.6c1.8 1.2 2.7 2.6 2.8 4.3.1 1.5-.3 2.6-.8 3.6 1.7-.8 3.2-.9 4.4-.3 1.1.6 1.8 1.6 2.2 3l1.4-2 1.4 2c.4-1.4 1.1-2.4 2.2-3 1.2-.6 2.7-.5 4.4.3-.5-1-.9-2.1-.8-3.6.1-1.7 1-3.1 2.8-4.3-2.9-.3-5 .6-6.4 2.2C14 7.6 12.6 6.6 12 5z" />
    </svg>
  );
}

/**
 * Vamp scan panel — shared by the Token Library page, the dev-scan token
 * page, and the Token Scan result. Shows the latest verdict for the mint, a
 * live feed while a scan runs, or the opt-in start button. `autostart` fires
 * one scan on mount when nothing exists yet (the bat button already carried
 * the user's consent).
 */
export default function VampPanel({ mint, autostart = false }: { mint: string; autostart?: boolean }) {
  const [state, setState] = useState<VampState | null>(null);
  const [estimate, setEstimate] = useState<EstimateMap | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => api.vampState(mint).then(setState, (e) => setError(String(e))), [mint]);

  useEffect(() => {
    setState(null);
    setEvents([]);
    setError(null);
    startedRef.current = false;
    void refresh();
  }, [mint, refresh]);

  useEffect(() => {
    if (state && !state.verdict && !state.scan) {
      api.vampEstimate().then((r) => setEstimate(r.estimate), () => undefined);
    }
  }, [state]);

  const start = useCallback(async () => {
    setError(null);
    try {
      const res = await api.createVampScan(mint);
      await api.startVampScan(res.scanId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [mint, refresh]);

  // Autostart once: only when no verdict and no prior scan exists.
  useEffect(() => {
    if (autostart && state && !state.verdict && !state.scan && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
  }, [autostart, state, start]);

  const scanId = state?.scan?.status === "running" || state?.scan?.status === "paused" ? state.scan.id : null;
  useEffect(() => {
    if (!scanId) return;
    const unsubscribe = subscribeScanEvents(
      scanId,
      (ev) => {
        setEvents((prev) => [...prev.slice(-200), ev]);
        if (ev.type === "done" || ev.type === "paused" || ev.type === "error") void refresh();
      },
      "vamp-scans"
    );
    return unsubscribe;
  }, [scanId, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  if (!state) return null;
  const { scan, verdict } = state;
  const j = verdict;

  return (
    <section className="bg-surface border border-line rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BatIcon className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium">Vamp scan</h3>
        {j?.role && <Chip text={ROLE_LABELS[j.role] ?? j.role} className={ROLE_STYLES[j.role] ?? "text-dim border-line"} />}
        {j?.confidence && !j.generation_failed && (
          <Chip text={`confidence: ${j.confidence}`} className="text-dim border-line" />
        )}
        {scan && (scan.status === "running" || scan.status === "paused") && (
          <Chip text={scan.status} className={scan.status === "running" ? "text-accent border-accent/40" : "text-mid border-mid/40"} />
        )}
        {scan?.candidatesTotal != null && (
          <span className="text-faint text-xs ml-auto">
            {scan.candidatesTotal} in window · {scan.candidatesFiltered ?? "—"} above floor
          </span>
        )}
      </div>

      {/* Verdict */}
      {j && j.generation_failed && <p className="text-failed text-sm">Verdict generation failed: {j.error}</p>}
      {j && !j.generation_failed && (
        <>
          {j.counterparts && j.counterparts.length > 0 && (
            <ul className="space-y-1">
              {j.counterparts.map((c) => (
                <li key={c.mint} className="text-sm flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-dim text-xs">{RELATIONSHIP_LABELS[c.relationship] ?? c.relationship}</span>
                  <a
                    href={`https://pump.fun/coin/${c.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-faint hover:text-accent text-xs"
                  >
                    pump.fun ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
          {j.deciding_factors && j.deciding_factors.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {j.deciding_factors.map((f) => (
                <Chip key={f} text={f.replace(/_/g, " ")} className="text-accent border-accent/40" />
              ))}
            </div>
          )}
          {j.thesis && <p className="text-sm leading-relaxed">{j.thesis}</p>}
          {j.what_let_it_run && (
            <p className="text-dim text-sm">What let it run first: {j.what_let_it_run}</p>
          )}
          {j.evidence && j.evidence.length > 0 && (
            <details>
              <summary className="text-faint text-xs cursor-pointer hover:text-dim">
                Evidence ({j.evidence.filter((e) => e.found).length}/{j.evidence.length} verified)
              </summary>
              <ul className="mt-1.5 space-y-1">
                {j.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-dim">
                    <span className={e.found ? "text-worked" : "text-faint"}>{e.found ? "✓" : "✗"}</span> {e.claim}
                    {e.source_url && e.found && (
                      <a href={e.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline ml-1">
                        source
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {j.unknowns && <p className="text-faint text-xs">Unknowns: {j.unknowns}</p>}
        </>
      )}

      {/* Live feed while running / paused reason */}
      {scan && scan.status === "paused" && scan.statusReason && !j && (
        <p className="text-sm text-mid border border-mid/30 rounded-md px-3 py-2 whitespace-pre-wrap">
          {scan.statusReason}
          <button
            onClick={() => api.startVampScan(scan.id).then(refresh)}
            className="ml-3 border border-line rounded px-2 py-0.5 text-xs hover:border-accent"
          >
            Resume
          </button>
        </p>
      )}
      {scan && scan.status === "failed" && !j && (
        <p className="text-failed text-sm">{scan.statusReason ?? "Vamp scan failed."}</p>
      )}
      {scan && (scan.status === "running" || (scan.status === "paused" && events.length > 0)) && !j && (
        <div
          ref={logRef}
          className="bg-bg border border-line rounded-md px-3 py-2 h-36 overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {events.length === 0 && <span className="text-faint">Waiting for events…</span>}
          {events.map((ev, i) => (
            <div
              key={i}
              className={
                ev.type === "error" ? "text-failed" : ev.type === "agent" ? "text-accent" : ev.type === "paused" ? "text-mid" : "text-dim"
              }
            >
              <span className="text-faint">{new Date(ev.at).toLocaleTimeString()} </span>
              {ev.message}
            </div>
          ))}
        </div>
      )}

      {/* Start (opt-in — never runs by default) */}
      {!scan && !j && (
        <div className="space-y-2">
          <p className="text-dim text-xs">
            Enumerates every pump.fun deploy within the launch window, filters by ATH, and asks Claude who vamped whom
            — and what decided it.
          </p>
          {estimate && (
            <div className="text-xs text-faint">
              {Object.entries(estimate)
                .filter(([, e]) => e.estimated > 0)
                .map(([p, e]) => `${p} ~${e.estimated}`)
                .join(" · ")}
            </div>
          )}
          <button
            onClick={start}
            className="flex items-center gap-2 border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent"
          >
            <BatIcon className="w-4 h-4" />
            Run vamp scan
          </button>
        </div>
      )}
      {error && <p className="text-failed text-sm">{error}</p>}
    </section>
  );
}
