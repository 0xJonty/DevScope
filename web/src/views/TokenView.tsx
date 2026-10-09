import { useEffect, useState } from "react";
import { api, fmtUsd, shortWallet, type TokenDetail } from "../api";
import ThesisCard from "../components/ThesisCard";

export default function TokenView({ mint, back, rescan }: { mint: string; back: () => void; rescan: () => void }) {
  const [token, setToken] = useState<TokenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.tokenDetail(mint).then(setToken, (e) => setError(String(e)));
  }, [mint]);

  if (error) return <p className="text-failed text-sm">{error}</p>;
  if (!token) return <p className="text-faint text-sm">Loading…</p>;

  const curve = token.curveStats as { time_to_ath_hours?: number | null } | null;
  const socials = Object.entries(token.socials ?? {});

  const copy = () => {
    void navigator.clipboard.writeText(token.mint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="space-y-6 pb-16 max-w-3xl">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={back} className="text-dim hover:text-ink text-sm shrink-0">← Token Library</button>
          {token.imageUrl && (
            <img src={token.imageUrl} alt="" className="w-9 h-9 rounded-md object-cover border border-line shrink-0" />
          )}
          <h1 className="text-lg font-semibold tracking-tight truncate">{token.name}</h1>
          <span className="text-dim text-sm shrink-0">${token.ticker}</span>
        </div>
        <button onClick={rescan} className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent shrink-0">
          Rescan token
        </button>
      </header>

      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-faint truncate">{token.mint}</span>
        <button onClick={copy} className="text-faint hover:text-accent shrink-0">
          {copied ? "copied" : "copy"}
        </button>
        <a href={`https://pump.fun/coin/${token.mint}`} target="_blank" rel="noreferrer" className="text-faint hover:text-accent ml-2 shrink-0">
          pump.fun ↗
        </a>
        <a href={`https://solscan.io/token/${token.mint}`} target="_blank" rel="noreferrer" className="text-faint hover:text-accent shrink-0">
          solscan ↗
        </a>
      </div>

      <section className="border border-line rounded-lg px-5 py-4 text-sm space-y-2 bg-surface">
        <div className="grid grid-cols-2 min-[900px]:grid-cols-4 gap-4 text-xs">
          <div>
            <div className="text-faint">Deployed</div>
            <div className="text-ink mt-0.5">{new Date(token.createdAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-faint">ATH</div>
            <div className="text-ink mt-0.5">
              {fmtUsd(token.athUsd)}
              {curve?.time_to_ath_hours != null && (
                <span className="text-dim"> · reached in {curve.time_to_ath_hours.toFixed(1)}h</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-faint">Deployer</div>
            <div className="text-ink mt-0.5 font-mono">{shortWallet(token.wallet)}</div>
          </div>
          <div>
            <div className="text-faint">Scanned</div>
            <div className="text-ink mt-0.5">{new Date(token.scannedAt).toLocaleDateString()}</div>
          </div>
        </div>
        {token.description && <p className="text-dim text-sm pt-1">{token.description}</p>}
        {socials.length > 0 && (
          <div className="flex gap-3 pt-1 text-xs">
            {socials.map(([k, url]) => (
              <a key={k} href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                {k} ↗
              </a>
            ))}
          </div>
        )}
      </section>

      <ThesisCard
        t={{
          mint: token.mint,
          name: token.name,
          ticker: token.ticker,
          bonded: token.bonded,
          athUsd: token.athUsd,
          createdAt: token.createdAt,
          imageUrl: token.imageUrl,
          classification: token.classification,
          reason: "token-scan",
          thesis: token.thesis,
        }}
      />
    </div>
  );
}
