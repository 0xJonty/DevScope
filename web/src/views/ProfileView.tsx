import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, shortWallet } from "../api";

interface ProfileData {
  wallet: string;
  name: string | null;
  markdown: string;
  updatedAt: number;
}

/** Split frontmatter off; pin the Verdict section above the rest (PLAN.md §10). */
function splitProfile(md: string): { frontmatter: string; verdict: string; rest: string } {
  let body = md;
  let frontmatter = "";
  const fm = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    frontmatter = fm[1];
    body = md.slice(fm[0].length);
  }
  const verdictMatch = body.match(/# Verdict\n([\s\S]*?)(?=\n# )/);
  const verdict = verdictMatch ? verdictMatch[1].trim() : "";
  const rest = verdictMatch ? body.replace(verdictMatch[0], "") : body;
  return { frontmatter, verdict, rest };
}

export default function ProfileView({ wallet, back, rescan }: { wallet: string; back: () => void; rescan: () => void }) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.profile(wallet).then(setProfile, (e) => setError(String(e)));
  }, [wallet]);

  if (error) return <p className="text-failed text-sm">{error}</p>;
  if (!profile) return <p className="text-faint text-sm">Loading…</p>;

  const { verdict, rest } = splitProfile(profile.markdown);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={back} className="text-dim hover:text-ink text-sm">← Library</button>
          <h1 className="text-lg font-semibold tracking-tight">{profile.name ?? shortWallet(wallet)}</h1>
          <a
            href={`https://pump.fun/profile/${wallet}`}
            target="_blank"
            rel="noreferrer"
            className="text-faint hover:text-accent text-xs"
          >
            pump.fun ↗
          </a>
          <a
            href={`https://solscan.io/account/${wallet}`}
            target="_blank"
            rel="noreferrer"
            className="text-faint hover:text-accent text-xs"
          >
            solscan ↗
          </a>
        </div>
        <button onClick={rescan} className="border border-line rounded-md px-4 py-1.5 text-sm hover:border-accent">
          Update scan
        </button>
      </header>

      <div className="font-mono text-xs text-faint">{wallet}</div>

      {verdict && (
        <section className="border-l-2 border-accent bg-surface rounded-r-md px-5 py-4 profile-md max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{verdict}</ReactMarkdown>
        </section>
      )}

      <article className="profile-md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{rest}</ReactMarkdown>
      </article>
    </div>
  );
}
