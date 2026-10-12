import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, subscribeScanEvents, type MimicStudyInfo, type ScanEvent } from "../api";
import { Chip } from "./ThesisCard";

export function DnaIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M7 3c0 5 10 5 10 9s-10 4-10 9" />
      <path d="M17 3c0 5-10 5-10 9s10 4 10 9" />
      <line x1="8.2" y1="6.5" x2="15.8" y2="6.5" />
      <line x1="8.2" y1="17.5" x2="15.8" y2="17.5" />
    </svg>
  );
}

function Prose({ md }: { md: string }) {
  return (
    <div className="profile-md max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

function StudySection({ title, md }: { title: string; md?: string | null }) {
  if (!md) return null;
  return (
    <div className="border border-line rounded-lg px-5 py-4 space-y-2 min-w-0">
      <h3 className="text-sm font-medium text-dim">{title}</h3>
      <Prose md={md} />
    </div>
  );
}

/**
 * Mimic Dev panel (PLAN.md §7f) — the profile's Mimic tab. Shows the latest
 * deploy-pattern study for the wallet (older studies via the history selector),
 * a live feed while one runs, and the start button. Studies are an extension
 * of the dev scan: research the dev's last ~100 deploys, come back with a
 * followable playbook for deploying in their style.
 */
export default function MimicPanel({ wallet }: { wallet: string }) {
  const [studies, setStudies] = useState<MimicStudyInfo[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    () => api.mimicStudies(wallet).then(setStudies, (e) => setError(String(e))),
    [wallet]
  );

  useEffect(() => {
    setStudies(null);
    setSelectedId(null);
    setEvents([]);
    setError(null);
    void refresh();
  }, [wallet, refresh]);

  const active = studies?.find((s) => s.status === "running" || s.status === "paused");
  const activeId = active?.id ?? null;

  useEffect(() => {
    if (!activeId) return;
    const unsubscribe = subscribeScanEvents(
      activeId,
      (ev) => {
        setEvents((prev) => [...prev.slice(-200), ev]);
        if (ev.type === "done" || ev.type === "paused" || ev.type === "error") void refresh();
      },
      "mimic-scans"
    );
    return unsubscribe;
  }, [activeId, refresh]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const start = useCallback(async () => {
    setError(null);
    setEvents([]);
    try {
      const res = await api.createMimicStudy(wallet);
      await api.startMimicStudy(res.scanId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [wallet, refresh]);

  if (!studies) return <p className="text-faint text-sm">Loading…</p>;

  const done = studies.filter((s) => s.status === "done" && s.study);
  const selected = done.find((s) => s.id === selectedId) ?? done[0] ?? null;
  const j = selected?.study ?? null;

  return (
    <div className="space-y-6 pb-16">
      <div className="flex items-center gap-3 flex-wrap">
        <DnaIcon className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-medium">Mimic studies</h2>
        {j?.confidence && <Chip text={`confidence: ${j.confidence}`} className="text-dim border-line" />}
        {selected?.deployCount != null && (
          <span className="text-faint text-xs">{selected.deployCount} deploys studied</span>
        )}
        {done.length > 1 && (
          <select
            value={selected?.id ?? ""}
            onChange={(e) => setSelectedId(e.target.value)}
            className="bg-surface border border-line rounded-md px-2 py-1 text-xs text-dim"
          >
            {done.map((s) => (
              <option key={s.id} value={s.id}>
                {new Date(s.finishedAt ?? s.startedAt).toLocaleString()}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={start}
          disabled={!!active}
          className="ml-auto flex items-center gap-2 border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent disabled:opacity-50 disabled:hover:border-line shrink-0"
        >
          <DnaIcon className="w-4 h-4" />
          {done.length > 0 ? "New study" : "Study deploy patterns"}
        </button>
      </div>

      {error && <p className="text-failed text-sm">{error}</p>}

      {/* Live feed / paused / failed state for the active study */}
      {active && active.status === "paused" && (
        <p className="text-sm text-mid border border-mid/30 rounded-md px-3 py-2 whitespace-pre-wrap">
          {active.statusReason ?? "Paused."}
          <button
            onClick={() => api.startMimicStudy(active.id).then(refresh)}
            className="ml-3 border border-line rounded px-2 py-0.5 text-xs hover:border-accent"
          >
            Resume
          </button>
        </p>
      )}
      {active && (
        <div
          ref={logRef}
          className="bg-bg border border-line rounded-md px-3 py-2 h-44 overflow-y-auto font-mono text-xs leading-relaxed"
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
      {!active && studies[0]?.status === "failed" && (
        <p className="text-failed text-sm">Last study failed: {studies[0].statusReason ?? "unknown reason"}</p>
      )}

      {/* No study yet */}
      {!selected && !active && (
        <p className="text-dim text-sm max-w-2xl">
          Researches this dev's last ~100 deploys — how raw narratives become their coins (naming, image style,
          fee model, mechanics, X-account tone) — and writes a followable playbook for deploying in their style.
          Free data calls + one Claude run.
        </p>
      )}

      {/* The study */}
      {j && (
        <>
          {j.playbook_md && (
            <section className="border-l-2 border-accent bg-surface rounded-r-lg px-5 py-4 space-y-2">
              <h3 className="text-sm font-medium text-accent">Deploy playbook</h3>
              <Prose md={j.playbook_md} />
            </section>
          )}

          <section className="grid grid-cols-1 min-[1280px]:grid-cols-2 gap-4 items-start">
            <StudySection title="Narrative → token" md={j.narrative_to_token_md} />
            <StudySection title="Ticker + name style" md={j.naming_md} />
            <StudySection title="Image style" md={j.image_style_md} />
            <StudySection title="Fee patterns" md={j.fee_patterns_md} />
            <StudySection title="Deploy mechanics" md={j.deploy_mechanics_md} />
            {j.twitter_handle && j.twitter_style_md && (
              <div className="border border-line rounded-lg px-5 py-4 space-y-2 min-w-0">
                <h3 className="text-sm font-medium text-dim">
                  X account tone —{" "}
                  <a
                    href={`https://x.com/${j.twitter_handle}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent hover:underline"
                  >
                    @{j.twitter_handle} ↗
                  </a>
                </h3>
                <Prose md={j.twitter_style_md} />
              </div>
            )}
          </section>

          {j.example_mappings && j.example_mappings.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-dim">Narrative → deploy examples</h3>
              <div className="grid grid-cols-1 min-[1280px]:grid-cols-2 gap-3">
                {j.example_mappings.map((m) => (
                  <div key={m.mint} className="bg-surface border border-line rounded-lg px-4 py-3 space-y-1.5 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-sm">{m.name}</span>
                      <span className="text-dim text-xs">${m.ticker}</span>
                      <a
                        href={`https://pump.fun/coin/${m.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-faint hover:text-accent text-xs ml-auto shrink-0"
                      >
                        pump.fun ↗
                      </a>
                    </div>
                    <p className="text-dim text-xs">Narrative: {m.narrative}</p>
                    <p className="text-sm leading-relaxed">{m.how}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {j.unknowns && <p className="text-faint text-xs">Unknowns: {j.unknowns}</p>}
          {selected && (
            <p className="text-faint text-xs">
              Studied {new Date(selected.finishedAt ?? selected.startedAt).toLocaleString()}
              {selected.promptVersion ? ` · ${selected.promptVersion}` : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
