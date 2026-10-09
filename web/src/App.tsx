import { useState } from "react";
import ScanView from "./views/ScanView";
import TokenScanView from "./views/TokenScanView";
import LibraryView from "./views/LibraryView";
import TokenLibraryView from "./views/TokenLibraryView";
import ProfileView from "./views/ProfileView";
import TokenView from "./views/TokenView";
import DevTokenView from "./views/DevTokenView";
import SettingsView from "./views/SettingsView";

export type View =
  | { name: "scan"; scanId?: string }
  | { name: "tokenScan" }
  | { name: "library" }
  | { name: "tokenLibrary" }
  | { name: "profile"; wallet: string }
  | { name: "token"; mint: string }
  | { name: "devToken"; mint: string; wallet: string; autostartVamp: boolean }
  | { name: "settings" };

const NAV: Array<{ key: View["name"]; label: string }> = [
  { key: "scan", label: "Dev Scan" },
  { key: "tokenScan", label: "Token Scan" },
  { key: "library", label: "Dev Library" },
  { key: "tokenLibrary", label: "Token Library" },
  { key: "settings", label: "Settings" },
];

export default function App() {
  const [view, setView] = useState<View>({ name: "scan" });

  return (
    <div className="min-h-screen flex">
      <aside className="w-44 shrink-0 border-r border-line px-5 py-7 flex flex-col gap-8">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" fill="none" stroke="#e0524f" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <line x1="12" y1="1.5" x2="12" y2="5.5" />
            <line x1="12" y1="18.5" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="5.5" y2="12" />
            <line x1="18.5" y1="12" x2="22.5" y2="12" />
            <circle cx="12" cy="12" r="1.1" fill="#e0524f" stroke="none" />
          </svg>
          <div className="font-semibold tracking-tight">DevScope</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active =
              view.name === item.key ||
              (item.key === "library" && (view.name === "profile" || view.name === "devToken")) ||
              (item.key === "tokenLibrary" && view.name === "token");
            return (
              <button
                key={item.key}
                onClick={() => setView({ name: item.key } as View)}
                className={`text-left px-3 py-1.5 rounded-md text-sm ${
                  active ? "bg-raised text-ink" : "text-dim hover:text-ink"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 min-w-0 px-10 py-8 max-w-[1800px] mx-auto">
        {view.name === "scan" && <ScanView />}
        {view.name === "tokenScan" && <TokenScanView openToken={(mint) => setView({ name: "token", mint })} />}
        {view.name === "library" && <LibraryView openProfile={(wallet) => setView({ name: "profile", wallet })} />}
        {view.name === "tokenLibrary" && <TokenLibraryView openToken={(mint) => setView({ name: "token", mint })} />}
        {view.name === "profile" && (
          <ProfileView
            wallet={view.wallet}
            back={() => setView({ name: "library" })}
            rescan={() => setView({ name: "scan" })}
            openVamp={(mint) => setView({ name: "devToken", mint, wallet: view.wallet, autostartVamp: true })}
          />
        )}
        {view.name === "token" && (
          <TokenView mint={view.mint} back={() => setView({ name: "tokenLibrary" })} rescan={() => setView({ name: "tokenScan" })} />
        )}
        {view.name === "devToken" && (
          <DevTokenView
            mint={view.mint}
            autostartVamp={view.autostartVamp}
            back={() => setView({ name: "profile", wallet: view.wallet })}
          />
        )}
        {view.name === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
