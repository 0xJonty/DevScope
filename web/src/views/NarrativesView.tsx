import { useEffect, useState } from "react";
import { api, type NarrativeScanInfo } from "../api";
import NarrativeCards from "../components/NarrativeCards";

const windowLabel = (days: number) => (days === 1 ? "24h window" : `${days}d window`);

/** Narratives library — every finished Narrative X Scan, newest first.
 * Selecting an entry loads its full report in place. */
export default function NarrativesView() {
  const [entries, setEntries] = useState<NarrativeScanInfo[] | null>(null);
  const [selected, setSelected] = useState<NarrativeScanInfo | null>(null);

  useEffect(() => {
    api.listNarrativeScans().then(
      (rows) => setEntries(rows.filter((r) => r.status === "done")),
      () => setEntries([])
    );
  }, []);

  const open = (id: string) => {
    api.getNarrativeScan(id).then(setSelected, () => undefined);
  };

  if (selected) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <button onClick={() => setSelected(null)} className="text-dim text-sm hover:text-ink">
            ← All narratives
          </button>
          <h1 className="text-lg font-semibold tracking-tight">
            {selected.prompt || "Timeline-wide"}
          </h1>
          <p className="text-faint text-xs">
            {windowLabel(selected.windowDays)} · {new Date(selected.finishedAt ?? selected.startedAt).toLocaleString()} ·{" "}
            {selected.grokModel ?? "grok"} · {selected.promptVersion ?? ""}
          </p>
        </header>
        {selected.narratives ? (
          <NarrativeCards report={selected.narratives} />
        ) : (
          <p className="text-dim text-sm">This scan finished without a narrative report.</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Narratives</h1>
        <p className="text-dim text-sm mt-1">Every finished Narrative X Scan. Click one to reread its report.</p>
      </header>

      {entries === null && <p className="text-faint text-sm">Loading…</p>}
      {entries?.length === 0 && (
        <div className="border border-line rounded-md px-6 py-10 text-center text-dim text-sm">
          No narrative reports yet. Run one from the Narrative X Scan tab.
        </div>
      )}

      <div className="grid grid-cols-2 min-[1500px]:grid-cols-3 gap-4">
        {entries?.map((e) => (
          <article
            key={e.id}
            onClick={() => open(e.id)}
            className="border border-line rounded-lg px-5 py-4 cursor-pointer hover:border-accent/60 bg-surface"
          >
            <div className="flex items-baseline gap-2">
              <h2 className="font-medium truncate">{e.prompt || "Timeline-wide"}</h2>
              <span className="text-faint text-xs ml-auto shrink-0">
                {new Date(e.finishedAt ?? e.startedAt).toLocaleDateString()}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <span className="text-dim">{windowLabel(e.windowDays)}</span>
              {e.narrativeCount != null && (
                <span className="text-ink ml-auto">{e.narrativeCount} narratives</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
