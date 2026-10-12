import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  subscribeScanEvents,
  type DeployEstimate,
  type DeployerStatus,
  type Deployment,
  type ScanEvent,
} from "../api";

export interface DeployPrefill {
  name?: string;
  ticker?: string;
  description?: string;
  /** Existing narrative image (server path) used when no file is uploaded. */
  imagePath?: string | null;
  holderReward?: boolean;
  narrativeTokenId?: string;
}

const INPUT = "bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-full focus:border-accent focus:outline-none";
const LABEL = "text-dim text-xs";

const EVENT_COLORS: Record<string, string> = {
  error: "text-failed",
  done: "text-worked",
  stage: "text-ink",
  log: "text-faint",
};

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
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
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");
  const [devBuySol, setDevBuySol] = useState("0");
  const [slippagePct, setSlippagePct] = useState("10");
  const [priorityFeeSol, setPriorityFeeSol] = useState("0.0005");
  const [holderReward, setHolderReward] = useState(prefill?.holderReward ?? false);
  const [vanity, setVanity] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);

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

  useEffect(() => () => unsubscribe.current?.(), []);

  const numbers = {
    devBuySol: Number(devBuySol),
    slippagePct: Number(slippagePct),
    priorityFeeSol: Number(priorityFeeSol),
  };
  const selectedWallet = deployer?.wallets.find((w) => w.pubkey === walletPubkey) ?? null;
  const formError = !walletPubkey
    ? "no deploy wallet — import one in Settings → Wallets"
    : !name.trim()
      ? "name required"
      : !ticker.trim()
        ? "ticker required"
        : !hasImage
          ? "image required"
          : Object.entries(numbers).find(([, v]) => !Number.isFinite(v) || v < 0)
            ? "dev buy / slippage / priority fee must be non-negative numbers"
            : null;

  const review = async () => {
    setBusy(true);
    setError(null);
    try {
      setEstimate(await api.deployEstimate(numbers.devBuySol, numbers.priorityFeeSol, walletPubkey));
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
          ...numbers,
          holderReward,
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
                  <span className={selectedWallet.balanceSol > 0 ? "text-worked" : "text-failed"}>
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
            <label className={LABEL}>Description</label>
            <textarea className={`${INPUT} h-20 resize-y`} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
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
              <label className={LABEL}>Dev buy (SOL)</label>
              <input className={INPUT} value={devBuySol} onChange={(e) => setDevBuySol(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Slippage %</label>
              <input className={INPUT} value={slippagePct} onChange={(e) => setSlippagePct(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className={LABEL}>Priority fee (SOL)</label>
              <input className={INPUT} value={priorityFeeSol} onChange={(e) => setPriorityFeeSol(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="accent-[#e0524f]" checked={vanity} onChange={(e) => setVanity(e.target.checked)} />
              <span className="text-dim">…pump mint address</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer" title="Creator fees accrue to holders instead of the creator. PERMANENT per coin.">
              <input type="checkbox" className="accent-[#e0524f]" checked={holderReward} onChange={(e) => setHolderReward(e.target.checked)} />
              <span className="text-dim">holder rewards</span>
            </label>
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
            <Row label="Dev buy" sol={estimate.devBuySol} />
            <Row label="Priority fee" sol={estimate.priorityFeeSol} />
            <Row label="Tx fee" sol={estimate.txFeeSol} />
            <div className="border-t border-line pt-1.5 flex justify-between font-medium">
              <span>Total (est.)</span>
              <span>{estimate.totalSol.toFixed(4)} SOL</span>
            </div>
            <div className={`flex justify-between text-xs ${estimate.sufficient ? "text-dim" : "text-failed"}`}>
              <span>Deployer balance</span>
              <span>{estimate.balanceSol.toFixed(4)} SOL{estimate.sufficient ? "" : " — insufficient"}</span>
            </div>
          </div>
          <p className="text-faint text-xs">
            {name.trim()} · ${ticker.trim()} · {vanity ? "…pump mint" : "random mint"}
            {holderReward ? " · holder rewards (permanent)" : ""}
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
                <div className="border border-worked/40 rounded-md px-4 py-3 text-sm space-y-1">
                  <p className="text-worked font-medium">Deployed</p>
                  <p className="font-mono text-xs text-dim break-all">{result.mint}</p>
                  <p className="text-xs space-x-3">
                    <a className="text-accent hover:underline" href={`https://pump.fun/coin/${result.mint}`} target="_blank" rel="noreferrer">pump.fun</a>
                    {result.signature && (
                      <a className="text-accent hover:underline" href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">solscan</a>
                    )}
                  </p>
                </div>
              )}
              {result.status === "dry_run_ok" && (
                <p className="text-worked text-sm">Dry run clean — the transaction simulates. Nothing was sent.</p>
              )}
              {result.status === "failed" && (
                <p className="text-failed text-sm">{result.statusReason ?? "deploy failed"}</p>
              )}
              {result.status === "confirming" && (
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
