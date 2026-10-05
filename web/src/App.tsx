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
        <div>
          <div className="font-semibold tracking-tight">DevScope</div>
          <div className="text-faint text-xs mt-0.5">pump.fun scanner</div>
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
