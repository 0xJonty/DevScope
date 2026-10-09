import { useEffect, useMemo, useState } from "react";
import { api, fmtUsd, shortWallet, type LibraryEntry } from "../api";

type SortKey = "updatedAt" | "bondRate" | "bestAthUsd";

export default function LibraryView({ openProfile }: { openProfile: (wallet: string) => void }) {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("updatedAt");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = () => api.library().then(setEntries, () => setEntries([]));
  useEffect(() => {
    load();
  }, []);

  const visible = useMemo(() => {
    if (!entries) return [];
    const q = search.toLowerCase();
    return entries
      .filter((e) => !q || e.wallet.toLowerCase().includes(q) || e.name?.toLowerCase().includes(q))
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [entries, search, sort]);

  const commitRename = async (wallet: string) => {
    const name = newName.trim();
    if (name.length > 60) {
      setRenameError("Name must be 60 characters or fewer.");
      return; // keep the input open so it can be fixed
    }
    try {
      if (name) await api.rename(wallet, name);
      setRenameError(null);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    }
    setRenaming(null);
    setNewName("");
    load();
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dev Library</h1>
          <p className="text-dim text-sm mt-1">Every profiled deployer. Click a card to read the profile.</p>
        </div>
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wallet or name"
            className="bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-56 placeholder:text-faint focus:outline-none focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-surface border border-line rounded-md px-2 py-1.5 text-sm text-dim focus:outline-none"
          >
            <option value="updatedAt">Newest scan</option>
            <option value="bondRate">Bond rate</option>
            <option value="bestAthUsd">Best ATH</option>
          </select>
        </div>
      </header>

      {renameError && <p className="text-failed text-xs">Rename failed: {renameError}</p>}

      {entries === null && <p className="text-faint text-sm">Loading…</p>}
      {entries?.length === 0 && (
        <div className="border border-line rounded-md px-6 py-10 text-center text-dim text-sm">
          No profiles yet. Run your first scan from the Dev Scan tab.
        </div>
      )}

      <div className="grid grid-cols-2 2xl:grid-cols-3 gap-4">
        {visible.map((e) => (
          <article
            key={e.wallet}
            onClick={() => openProfile(e.wallet)}
            className="border border-line rounded-lg px-5 py-4 cursor-pointer hover:border-accent/60 bg-surface"
          >
            <div className="flex items-baseline justify-between gap-3">
              {renaming === e.wallet ? (
                <input
                  autoFocus
                  value={newName}
                  onChange={(ev) => setNewName(ev.target.value)}
                  onClick={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => ev.key === "Enter" && commitRename(e.wallet)}
                  onBlur={() => commitRename(e.wallet)}
                  className="bg-raised border border-accent rounded px-2 py-0.5 text-sm w-40 focus:outline-none"
                />
              ) : (
                <h2 className="font-medium truncate">
                  {e.name ?? shortWallet(e.wallet)}
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setRenaming(e.wallet);
                      setNewName(e.name ?? "");
                    }}
                    className="text-faint hover:text-accent text-xs ml-2"
                    title="Rename"
                  >
                    rename
                  </button>
                </h2>
              )}
              <span className="text-faint text-xs shrink-0">{new Date(e.updatedAt).toLocaleDateString()}</span>
            </div>
            <p className="text-dim text-sm mt-2 line-clamp-3 min-h-10">{e.verdictSnippet ?? "—"}</p>
            <dl className="flex gap-6 mt-3 text-xs">
              <div>
                <dt className="text-faint">bond rate</dt>
                <dd className="text-ink mt-0.5">{e.bondRate == null ? "—" : `${(e.bondRate * 100).toFixed(1)}%`}</dd>
              </div>
              <div>
                <dt className="text-faint">best ATH</dt>
                <dd className="text-ink mt-0.5">{fmtUsd(e.bestAthUsd)}</dd>
              </div>
              <div>
                <dt className="text-faint">tokens cached</dt>
                <dd className="text-ink mt-0.5">{e.tokenCount}</dd>
              </div>
              <div>
                <dt className="text-faint">lifetime deploys</dt>
                <dd className="text-ink mt-0.5">{e.lifetimeDeploys ?? "—"}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </div>
  );
}
