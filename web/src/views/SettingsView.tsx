import { useEffect, useState } from "react";
import { api, numberError, type Settings } from "../api";
import QuotaMeters from "../components/QuotaMeters";

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workedMode, setWorkedMode] = useState<"bonded" | "ath_usd">("bonded");
  const [workedMin, setWorkedMin] = useState<string>("");
  const [midMin, setMidMin] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);
  const [bandsError, setBandsError] = useState<string | null>(null);
  const [mayhemError, setMayhemError] = useState<string | null>(null);

  const applySettings = (s: Settings) => {
    setSettings(s);
    setWorkedMode(s.bands.worked_mode);
    setWorkedMin(String(s.bands.worked_min_ath_usd));
    setMidMin(String(s.bands.mid_min_ath_usd));
  };

  useEffect(() => {
    api.settings().then(applySettings, () => undefined);
  }, []);

  if (!settings) return <p className="text-faint text-sm">Loading…</p>;

  const validateBands = (): string | null => {
    const midErr = numberError(midMin, "MID threshold", { min: 1 });
    if (midErr) return midErr;
    if (workedMode === "ath_usd") {
      const workedErr = numberError(workedMin, "WORKED threshold", { min: 1 });
      if (workedErr) return workedErr;
      if (Number(workedMin) <= Number(midMin)) {
        return "WORKED threshold must be higher than the MID threshold.";
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
        worked_mode: workedMode,
        worked_min_ath_usd: Number(workedMin) || settings.bandDefaults.worked_min_ath_usd,
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
    workedMode === settings.bandDefaults.worked_mode &&
    Number(midMin) === settings.bandDefaults.mid_min_ath_usd &&
    (workedMode === "bonded" || Number(workedMin) === settings.bandDefaults.worked_min_ath_usd);

  const inputCls =
    "bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent";

  return (
    <div className="space-y-10 max-w-2xl">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Provider quota (this month)</h2>
        <QuotaMeters quota={settings.quota} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-dim">Classification bands</h2>
        <p className="text-dim text-sm">
          {workedMode === "bonded"
            ? "worked = bonded · mid = not bonded, ATH above MID threshold · failed = the rest."
            : "worked = ATH above WORKED threshold · mid = ATH above MID threshold · failed = the rest."}{" "}
          Version {settings.bands.bands_version}; every profile records the version it was scanned with.
        </p>

        <div className="flex items-center gap-3">
          <label className="text-sm w-44" htmlFor="workedmode">WORKED means</label>
          <select
            id="workedmode"
            value={workedMode}
            onChange={(e) => setWorkedMode(e.target.value as "bonded" | "ath_usd")}
            className="bg-surface border border-line rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-accent"
          >
            <option value="bonded">bonded (graduated)</option>
            <option value="ath_usd">custom market cap</option>
          </select>
        </div>

        {workedMode === "ath_usd" && (
          <div className="flex items-center gap-3">
            <label className="text-sm w-44" htmlFor="workedmin">WORKED threshold (ATH USD)</label>
            <input id="workedmin" value={workedMin} onChange={(e) => setWorkedMin(e.target.value)} className={inputCls} />
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
          {saved && !bandsError && <span className="text-worked text-xs">{saved}</span>}
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
          <dd className={settings.authMode === "subscription" ? "text-worked" : "text-mid"}>{settings.authMode}</dd>
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
    </div>
  );
}
