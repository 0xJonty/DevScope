import { useCallback, useEffect, useState } from "react";
import { api, type GrokStatus } from "../api";

/**
 * Grok connection block — status, device-code connect flow, disconnect.
 * Default: renders nothing once connected (scan-page mode). `showWhenConnected`
 * keeps the status row + disconnect visible (Settings mode). `onStatus` lets
 * the parent react to connection state (gating the scan button).
 */
export default function GrokConnect({
  showWhenConnected = false,
  onStatus,
}: {
  showWhenConnected?: boolean;
  onStatus?: (s: GrokStatus) => void;
}) {
  const [status, setStatus] = useState<GrokStatus | null>(null);
  const [login, setLogin] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    () =>
      api.grokStatus().then((s) => {
        setStatus(s);
        onStatus?.(s);
      }, () => undefined),
    [onStatus]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While a device login is pending, watch for the server-side poll to land.
  useEffect(() => {
    if (!status?.loginPending) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [status?.loginPending, refresh]);

  useEffect(() => {
    if (status?.loggedIn) setLogin(null);
  }, [status?.loggedIn]);

  const connect = async () => {
    setError(null);
    try {
      const l = await api.grokLogin();
      setLogin(l);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const disconnect = async () => {
    setError(null);
    try {
      await api.grokLogout();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!status) return null;

  if (status.loggedIn) {
    if (!showWhenConnected) return null;
    const who = status.account?.name ?? status.account?.email ?? null;
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-worked">
          {status.authMode === "api_key" ? "connected (API key)" : "connected (subscription)"}
        </span>
        {who && (
          <span className="text-dim" title={status.account?.email ?? undefined}>
            {who}
          </span>
        )}
        {status.authMode === "subscription" && (
          <button onClick={disconnect} className="text-dim text-xs hover:text-failed">
            Disconnect
          </button>
        )}
        {error && <span className="text-failed text-xs">{error}</span>}
      </div>
    );
  }

  if (status.authMode === "api_key") {
    return (
      <p className="text-mid text-sm border border-mid/40 rounded-md px-4 py-3 max-w-xl">
        GROK_AUTH_MODE=api_key but XAI_API_KEY is missing — set it in .env or switch back to subscription mode.
      </p>
    );
  }

  return (
    <div className="border border-mid/40 rounded-md px-4 py-3 text-sm space-y-2 max-w-xl">
      <p className="text-mid">Grok is not connected — sign in with the X account that holds your subscription.</p>
      {login ? (
        <div className="space-y-1">
          <p className="text-ink">
            Open{" "}
            <a href={login.verificationUri} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
              {login.verificationUri}
            </a>{" "}
            and enter code <span className="font-mono text-accent">{login.userCode}</span>
          </p>
          <p className="text-faint text-xs">
            {status.loginPending ? "Waiting for approval…" : "Login window expired — connect again."}
          </p>
        </div>
      ) : (
        <button onClick={connect} className="bg-accent text-bg font-medium rounded-md px-4 py-1.5 text-sm">
          Connect Grok
        </button>
      )}
      {status.loginError && <p className="text-failed text-xs">{status.loginError}</p>}
      {error && <p className="text-failed text-xs">{error}</p>}
    </div>
  );
}
