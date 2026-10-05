import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, fmtUsd, shortWallet, type StructuredProfile, type StructuredThesis } from "../api";

const CLASS_STYLES: Record<string, string> = {
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

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-line rounded-lg px-4 py-3">
      <div className="text-faint text-xs">{label}</div>
      <div className="text-lg font-semibold tracking-tight mt-0.5">{value}</div>
      {sub && <div className="text-dim text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function Chip({ text, className = "text-dim border-line" }: { text: string; className?: string }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${className}`}>{text}</span>;
}

function Prose({ md }: { md: string }) {
  return (
    <div className="profile-md max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

function ThesisCard({ t }: { t: StructuredThesis }) {
  const j = t.thesis;
  return (
    <article className="bg-surface border border-line rounded-lg p-4">
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

      <div className="flex gap-3 mt-3 text-xs">
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

function ThesisGroup({ title, items }: { title: string; items: StructuredThesis[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-dim">{title}</h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((t) => (
          <ThesisCard key={t.mint} t={t} />
        ))}
      </div>
    </section>
  );
}

export default function ProfileView({ wallet, back, rescan }: { wallet: string; back: () => void; rescan: () => void }) {
  const [profile, setProfile] = useState<StructuredProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.profileStructured(wallet).then(setProfile, (e) => setError(String(e)));
  }, [wallet]);

  if (error) return <p className="text-failed text-sm">{error}</p>;
  if (!profile) return <p className="text-faint text-sm">Loading…</p>;

  const fp = profile.fingerprint;
  const career = profile.theses.filter((t) => t.classification === "pinned");
  const worked = profile.theses.filter((t) => t.classification === "worked");
  const mids = profile.theses.filter((t) => t.classification === "mid");
  const failures = profile.theses.filter((t) => t.classification === "failed");

  return (
    <div className="space-y-8 pb-16">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={back} className="text-dim hover:text-ink text-sm shrink-0">← Library</button>
          <h1 className="text-lg font-semibold tracking-tight truncate">{profile.name ?? shortWallet(wallet)}</h1>
          <span className="font-mono text-xs text-faint truncate">{wallet}</span>
          <a href={`https://pump.fun/profile/${wallet}`} target="_blank" rel="noreferrer" className="text-faint hover:text-accent text-xs shrink-0">
            pump.fun ↗
          </a>
        </div>
        <button onClick={rescan} className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent shrink-0">
          Update scan
        </button>
      </header>

      <section className="grid grid-cols-5 gap-3">
        <StatTile
          label="Bond rate (window)"
          value={fp ? `${(fp.bondRate * 100).toFixed(1)}%` : "—"}
          sub={fp ? `${fp.counts.worked}/${fp.counts.total} bonded` : undefined}
        />
        <StatTile label="Deploys / day" value={fp ? String(fp.deploysPerDay) : "—"} sub={fp ? `${fp.windowDays}d window` : undefined} />
        <StatTile
          label="Lifetime deploys"
          value={profile.lifetime.deploys?.toLocaleString() ?? "—"}
          sub={profile.lifetime.graduated != null ? `${profile.lifetime.graduated} graduated` : undefined}
        />
        <StatTile label="All-time best ATH" value={fmtUsd(profile.lifetime.bestAthUsd)} sub={profile.lifetime.bestMint ? shortWallet(profile.lifetime.bestMint) : undefined} />
        <StatTile
          label="Window ATH"
          value={fmtUsd(fp?.athUsd.max ?? null)}
          sub={fp ? `median ${fmtUsd(fp.athUsd.median)}` : undefined}
        />
      </section>

      {profile.sections.verdict && (
        <section className="border-l-2 border-accent bg-surface rounded-r-lg px-5 py-4">
          <Prose md={profile.sections.verdict} />
        </section>
      )}

      {profile.sections.playbook && (
        <section className="bg-surface border border-line rounded-lg px-5 py-4 space-y-2">
          <h2 className="text-sm font-medium text-dim">Playbook signals</h2>
          <Prose md={profile.sections.playbook} />
        </section>
      )}

      {(profile.sections.works || profile.sections.fails) && (
        <section className="grid grid-cols-2 gap-4">
          <div className="border border-line rounded-lg px-5 py-4 space-y-2">
            <h2 className="text-sm font-medium text-worked">What works for them</h2>
            {profile.sections.works && <Prose md={profile.sections.works} />}
          </div>
          <div className="border border-line rounded-lg px-5 py-4 space-y-2">
            <h2 className="text-sm font-medium text-failed">What fails for them</h2>
            {profile.sections.fails && <Prose md={profile.sections.fails} />}
          </div>
        </section>
      )}

      <ThesisGroup title={`Career deploys — all-time tops (${career.length})`} items={career} />
      <ThesisGroup title={`Bonded in window (${worked.length})`} items={worked} />
      <ThesisGroup title={`Almost made it (${mids.length})`} items={mids} />
      <ThesisGroup title={`Representative failures (${failures.length})`} items={failures} />

      {fp && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-dim">Statistical fingerprint</h2>
          <div className="bg-surface border border-line rounded-lg px-5 py-4 grid grid-cols-3 gap-x-8 gap-y-3 text-sm">
            <div>
              <div className="text-faint text-xs">Median gap between deploys</div>
              <div className="mt-0.5">{fp.medianGapMinutes == null ? "—" : `${Math.round(fp.medianGapMinutes)} min`}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Peak activity</div>
              <div className="mt-0.5">{fp.peakHourUtc != null ? `${fp.peakHourUtc}:00 UTC` : "—"}</div>
            </div>
            <div>
              <div className="text-faint text-xs">ATH p90</div>
              <div className="mt-0.5">{fmtUsd(fp.athUsd.p90)}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Token lifespan (median)</div>
              <div className="mt-0.5">{fp.lifespanHours.median != null ? `${fp.lifespanHours.median.toFixed(1)}h` : "—"}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Cashback coins</div>
              <div className="mt-0.5">{fp.cashbackShare != null ? `${(fp.cashbackShare * 100).toFixed(1)}%` : "—"}</div>
            </div>
            <div>
              <div className="text-faint text-xs">Naming patterns</div>
              <div className="mt-0.5 text-dim text-xs leading-relaxed">
                {Object.entries(fp.namingPatterns)
                  .filter(([, v]) => v > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
                  .join(" · ") || "—"}
              </div>
            </div>
          </div>
        </section>
      )}

      {profile.sections.questions && (
        <section className="border border-line rounded-lg px-5 py-4 space-y-2">
          <h2 className="text-sm font-medium text-dim">Open questions / low confidence</h2>
          <Prose md={profile.sections.questions} />
        </section>
      )}
    </div>
  );
}
