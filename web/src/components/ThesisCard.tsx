import { fmtUsd, shortWallet, type StructuredThesis } from "../api";

export const CLASS_STYLES: Record<string, string> = {
  worked: "text-worked border-worked/40",
  mid: "text-mid border-mid/40",
  failed: "text-failed border-failed/40",
  pinned: "text-accent border-accent/40",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "text-worked",
  medium: "text-mid",
  low: "text-faint",
};

export function Chip({ text, className = "text-dim border-line" }: { text: string; className?: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${className}`}>{text}</span>;
}

export default function ThesisCard({ t }: { t: StructuredThesis }) {
  const j = t.thesis;
  return (
    <article className="bg-surface border border-line rounded-lg p-4 flex flex-col">
      <div className="flex items-start gap-3">
        {t.imageUrl ? (
          <img src={t.imageUrl} alt="" className="w-11 h-11 rounded-md object-cover border border-line shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-md bg-raised border border-line shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-medium truncate">{t.name}</span>
            <span className="text-dim text-sm">${t.ticker}</span>
            <span className="font-semibold text-sm ml-auto">{fmtUsd(t.athUsd)} ATH</span>
          </div>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            <Chip text={t.classification === "pinned" ? "career deploy" : t.classification} className={CLASS_STYLES[t.classification] ?? "text-dim border-line"} />
            {t.bonded && <Chip text="bonded" className="text-worked border-worked/40" />}
            {j?.narrative_category && <Chip text={j.narrative_category.replace(/_/g, " ")} />}
            {j?.timing && j.timing !== "n/a" && <Chip text={j.timing.replace(/_/g, " ")} />}
            {j?.confidence && (
              <Chip text={`confidence: ${j.confidence}`} className={`border-line ${CONFIDENCE_STYLES[j.confidence] ?? "text-dim"}`} />
            )}
          </div>
        </div>
      </div>

      {j?.generation_failed ? (
        <p className="text-failed text-sm mt-3">Thesis generation failed: {j.error}</p>
      ) : j?.thesis ? (
        <>
          <p className="text-sm leading-relaxed mt-3">{j.thesis}</p>
          {j.image_notes && <p className="text-dim text-sm mt-2">Image: {j.image_notes}</p>}
          {j.evidence && j.evidence.length > 0 && (
            <details className="mt-2">
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
          {j.unknowns && <p className="text-faint text-xs mt-2">Unknowns: {j.unknowns}</p>}
        </>
      ) : (
        <p className="text-faint text-sm mt-3">No thesis for this token in the latest scan.</p>
      )}

      <div className="flex gap-3 mt-auto pt-3 text-xs">
        <a href={`https://pump.fun/coin/${t.mint}`} target="_blank" rel="noreferrer" className="text-faint hover:text-accent">
          pump.fun ↗
        </a>
        <a href={`https://solscan.io/token/${t.mint}`} target="_blank" rel="noreferrer" className="text-faint hover:text-accent">
          solscan ↗
        </a>
        <span className="text-faint font-mono ml-auto truncate">{shortWallet(t.mint)}</span>
      </div>
    </article>
  );
}
