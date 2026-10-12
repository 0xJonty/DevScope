import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type Charity,
  type DeployCharity,
  type DeployEstimate,
  type DeployerStatus,
  type Deployment,
  type QuoteOption,
  type ScanEvent,
} from "../api";

export interface DeployPrefill {
  name?: string;
  ticker?: string;
  description?: string;
  twitter?: string;
  website?: string;
  /** Existing narrative image (server path) used when no file is uploaded. */
  imagePath?: string | null;
  holderReward?: boolean;
  narrativeTokenId?: string;
}

const INPUT = "bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-full focus:border-accent focus:outline-none";
const LABEL = "text-dim text-xs";
const SOL_MINT = "So11111111111111111111111111111111111111112";

const EVENT_COLORS: Record<string, string> = {
  error: "text-failed",
  done: "text-success",
  stage: "text-ink",
  log: "text-faint",
};

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function GiftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" />
      <line x1="12" y1="8" x2="12" y2="21" />
      <path d="M12 8c-2.5 0-4.5-1.2-4.5-2.9C7.5 3.9 8.6 3 9.9 3c1.9 0 2.1 2.6 2.1 5z" />
      <path d="M12 8c2.5 0 4.5-1.2 4.5-2.9C16.5 3.9 15.4 3 14.1 3 12.2 3 12 5.6 12 8z" />
    </svg>
  );
}

/** Shared deploy form — the Deploy page and the narrative modal both render this. */
export default function DeployForm({
  prefill,
  onDeployed,
}: {
  prefill?: DeployPrefill;
  onDeployed?: (d: Deployment) => void;
}) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [ticker, setTicker] = useState(prefill?.ticker ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [twitter, setTwitter] = useState(prefill?.twitter ?? "");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState(prefill?.website ?? "");
  const [devBuy, setDevBuy] = useState("0");
  const [holderReward, setHolderReward] = useState(prefill?.holderReward ?? false);
  const [vanity, setVanity] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [quoteMint, setQuoteMint] = useState<string>(SOL_MINT);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [charities, setCharities] = useState<DeployCharity[]>([]);
  const [charityTerm, setCharityTerm] = useState("");
  const [charityResults, setCharityResults] = useState<Charity[]>([]);
  const [pumpSession, setPumpSession] = useState<boolean | null>(null);

  const [deployer, setDeployer] = useState<DeployerStatus | null>(null);
  const [deployerError, setDeployerError] = useState<string | null>(null);
  const [walletPubkey, setWalletPubkey] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<DeployEstimate | null>(null);
  const [phase, setPhase] = useState<"form" | "review" | "running" | "finished">("form");
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [result, setResult] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unsubscribe = useRef<(() => void) | null>(null);

  const imagePreview = useMemo(
    () => (imageFile ? URL.createObjectURL(imageFile) : null),
    [imageFile]
  );
  const prefillImageUrl = prefill?.imagePath
    ? `/images/${prefill.imagePath.split("/").pop()}`
    : null;
  const hasImage = imageFile !== null || prefillImageUrl !== null;

  const isSolQuote = quoteMint === SOL_MINT;
  const quoteSymbol = quotes.find((q) => q.mint === quoteMint)?.symbol ?? "SOL";
  const quoteMatches = useMemo(() => {
    const term = quoteSearch.trim().toLowerCase();
    const pool = term
      ? quotes.filter((q) => q.symbol.toLowerCase().includes(term) || q.mint.toLowerCase().startsWith(term))
      : quotes;
    return pool.slice(0, 50);
  }, [quotes, quoteSearch]);
  const charityBps = charities.reduce((acc, c) => acc + c.shareBps, 0);

  // Deployer strip: poll fast while the grind runs, slow otherwise.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      try {
        const status = await api.getDeployer();
        if (stopped) return;
        setDeployer(status);
        setDeployerError(null);
        setWalletPubkey((cur) =>
          cur && status.wallets.some((w) => w.pubkey === cur)
            ? cur
            : (status.wallets.find((w) => w.isMain) ?? status.wallets[0])?.pubkey ?? null
        );
        timer = setTimeout(tick, status.vanity.grinding ? 2000 : 15000);
      } catch (e) {
        if (stopped) return;
        setDeployerError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(tick, 15000);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    api.deployQuotes().then(setQuotes, () =>
      setQuotes([{ mint: SOL_MINT, symbol: "SOL", decimals: 9, source: "sol" }])
    );
    api.pumpSession().then((s) => setPumpSession(s.set), () => setPumpSession(null));
  }, []);

  // Charity search, debounced.
  useEffect(() => {
    if (charityTerm.trim().length < 2) {
      setCharityResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.searchCharities(charityTerm.trim()).then(setCharityResults, () => setCharityResults([]));
    }, 400);
    return () => clearTimeout(t);
  }, [charityTerm]);

  useEffect(() => () => unsubscribe.current?.(), []);

  const selectedWallet = deployer?.wallets.find((w) => w.pubkey === walletPubkey) ?? null;
  const devBuyNum = Number(devBuy);
  const formError = !walletPubkey
    ? "no deploy wallet — import one in Settings → Wallets"
    : !name.trim()
      ? "name required"
      : !ticker.trim()
        ? "ticker required"
        : !hasImage
          ? "image required"
          : !Number.isFinite(devBuyNum) || devBuyNum < 0
            ? "dev buy must be a non-negative number"
            : charityBps > 10000
              ? "charity shares exceed 100%"
              : charities.length > 0 && pumpSession === false
                ? "charity deploys need a pump.fun session — paste it in Settings → Wallets"
                : null;

  const addCharity = (c: Charity) => {
    if (charities.length >= 5 || charities.some((x) => x.id === c.id)) return;
    setCharities([...charities, { id: c.id, name: c.name, shareBps: 1000 }]);
    setCharityTerm("");
    setCharityResults([]);
  };

  const setCharityPct = (id: string, pct: string) => {
    const bps = Math.round(Number(pct) * 100);
    setCharities(charities.map((c) => (c.id === id ? { ...c, shareBps: Number.isFinite(bps) ? bps : 0 } : c)));
  };

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setEstimate(await api.deployEstimate(devBuyNum, walletPubkey, charities.length > 0, !isSolQuote));
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const launch = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { deploymentId } = await api.createDeployment(
        {
          name: name.trim(),
          ticker: ticker.trim(),
          description: description.trim(),
          twitter: twitter.trim() || undefined,
          telegram: telegram.trim() || undefined,
          website: website.trim() || undefined,
          devBuySol: devBuyNum,
          holderReward,
          quoteMint: isSolQuote ? undefined : quoteMint,
          charities: charities.filter((c) => c.shareBps > 0),
          vanity,
          dryRun,
          narrativeTokenId: prefill?.narrativeTokenId ?? null,
          walletPubkey,
        },
        imageFile
      );
      setPhase("running");
      setEvents([]);
      unsubscribe.current = subscribeScanEvents(
        deploymentId,
        (ev) => {
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "done" || ev.type === "error") {
            unsubscribe.current?.();
            void api.getDeployment(deploymentId).then((d) => {
              setResult(d);
              setPhase("finished");
              onDeployed?.(d);
            });
          }
        },
        "deployments"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPhase("form");
    setEvents([]);
    setResult(null);
    setEstimate(null);
    setError(null);
  };

  return (
    <div className="space-y-5">
      {/* Deployer strip */}
      <div className="border border-line rounded-md px-4 py-2.5 text-xs flex items-center gap-4 flex-wrap">
        {deployer ? (
          deployer.wallets.length === 0 ? (
            <span className="text-mid">No deploy wallet — import one in Settings → Wallets.</span>
          ) : (
            <>
              <label className="text-dim flex items-center gap-2">
                wallet
                <select
                  value={walletPubkey ?? ""}
                  onChange={(e) => setWalletPubkey(e.target.value)}
                  disabled={phase !== "form"}
                  className="bg-surface border border-line rounded-md px-2 py-1 text-xs focus:outline-none focus:border-accent"
                >
                  {deployer.wallets.map((w) => (
                    <option key={w.pubkey} value={w.pubkey}>
                      {w.name}
                      {w.isMain ? " (main)" : ""} — {short(w.pubkey)}
                    </option>
                  ))}
                </select>
              </label>
              {selectedWallet && (
                <>
                  <button
                    className="font-mono text-dim hover:text-accent"
                    title={`${selectedWallet.pubkey} — click to copy`}
                    onClick={() => void navigator.clipboard.writeText(selectedWallet.pubkey)}
                  >
                    {short(selectedWallet.pubkey)}
                  </button>
                  <span className={selectedWallet.balanceSol > 0 ? "text-success" : "text-failed"}>
                    {selectedWallet.balanceSol.toFixed(4)} SOL
                  </span>
                </>
              )}
              <span className="text-faint">
                {deployer.vanity.grinding
                  ? `grinding …pump mint — ${deployer.vanity.attempts.toLocaleString()} tries @ ${deployer.vanity.ratePerSec.toLocaleString()}/s`
                  : `${deployer.vanity.ready} vanity mint${deployer.vanity.ready === 1 ? "" : "s"} ready`}
              </span>
            </>
          )
        ) : (
          <span className="text-faint">{deployerError ?? "loading deployer…"}</span>
        )}
      </div>

      {phase === "form" && (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div className="space-y-1">
              <label className={LABEL}>Name</label>
              <input className={INPUT} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name" />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Ticker</label>
              <input className={INPUT} maxLength={10} value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="TICKER" />
            </div>
          </div>

          <div className="space-y-1">
            <label className={LABEL}>Description (optional)</label>
            <textarea
              className={`${INPUT} h-20 resize-none`}
              maxLength={1000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="optional"
            />
          </div>

          <div className="space-y-1">
            <label className={LABEL}>Image {prefillImageUrl && !imageFile ? "(from narrative — choose a file to replace)" : ""}</label>
            <div className="flex items-center gap-3">
              {(imagePreview ?? prefillImageUrl) && (
                <img src={imagePreview ?? prefillImageUrl ?? undefined} alt="" className="w-14 h-14 rounded-md object-cover border border-line" />
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                className="text-xs text-dim file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-line file:bg-raised file:text-ink file:text-xs file:cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className={LABEL}>Twitter / X URL</label>
              <input className={INPUT} value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="optional" />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Telegram URL</label>
              <input className={INPUT} value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder="optional" />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Website URL</label>
              <input className={INPUT} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="optional" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className={LABEL}>Pairing</label>
              <div className="relative">
                <input
                  className={INPUT}
                  value={quoteOpen ? quoteSearch : quoteSymbol}
                  placeholder={`search ${quotes.length} quotes…`}
                  title="The quote the bonding curve trades against (pump.fun supported list) — type to search by symbol or mint"
                  onFocus={() => {
                    setQuoteSearch("");
                    setQuoteOpen(true);
                  }}
                  onBlur={() => setTimeout(() => setQuoteOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setQuoteOpen(false);
                    if (e.key === "Enter" && quoteMatches[0]) {
                      setQuoteMint(quoteMatches[0].mint);
                      setQuoteOpen(false);
                      e.currentTarget.blur();
                    }
                  }}
                  onChange={(e) => setQuoteSearch(e.target.value)}
                />
                {quoteOpen && (
                  <ul className="absolute z-10 mt-1 w-64 bg-raised border border-line rounded-md max-h-56 overflow-y-auto">
                    {quoteMatches.map((q) => (
                      <li key={q.mint}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault() /* keep focus so onBlur doesn't race the click */}
                          onClick={() => {
                            setQuoteMint(q.mint);
                            setQuoteOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-sm hover:bg-surface flex items-baseline gap-2 ${
                            q.mint === quoteMint ? "text-accent" : ""
                          }`}
                        >
                          <span>{q.symbol}</span>
                          <span className="text-faint text-xs ml-auto font-mono shrink-0">
                            {q.mint.slice(0, 4)}…{q.mint.slice(-4)}
                          </span>
                        </button>
                      </li>
                    ))}
                    {quoteMatches.length === 0 && (
                      <li className="px-3 py-2 text-xs text-faint">no quote matches “{quoteSearch.trim()}”</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Dev buy ({quoteSymbol})</label>
              <input className={INPUT} value={devBuy} onChange={(e) => setDevBuy(e.target.value)} />
            </div>
          </div>
          {!isSolQuote && devBuyNum > 0 && (
            <p className="text-faint text-xs">
              Dev buy is paid in {quoteSymbol} from the deploy wallet's {quoteSymbol} balance.
            </p>
          )}

          <div className="flex items-center gap-4 text-sm flex-wrap">
            <button
              type="button"
              aria-pressed={holderReward}
              onClick={() => setHolderReward(!holderReward)}
              disabled={charities.length > 0}
              title={
                charities.length > 0
                  ? "Remove the charities first — holder rewards sends ALL creator fees to holders"
                  : "Creator fees accrue to holders instead of the creator. PERMANENT per coin."
              }
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-colors disabled:opacity-40 ${
                holderReward
                  ? "border-accent text-accent bg-accent/10"
                  : "border-line text-dim hover:text-ink hover:border-accent/40"
              }`}
            >
              <GiftIcon className="w-4 h-4" />
              holder rewards
            </button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[#e0524f]" checked={vanity} onChange={(e) => setVanity(e.target.checked)} />
              <span className="text-dim">…pump mint address</span>
            </label>
          </div>

          {/* Charities */}
          <div className="space-y-2">
            <label className={LABEL}>
              Charity fees {holderReward ? "— unavailable with holder rewards" : "(pump.fun verified, via donate.gg — up to 5)"}
            </label>
            {!holderReward && (
              <>
                {charities.length > 0 && (
                  <ul className="space-y-1.5">
                    {charities.map((c) => (
                      <li key={c.id} className="flex items-center gap-3 border border-line rounded-md px-3 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <input
                          className="bg-surface border border-line rounded-md px-2 py-1 text-xs w-16 text-right focus:outline-none focus:border-accent"
                          value={String(c.shareBps / 100)}
                          onChange={(e) => setCharityPct(c.id, e.target.value)}
                        />
                        <span className="text-dim text-xs">% of creator fees</span>
                        <button
                          onClick={() => setCharities(charities.filter((x) => x.id !== c.id))}
                          className="text-faint hover:text-failed text-xs"
                        >
                          remove
                        </button>
                      </li>
                    ))}
                    <li className={`text-xs ${charityBps > 10000 ? "text-failed" : "text-faint"}`}>
                      {charityBps / 100}% to charity · {Math.max(0, (10000 - charityBps) / 100)}% stays with the creator
                    </li>
                  </ul>
                )}
                {charities.length < 5 && (
                  <div className="relative">
                    <input
                      className={INPUT}
                      placeholder="Search a verified charity by name…"
                      value={charityTerm}
                      onChange={(e) => setCharityTerm(e.target.value)}
                    />
                    {charityResults.length > 0 && (
                      <ul className="absolute z-10 mt-1 w-full bg-raised border border-line rounded-md max-h-56 overflow-y-auto">
                        {charityResults.map((c) => (
                          <li key={c.id}>
                            <button
                              onClick={() => addCharity(c)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex items-center gap-2"
                            >
                              {c.logo && <img src={c.logo} alt="" className="w-5 h-5 rounded-sm object-cover" />}
                              <span className="min-w-0 truncate">{c.name}</span>
                              {(c.city || c.state) && (
                                <span className="text-faint text-xs ml-auto shrink-0">
                                  {[c.city, c.state].filter(Boolean).join(", ")}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {charities.length > 0 && pumpSession === false && (
                  <p className="text-mid text-xs">
                    Charity deploys route through donate.gg and need your pump.fun session — paste it in Settings → Wallets.
                  </p>
                )}
              </>
            )}
          </div>

          {vanity && deployer && deployer.vanity.ready === 0 && (
            <p className="text-mid text-xs">
              No …pump mint ready yet{deployer.vanity.grinding ? " — grind running, usually under a minute" : ""}. Deploy will fail until one lands, or untick the vanity box for a random mint.
            </p>
          )}

          {error && <p className="text-failed text-xs">{error}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={() => void review()}
              disabled={busy || formError !== null}
              className="px-4 py-1.5 rounded-md text-sm bg-raised border border-line hover:border-accent disabled:opacity-40 disabled:hover:border-line"
              title={formError ?? undefined}
            >
              Review deploy
            </button>
            <button
              onClick={() => void launch(true)}
              disabled={busy || formError !== null}
              className="px-4 py-1.5 rounded-md text-sm text-dim border border-line hover:text-ink disabled:opacity-40"
              title="Pin + build + simulate only — nothing is sent on-chain"
            >
              Dry run
            </button>
            {formError && <span className="text-faint text-xs">{formError}</span>}
          </div>
        </div>
      )}

      {phase === "review" && estimate && (
        <div className="space-y-4">
          <div className="border border-line rounded-md px-4 py-3 text-sm space-y-1.5">
            <Row label="Create (rent + accounts, est.)" sol={estimate.createCostSol} />
            {isSolQuote ? (
              <Row label="Dev buy" sol={estimate.devBuySol} />
            ) : (
              <div className="flex justify-between text-dim">
                <span>Dev buy (paid in {quoteSymbol})</span>
                <span>
                  {devBuyNum} {quoteSymbol}
                </span>
              </div>
            )}
            {estimate.feeShareCostSol > 0 && <Row label="Charity fee-split setup (est.)" sol={estimate.feeShareCostSol} />}
            <Row label="Priority fee" sol={estimate.priorityFeeSol} />
            <Row label="Tx fee" sol={estimate.txFeeSol} />
            <div className="border-t border-line pt-1.5 flex justify-between font-medium">
              <span>Total SOL (est.)</span>
              <span>{estimate.totalSol.toFixed(4)} SOL</span>
            </div>
            <div className={`flex justify-between text-xs ${estimate.sufficient ? "text-dim" : "text-failed"}`}>
              <span>Wallet balance</span>
              <span>{estimate.balanceSol.toFixed(4)} SOL{estimate.sufficient ? "" : " — insufficient"}</span>
            </div>
          </div>
          <p className="text-faint text-xs">
            {name.trim()} · ${ticker.trim()} · paired with {quoteSymbol} · {vanity ? "…pump mint" : "random mint"}
            {holderReward ? " · holder rewards (permanent)" : ""}
            {charities.length > 0
              ? ` · ${charityBps / 100}% of creator fees → ${charities.map((c) => c.name).join(", ")}`
              : ""}
          </p>
          {error && <p className="text-failed text-xs">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void launch(false)}
              disabled={busy || !estimate.sufficient}
              className="px-4 py-1.5 rounded-md text-sm bg-raised border border-accent/60 text-accent hover:border-accent disabled:opacity-40"
            >
              Confirm — spend ~{estimate.totalSol.toFixed(4)} SOL
            </button>
            <button onClick={reset} className="px-4 py-1.5 rounded-md text-sm text-dim border border-line hover:text-ink">
              Back
            </button>
          </div>
        </div>
      )}

      {(phase === "running" || phase === "finished") && (
        <div className="space-y-4">
          <ul className="border border-line rounded-md px-4 py-3 space-y-1.5 text-xs font-mono max-h-64 overflow-y-auto">
            {events.map((ev, i) => (
              <li key={i} className={EVENT_COLORS[ev.type] ?? "text-dim"}>
                {ev.message}
              </li>
            ))}
            {phase === "running" && <li className="text-faint animate-pulse">…</li>}
          </ul>

          {phase === "finished" && result && (
            <div className="space-y-3">
              {result.status === "confirmed" && result.mint && (
                <div className="border border-success/40 rounded-md px-4 py-3 text-sm space-y-1">
                  <p className="text-success font-medium">Deployed</p>
                  {result.statusReason && <p className="text-mid text-xs">{result.statusReason}</p>}
                  <p className="font-mono text-xs text-dim break-all">{result.mint}</p>
                  <p className="text-xs space-x-3">
                    <a className="text-accent hover:underline" href={`https://pump.fun/coin/${result.mint}`} target="_blank" rel="noreferrer">pump.fun</a>
                    {result.signature && (
                      <a className="text-accent hover:underline" href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">solscan</a>
                    )}
                    {result.feeShareSignature && (
                      <a className="text-accent hover:underline" href={`https://solscan.io/tx/${result.feeShareSignature}`} target="_blank" rel="noreferrer">fee split</a>
                    )}
                  </p>
                </div>
              )}
              {result.status === "dry_run_ok" && (
                <p className="text-success text-sm">Dry run clean — the transaction simulates. Nothing was sent.</p>
              )}
              {result.status === "failed" && (
                <p className="text-failed text-sm">{result.statusReason ?? "deploy failed"}</p>
              )}
              {(result.status === "confirming" || result.status === "sharing") && (
                <p className="text-mid text-sm">Still confirming — check Recent deploys in a moment.</p>
              )}
              <button onClick={reset} className="px-4 py-1.5 rounded-md text-sm text-dim border border-line hover:text-ink">
                New deploy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, sol }: { label: string; sol: number }) {
  return (
    <div className="flex justify-between text-dim">
      <span>{label}</span>
      <span>{sol.toFixed(4)} SOL</span>
    </div>
  );
}
