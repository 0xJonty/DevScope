import { type NarrativeReport } from "../api";
import { Chip } from "./ThesisCard";

/** Momentum is the card's one loud signal — glyph + color, everything else quiet. */
const MOMENTUM: Record<string, { glyph: string; cls: string }> = {
  exploding: { glyph: "▲", cls: "text-accent border-accent/40" },
  rising: { glyph: "↗", cls: "text-worked border-worked/40" },
  peaking: { glyph: "→", cls: "text-mid border-mid/40" },
  fading: { glyph: "↘", cls: "text-faint border-line" },
};

const CONFIDENCE: Record<string, string> = {
  high: "text-worked border-worked/40",
  medium: "text-mid border-mid/40",
  low: "text-faint border-line",
};

/** "https://x.com/foo/status/123" → "@foo" — the link stays full underneath. */
function postLabel(url: string): string {
  const m = url.match(/(?:x|twitter)\.com\/([^/]+)\/status\//i);
  if (m) return `@${m[1]}`;
  try {
    return new URL(url).hostname;
  } catch {
    return url.slice(0, 40);
  }
}

export default function NarrativeCards({ report }: { report: NarrativeReport }) {
  return (
    <div className="space-y-4">
      {report.narratives.map((n, i) => {
        const momentum = MOMENTUM[n.momentum] ?? MOMENTUM.peaking;
        return (
          <article key={i} className="border border-line rounded-lg px-5 py-4 bg-surface max-w-3xl">
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className={`font-semibold ${momentum.cls.split(" ")[0]}`}>{momentum.glyph}</span>
              <h3 className="font-medium">{n.title}</h3>
              <Chip text={n.category.replace(/_/g, " ")} />
              <Chip text={n.momentum} className={momentum.cls} />
              <span className="text-faint text-xs ml-auto shrink-0">started {n.started}</span>
            </div>
            <p className="text-sm text-ink/90 mt-2.5 leading-relaxed">{n.summary}</p>

            {n.key_posts.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {n.key_posts.map((p, j) => (
                  <li key={j} className="text-sm flex gap-2 min-w-0">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline font-mono text-xs shrink-0 pt-0.5"
                      title={p.url}
                    >
                      {postLabel(p.url)}
                    </a>
                    <span className="text-dim text-xs leading-relaxed">{p.note}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-2 mt-3">
              <Chip text={`confidence ${n.confidence}`} className={CONFIDENCE[n.confidence] ?? "text-dim border-line"} />
              {n.unknowns && <span className="text-faint text-xs truncate" title={n.unknowns}>unknowns: {n.unknowns}</span>}
            </div>
          </article>
        );
      })}

      {report.stale_dropped.length > 0 && (
        <details className="max-w-3xl">
          <summary className="text-faint text-xs cursor-pointer select-none">
            {report.stale_dropped.length} stale item(s) filtered out
          </summary>
          <ul className="mt-2 space-y-1 border-l border-line pl-3">
            {report.stale_dropped.map((s, i) => (
              <li key={i} className="text-xs text-dim">
                <span className="text-ink/80">{s.title}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
