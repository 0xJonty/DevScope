import { useState } from "react";
import ScanView from "./views/ScanView";
import LibraryView from "./views/LibraryView";
import ProfileView from "./views/ProfileView";
import SettingsView from "./views/SettingsView";

export type View =
  | { name: "scan"; scanId?: string }
  | { name: "library" }
  | { name: "profile"; wallet: string }
  | { name: "settings" };

const NAV: Array<{ key: View["name"]; label: string }> = [
  { key: "scan", label: "Scan" },
  { key: "library", label: "Library" },
  { key: "settings", label: "Settings" },
];

export default function App() {
  const [view, setView] = useState<View>({ name: "scan" });

  return (
    <div className="min-h-screen flex">
      <aside className="w-44 shrink-0 border-r border-line px-5 py-7 flex flex-col gap-8">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] shrink-0" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <line x1="12" y1="1.5" x2="12" y2="5.5" />
            <line x1="12" y1="18.5" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="5.5" y2="12" />
            <line x1="18.5" y1="12" x2="22.5" y2="12" />
            <circle cx="12" cy="12" r="1.1" fill="var(--color-accent)" stroke="none" />
          </svg>
          <div className="font-semibold tracking-tight">DevScope</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = view.name === item.key || (item.key === "library" && view.name === "profile");
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
        {view.name === "library" && <LibraryView openProfile={(wallet) => setView({ name: "profile", wallet })} />}
        {view.name === "profile" && (
          <ProfileView wallet={view.wallet} back={() => setView({ name: "library" })} rescan={() => setView({ name: "scan" })} />
        )}
        {view.name === "settings" && <SettingsView />}
      </main>
    </div>
  );
}
