import { useEffect, useState } from "react";
import { api, type WalletInfo } from "../api";

const INPUT = "bg-surface border border-line rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent";

function short(addr: string): string {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/** Settings → Wallets: import deploy wallets, pick the main one. */
export default function WalletsPanel() {
  const [wallets, setWallets] = useState<WalletInfo[] | null>(null);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionSet, setSessionSet] = useState<boolean | null>(null);
  const [cookie, setCookie] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const refresh = () =>
    api.getDeployer().then(
      (d) => setWallets(d.wallets),
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  useEffect(() => {
    void refresh();
    api.pumpSession().then((s) => setSessionSet(s.set), () => setSessionSet(null));
  }, []);

  const saveSession = async () => {
    setSessionError(null);
    try {
      await api.setPumpSession(cookie);
      setCookie("");
      setSessionSet(true);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  };

  const clearSession = async () => {
    setSessionError(null);
    try {
      await api.clearPumpSession();
      setSessionSet(false);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.importWallet(name, secret);
      setName("");
      setSecret("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setMain = async (pubkey: string) => {
    setError(null);
    try {
      await api.setMainWallet(pubkey);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (w: WalletInfo) => {
    if (!window.confirm(`Remove ${w.name} (${short(w.pubkey)})? Its key is deleted from this machine — keep a backup if it holds funds.`)) return;
    setError(null);
    try {
      await api.removeWallet(w.pubkey);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Deploy wallets</h2>
        <p className="text-dim text-sm">
          The <span className="text-ink">main</span> wallet signs deploys by default; any deploy can switch wallet in
          the Deploy form. Keys are stored locally in <span className="font-mono text-xs">data/wallets.json</span> (0600,
          gitignored) and never leave this machine — fund them only with what you intend to spend.
        </p>

        {wallets === null && <p className="text-faint text-sm">Loading…</p>}
        {wallets?.length === 0 && (
          <p className="text-faint text-sm border border-line rounded-md px-4 py-3">No wallets yet — import one below.</p>
        )}
        {wallets && wallets.length > 0 && (
          <ul className="space-y-2">
            {wallets.map((w) => (
              <li key={w.pubkey} className="border border-line rounded-md px-4 py-2.5 text-sm flex items-center gap-3">
                <input
                  type="radio"
                  name="main-wallet"
                  className="accent-[#e0524f] cursor-pointer"
                  checked={w.isMain}
                  onChange={() => void setMain(w.pubkey)}
                  title="Set as main wallet"
                />
                <span className="font-medium min-w-0 truncate">{w.name}</span>
                {w.isMain && <span className="text-[11px] border border-accent/40 text-accent rounded-full px-2 py-0.5">main</span>}
                <button
                  className="font-mono text-xs text-dim hover:text-accent"
                  title={`${w.pubkey} — click to copy`}
                  onClick={() => void navigator.clipboard.writeText(w.pubkey)}
                >
                  {short(w.pubkey)}
                </button>
                <span className={`ml-auto ${w.balanceSol > 0 ? "text-worked" : "text-faint"}`}>
                  {w.balanceSol.toFixed(4)} SOL
                </span>
                <button onClick={() => void remove(w)} className="text-faint hover:text-failed text-xs" title="Remove wallet">
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Import wallet</h2>
        <div className="flex items-center gap-3">
          <input className={`${INPUT} w-40`} placeholder="name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={`${INPUT} flex-1`}
            type="password"
            placeholder="private key — base58 (Phantom export) or 64-byte JSON array"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
          />
          <button
            onClick={() => void doImport()}
            disabled={busy || secret.trim().length < 32}
            className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent disabled:opacity-40"
          >
            Import
          </button>
        </div>
        {error && <p className="text-failed text-xs">{error}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">pump.fun session (charity deploys)</h2>
        <p className="text-dim text-sm">
          Charity fee splits route through donate.gg and need your pump.fun login: open pump.fun in Chrome
          (logged in) → DevTools → Network → any <span className="font-mono text-xs">fun-block.pump.fun</span> request
          → copy the full <span className="font-mono text-xs">Cookie</span> request header and paste it here. Stored
          locally at <span className="font-mono text-xs">data/pump-auth.json</span>; only ever sent to pump.fun.
        </p>
        <div className="flex items-center gap-3">
          {sessionSet ? (
            <>
              <span className="text-worked text-sm">session set</span>
              <button onClick={() => void clearSession()} className="text-faint hover:text-failed text-xs">
                clear
              </button>
            </>
          ) : (
            <>
              <input
                className={`${INPUT} flex-1`}
                type="password"
                placeholder="paste pump.fun Cookie header value"
                value={cookie}
                onChange={(e) => setCookie(e.target.value)}
                autoComplete="off"
              />
              <button
                onClick={() => void saveSession()}
                disabled={cookie.trim().length < 16}
                className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent disabled:opacity-40"
              >
                Save
              </button>
            </>
          )}
        </div>
        {sessionError && <p className="text-failed text-xs">{sessionError}</p>}
      </section>
    </div>
  );
}
