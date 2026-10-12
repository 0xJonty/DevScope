import { useEffect, useMemo, useState } from "react";
import { api, type NarrativeTokenCard } from "../api";
import NarrativeTokenTile from "../components/NarrativeTokenTile";
import DeployModal from "../components/DeployModal";

/** Narratives library — every tokenable narrative as its own token card,
 * grouped under scan-date separators (newest day first). */
export default function NarrativesView({ openToken }: { openToken: (id: string) => void }) {
  const [entries, setEntries] = useState<NarrativeTokenCard[] | null>(null);
  const [deployId, setDeployId] = useState<string | null>(null);

  const load = () => api.listNarrativeTokens().then(setEntries, () => setEntries([]));
  useEffect(() => {
    void load();
  }, []);

  const groups = useMemo(() => {
    if (!entries) return [];
    const byDay = new Map<string, NarrativeTokenCard[]>();
    for (const e of entries) {
      const day = new Date(e.createdAt).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const bucket = byDay.get(day) ?? [];
      bucket.push(e);
      byDay.set(day, bucket);
    }
    // Entries arrive newest-first; Map preserves insertion order, so the
    // day groups are already newest-first too.
    return [...byDay.entries()];
  }, [entries]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Narratives</h1>
        <p className="text-dim text-sm mt-1">
          Every tokenable narrative found by a Narrative X Scan — one token concept per card, grouped by scan date.
        </p>
      </header>

      {entries === null && <p className="text-faint text-sm">Loading…</p>}
      {entries?.length === 0 && (
        <div className="border border-line rounded-md px-6 py-10 text-center text-dim text-sm">
          No narratives yet. Run one from the Narrative X Scan tab.
        </div>
      )}

      {groups.map(([day, tokens]) => (
        <section key={day} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium text-dim shrink-0">{day}</h2>
            <div className="h-px bg-line flex-1" />
            <span className="text-faint text-xs shrink-0">{tokens.length} narrative{tokens.length === 1 ? "" : "s"}</span>
          </div>
          <div className="grid grid-cols-2 min-[1500px]:grid-cols-3 gap-4">
            {tokens.map((t) => (
              <NarrativeTokenTile key={t.id} t={t} onOpen={openToken} onDeploy={setDeployId} />
            ))}
          </div>
        </section>
      ))}

      {deployId && (
        <DeployModal
          narrativeTokenId={deployId}
          onClose={() => setDeployId(null)}
          onDeployed={() => void load()}
        />
      )}
    </div>
  );
}
