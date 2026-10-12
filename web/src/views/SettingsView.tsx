import { useEffect, useState } from "react";
import { api, numberError, type Settings } from "../api";
import QuotaMeters from "../components/QuotaMeters";
import GrokConnect from "../components/GrokConnect";
import WalletsPanel from "../components/WalletsPanel";

export default function SettingsView() {
  const [tab, setTab] = useState<"general" | "wallets">("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [successMode, setSuccessMode] = useState<"bonded" | "ath_usd">("bonded");
  const [successMin, setSuccessMin] = useState<string>("");
  const [midMin, setMidMin] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);
  const [bandsError, setBandsError] = useState<string | null>(null);
  const [mayhemError, setMayhemError] = useState<string | null>(null);

  const applySettings = (s: Settings) => {
    setSettings(s);
    setSuccessMode(s.bands.success_mode);
    setSuccessMin(String(s.bands.success_min_ath_usd));
    setMidMin(String(s.bands.mid_min_ath_usd));
  };

  useEffect(() => {
    api.settings().then(applySettings, () => undefined);
  }, []);

  if (!settings) return <p className="text-faint text-sm">Loading…</p>;

  const validateBands = (): string | null => {
    const midErr = numberError(midMin, "MID threshold", { min: 1 });
    if (midErr) return midErr;
    if (successMode === "ath_usd") {
      const successErr = numberError(successMin, "SUCCESS threshold", { min: 1 });
      if (successErr) return successErr;
      if (Number(successMin) <= Number(midMin)) {
        return "SUCCESS threshold must be higher than the MID threshold.";
      }
    }
    return null;
  };

  const saveBands = async () => {
    setSaved(null);
    const err = validateBands();
    setBandsError(err);
    if (err) return;
    try {
      const res = await api.setBands({
        success_mode: successMode,
        success_min_ath_usd: Number(successMin) || settings.bandDefaults.success_min_ath_usd,
        mid_min_ath_usd: Number(midMin),
      });
      setSaved(`Saved — bands now v${res.bands_version}`);
      applySettings(await api.settings());
    } catch (e) {
      setBandsError(e instanceof Error ? e.message : String(e));
    }
  };

  const resetBands = async () => {
    setSaved(null);
    setBandsError(null);
    try {
      const res = await api.resetBands();
      setSaved(`Reset to defaults — bands now v${res.bands_version}`);
      applySettings(await api.settings());
    } catch (e) {
      setBandsError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleMayhem = async (include: boolean) => {
    setMayhemError(null);
    // Optimistic flip; revert on failure.
    setSettings({ ...settings, filters: { include_mayhem: include } });
    try {
      await api.setFilters(include);
    } catch (e) {
      setSettings({ ...settings, filters: { include_mayhem: !include } });
      setMayhemError(e instanceof Error ? e.message : String(e));
    }
  };

  const isDefault =
    successMode === settings.bandDefaults.success_mode &&
    Number(midMin) === settings.bandDefaults.mid_min_ath_usd &&
    (successMode === "bonded" || Number(successMin) === settings.bandDefaults.success_min_ath_usd);

  const inputCls =
    "bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent";

  return (
    <div className="space-y-10 max-w-2xl">
      <header className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <div className="flex gap-1 border-b border-line">
          {(["general", "wallets"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm capitalize -mb-px border-b-2 ${
                tab === t ? "border-accent text-ink" : "border-transparent text-dim hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      {tab === "wallets" && <WalletsPanel />}

      {tab === "general" && (
        <>
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Provider quota (this month)</h2>
        <QuotaMeters quota={settings.quota} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Classification bands</h2>
        <p className="text-dim text-sm">
          {successMode === "bonded"
            ? "failed = the rest · mid = not bonded, ATH above MID threshold · success = bonded."
            : "failed = the rest · mid = ATH above MID threshold · success = ATH above SUCCESS threshold."}{" "}
          Version {settings.bands.bands_version}; every profile records the version it was scanned with.
        </p>

        <div className="flex items-center gap-3">
          <label className="text-sm w-44" htmlFor="successmode">SUCCESS means</label>
          <select
            id="successmode"
            value={successMode}
            onChange={(e) => setSuccessMode(e.target.value as "bonded" | "ath_usd")}
            className="bg-surface border border-line rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            <option value="bonded">bonded (graduated)</option>
            <option value="ath_usd">custom market cap</option>
          </select>
        </div>

        {successMode === "ath_usd" && (
          <div className="flex items-center gap-3">
            <label className="text-sm w-44" htmlFor="successmin">SUCCESS threshold (ATH USD)</label>
            <input id="successmin" value={successMin} onChange={(e) => setSuccessMin(e.target.value)} className={inputCls} />
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="text-sm w-44" htmlFor="midmin">MID threshold (ATH USD)</label>
          <input id="midmin" value={midMin} onChange={(e) => setMidMin(e.target.value)} className={inputCls} />
        </div>

        <div className="flex items-center gap-3">
          <button onClick={saveBands} className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent">
            Save bands
          </button>
          <button
            onClick={resetBands}
            disabled={isDefault}
            className="text-dim text-sm hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
            title={isDefault ? "Already at defaults" : "Restore default bands"}
          >
            Reset to defaults
          </button>
          {saved && !bandsError && <span className="text-success text-xs">{saved}</span>}
        </div>
        {bandsError && <p className="text-failed text-xs">{bandsError}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Filters</h2>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={settings.filters.include_mayhem}
            onChange={(e) => toggleMayhem(e.target.checked)}
            className="accent-[#e0524f]"
          />
          Include mayhem-mode coins
        </label>
        <p className="text-dim text-sm">
          Off (default): pump.fun mayhem launches are excluded from every scan and purged from cached results. On:
          they are treated as ordinary deploys — expect noisier stats, since an AI agent trades them randomly.
        </p>
        {mayhemError && <p className="text-failed text-xs">{mayhemError}</p>}
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-sm font-medium text-dim">Reasoning</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
          <dt className="text-faint">Auth mode</dt>
          <dd className={settings.authMode === "subscription" ? "text-success" : "text-mid"}>{settings.authMode}</dd>
          <dt className="text-faint">Thesis prompt</dt>
          <dd className="font-mono text-xs self-center">{settings.promptVersions.thesis}</dd>
          <dt className="text-faint">Synthesis prompt</dt>
          <dd className="font-mono text-xs self-center">{settings.promptVersions.synthesis}</dd>
          <dt className="text-faint">Default window</dt>
          <dd>{settings.scanDefaults.window_n} deploys (max {settings.scanDefaults.window_max})</dd>
          <dt className="text-faint">Dossier cap</dt>
          <dd>{settings.scanDefaults.dossier.cap} tokens</dd>
        </dl>
      </section>

      <section className="space-y-3 text-sm">
        <h2 className="text-sm font-medium text-dim">Grok (Narrative X Scan)</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
          <dt className="text-faint">Auth mode</dt>
          <dd className={settings.grok.authMode === "subscription" ? "text-success" : "text-mid"}>
            {settings.grok.authMode}
          </dd>
          <dt className="text-faint">Model</dt>
          <dd className="font-mono text-xs self-center">{settings.grok.model}</dd>
          <dt className="text-faint">Narrative prompt</dt>
          <dd className="font-mono text-xs self-center">{settings.promptVersions.narrative}</dd>
          <dt className="text-faint">Connection</dt>
          <dd>
            <GrokConnect showWhenConnected />
          </dd>
        </dl>
      </section>
        </>
      )}
    </div>
  );
}
