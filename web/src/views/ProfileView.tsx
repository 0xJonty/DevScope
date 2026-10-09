import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, fmtUsd, shortWallet, type StructuredProfile, type StructuredThesis } from "../api";
import ThesisCard from "../components/ThesisCard";

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-line rounded-lg px-4 py-3 min-w-0">
      <div className="text-faint text-xs truncate">{label}</div>
      <div className="text-lg font-semibold tracking-tight mt-0.5 truncate">{value}</div>
      {sub && <div className="text-dim text-xs mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Prose({ md }: { md: string }) {
  return (
    <div className="profile-md max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </div>
  );
}

function ThesisGroup({ title, items }: { title: string; items: StructuredThesis[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-dim">{title}</h2>
      <div className="grid grid-cols-2 min-[1500px]:grid-cols-3 gap-3">
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
  const naming = fp
    ? Object.entries(fp.namingPatterns)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
        .join(" · ")
    : "";

  return (
    <div className="space-y-8 pb-16">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={back} className="text-dim hover:text-ink text-sm shrink-0">← Dev Library</button>
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

      {/* Deployer stats + description: verdict beside the full stat/fingerprint tile grid. */}
      <section className="grid grid-cols-1 min-[1280px]:grid-cols-[minmax(380px,2fr)_5fr] gap-4 items-start">
        {profile.sections.verdict && (
          <div className="border-l-2 border-accent bg-surface rounded-r-lg px-5 py-4 h-full">
            <Prose md={profile.sections.verdict} />
          </div>
        )}
        <div className="grid grid-cols-3 min-[1500px]:grid-cols-4 gap-3">
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
          <StatTile
            label="All-time best ATH"
            value={fmtUsd(profile.lifetime.bestAthUsd)}
            sub={profile.lifetime.bestMint ? shortWallet(profile.lifetime.bestMint) : undefined}
          />
          <StatTile
            label="Window ATH"
            value={fmtUsd(fp?.athUsd.max ?? null)}
            sub={fp ? `median ${fmtUsd(fp.athUsd.median)} · p90 ${fmtUsd(fp.athUsd.p90)}` : undefined}
          />
          <StatTile
            label="Deploy cadence"
            value={fp?.medianGapMinutes != null ? `${Math.round(fp.medianGapMinutes)} min` : "—"}
            sub="median gap"
          />
          <StatTile
            label="Peak activity"
            value={fp?.peakHourUtc != null ? `${fp.peakHourUtc}:00 UTC` : "—"}
            sub={fp?.inferredTimezoneGuess ? "tz heuristic available" : undefined}
          />
          <StatTile
            label="Token lifespan"
            value={fp?.lifespanHours.median != null ? `${fp.lifespanHours.median.toFixed(1)}h` : "—"}
            sub={fp?.lifespanHours.p90 != null ? `p90 ${fp.lifespanHours.p90.toFixed(1)}h` : undefined}
          />
          <StatTile
            label="Cashback coins"
            value={fp?.cashbackShare != null ? `${(fp.cashbackShare * 100).toFixed(1)}%` : "—"}
            sub="of window deploys"
          />
          <div className="bg-surface border border-line rounded-lg px-4 py-3 col-span-2 min-[1500px]:col-span-3 min-w-0">
            <div className="text-faint text-xs">Naming patterns (window hits)</div>
            <div className="text-sm mt-1 text-dim truncate">{naming || "—"}</div>
          </div>
        </div>
      </section>

      {profile.sections.patterns && (
        <section className="border border-line rounded-lg px-5 py-4 space-y-2">
          <h2 className="text-sm font-medium text-accent">Deployer patterns</h2>
          <div className="min-[1280px]:columns-2 gap-10">
            <Prose md={profile.sections.patterns} />
          </div>
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

      {profile.sections.questions && (
        <section className="border border-line rounded-lg px-5 py-4 space-y-2">
          <h2 className="text-sm font-medium text-dim">Open questions / low confidence</h2>
          <div className="min-[1280px]:columns-2 gap-10">
            <Prose md={profile.sections.questions} />
          </div>
        </section>
      )}
    </div>
  );
}
