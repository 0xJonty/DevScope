import { useEffect, useState } from "react";
import { api, type NarrativeTokenDetail } from "../api";
import { Chip } from "../components/ThesisCard";
import DeployModal from "../components/DeployModal";
import {
  CONFIDENCE_STYLES,
  FEE_LABELS,
  MOMENTUM_STYLES,
  TokenImage,
} from "../components/NarrativeTokenTile";

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

/** Token page for one narrative (Narratives library detail). */
export default function NarrativeTokenView({ id, back }: { id: string; back: () => void }) {
  const [detail, setDetail] = useState<NarrativeTokenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);

  const load = () =>
    api.getNarrativeToken(id).then(setDetail, (e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <p className="text-failed text-sm">{error}</p>;
  if (!detail) return <p className="text-faint text-sm">Loading…</p>;

  const n = detail.narrative;
  const momentum = MOMENTUM_STYLES[n.momentum] ?? null;

  return (
    <div className="space-y-8 max-w-3xl">
      <button onClick={back} className="text-dim text-sm hover:text-ink">
        ← Narratives
      </button>

      <header className="flex items-start gap-5">
        <TokenImage ticker={n.ticker ?? null} imagePath={detail.imagePath} size="w-20 h-20" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-lg font-semibold tracking-tight">{n.token_name ?? n.title}</h1>
            {n.ticker && <span className="text-dim">${n.ticker}</span>}
            {detail.deployed ? (
              <a
                href={`https://pump.fun/coin/${detail.deployed.mint}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs border border-success/40 text-success rounded-full px-2.5 py-1 hover:border-success"
              >
                deployed ↗
              </a>
            ) : (
              <button
                onClick={() => setDeploying(true)}
                className="ml-auto text-xs border border-accent/60 text-accent rounded-full px-2.5 py-1 hover:border-accent"
              >
                Deploy this token
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip text={n.category.replace(/_/g, " ")} />
            {momentum && <Chip text={`${momentum.glyph} ${n.momentum}`} className={momentum.cls} />}
            <Chip text={`confidence ${n.confidence}`} className={CONFIDENCE_STYLES[n.confidence] ?? "text-dim border-line"} />
            {n.fee_type && <Chip text={FEE_LABELS[n.fee_type] ?? n.fee_type} className="text-accent border-accent/40" />}
          </div>
          <p className="text-faint text-xs">
            {n.title} · started {n.started}
            {detail.scan && (
              <>
                {" "}· scanned {new Date(detail.scan.finishedAt ?? detail.createdAt).toLocaleString()} ·{" "}
                {detail.scan.windowDays === 1 ? "24h window" : `${detail.scan.windowDays}d window`} ·{" "}
                {detail.scan.grokModel ?? "grok"} · {detail.scan.promptVersion ?? ""}
              </>
            )}
          </p>
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-dim">Narrative</h2>
        <p className="text-sm text-ink/90 leading-relaxed">{n.summary}</p>
      </section>

      {n.fee_type && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-dim">Fee configuration</h2>
          <div className="border border-line rounded-md px-4 py-3 text-sm">
            <span className="text-accent">{FEE_LABELS[n.fee_type] ?? n.fee_type}</span>
            {n.fee_reason && <span className="text-dim"> — {n.fee_reason}</span>}
          </div>
        </section>
      )}

      {n.key_posts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-dim">Viral posts</h2>
          <ul className="space-y-2">
            {n.key_posts.map((p, i) => (
              <li key={i} className="border border-line rounded-md px-4 py-2.5 text-sm flex gap-3 min-w-0">
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
        </section>
      )}

      {n.unknowns && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-dim">Unknowns</h2>
          <p className="text-dim text-sm leading-relaxed">{n.unknowns}</p>
        </section>
      )}

      {detail.scan?.prompt && (
        <p className="text-faint text-xs">
          Scan focus: “{detail.scan.prompt}” · {detail.scan.relatedTweets} post(s) per narrative requested
        </p>
      )}

      {deploying && (
        <DeployModal
          narrativeTokenId={id}
          onClose={() => setDeploying(false)}
          onDeployed={() => void load()}
        />
      )}
    </div>
  );
}
