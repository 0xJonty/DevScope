import { useEffect, useState } from "react";
import { api, type Settings } from "../api";
import QuotaMeters from "../components/QuotaMeters";

export default function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [midMin, setMidMin] = useState<string>("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setMidMin(String(s.bands.mid_min_ath_usd));
    }, () => undefined);
  }, []);

  if (!settings) return <p className="text-faint text-sm">Loading…</p>;

  const saveBands = async () => {
    const value = Number(midMin);
    if (!Number.isFinite(value) || value <= 0) return;
    const res = await api.setBands(value);
    setSaved(`Saved — bands now v${res.bands_version}`);
    const s = await api.settings();
    setSettings(s);
  };

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
          worked = bonded · mid = not bonded, ATH above threshold · failed = the rest. Version {settings.bands.bands_version}; every profile records the version it was scanned with.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm" htmlFor="midmin">MID threshold (ATH USD)</label>
          <input
            id="midmin"
            value={midMin}
            onChange={(e) => setMidMin(e.target.value)}
            className="bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-32 focus:outline-none focus:border-accent"
          />
          <button onClick={saveBands} className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent">
            Save bands
          </button>
          {saved && <span className="text-worked text-xs">{saved}</span>}
        </div>
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
