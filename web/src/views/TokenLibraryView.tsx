import { useEffect, useMemo, useState } from "react";
import { api, fmtUsd, shortWallet, type TokenLibraryEntry } from "../api";
import { CLASS_STYLES, Chip } from "../components/ThesisCard";

type SortKey = "scannedAt" | "athUsd" | "createdAt";

export default function TokenLibraryView({ openToken }: { openToken: (mint: string) => void }) {
  const [entries, setEntries] = useState<TokenLibraryEntry[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("scannedAt");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api.tokenLibrary().then(setEntries, () => setEntries([]));
  }, []);

  const visible = useMemo(() => {
    if (!entries) return [];
    const q = search.toLowerCase();
    return entries
      .filter(
        (e) =>
          !q ||
          e.mint.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q) ||
          e.ticker.toLowerCase().includes(q)
      )
      .sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [entries, search, sort]);

  const copy = (mint: string) => {
    void navigator.clipboard.writeText(mint).then(() => {
      setCopied(mint);
      setTimeout(() => setCopied((c) => (c === mint ? null : c)), 1200);
    });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Token Library</h1>
          <p className="text-dim text-sm mt-1">Every individually scanned token. Click a card to read its thesis.</p>
        </div>
        <div className="flex gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mint, name or ticker"
            className="bg-surface border border-line rounded-md px-3 py-1.5 text-sm w-56 placeholder:text-faint focus:outline-none focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-surface border border-line rounded-md px-2 py-1.5 text-sm text-dim focus:outline-none"
          >
            <option value="scannedAt">Newest scan</option>
            <option value="athUsd">ATH</option>
            <option value="createdAt">Launch date</option>
          </select>
        </div>
      </header>

      {entries === null && <p className="text-faint text-sm">Loading…</p>}
      {entries?.length === 0 && (
        <div className="border border-line rounded-md px-6 py-10 text-center text-dim text-sm">
          No tokens yet. Run your first scan from the Token Scan tab.
        </div>
      )}

      <div className="grid grid-cols-2 min-[1500px]:grid-cols-3 gap-4">
        {visible.map((e) => (
          <article
            key={e.mint}
            onClick={() => openToken(e.mint)}
            className="border border-line rounded-lg px-5 py-4 cursor-pointer hover:border-accent/60 bg-surface"
          >
            <div className="flex items-center gap-3">
              {e.imageUrl ? (
                <img src={e.imageUrl} alt="" className="w-12 h-12 rounded-md object-cover border border-line shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-md bg-raised border border-line shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <h2 className="font-medium truncate">{e.name}</h2>
                  <span className="text-dim text-sm shrink-0">${e.ticker}</span>
                  <span className="text-faint text-xs ml-auto shrink-0">{new Date(e.scannedAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2 mt-1 min-w-0">
                  <span className="font-mono text-xs text-faint truncate">{e.mint}</span>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      copy(e.mint);
                    }}
                    className="text-faint hover:text-accent text-xs shrink-0"
                    title="Copy contract address"
                  >
                    {copied === e.mint ? "copied" : "copy"}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3">
              <Chip text={e.classification} className={CLASS_STYLES[e.classification] ?? "text-dim border-line"} />
              {e.bonded && <Chip text="bonded" className="text-worked border-worked/40" />}
              <span className="text-xs text-ink ml-auto">{fmtUsd(e.athUsd)} ATH</span>
              <span className="text-faint text-xs">· dev {shortWallet(e.wallet)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
