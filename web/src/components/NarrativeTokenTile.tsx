import { type NarrativeTokenCard } from "../api";
import { Chip } from "./ThesisCard";

/** Momentum is the one loud signal — glyph + color, everything else quiet. */
export const MOMENTUM_STYLES: Record<string, { glyph: string; cls: string }> = {
  exploding: { glyph: "▲", cls: "text-accent border-accent/40" },
  rising: { glyph: "↗", cls: "text-worked border-worked/40" },
  peaking: { glyph: "→", cls: "text-mid border-mid/40" },
  fading: { glyph: "↘", cls: "text-faint border-line" },
};

export const CONFIDENCE_STYLES: Record<string, string> = {
  high: "text-worked border-worked/40",
  medium: "text-mid border-mid/40",
  low: "text-faint border-line",
};

export const FEE_LABELS: Record<string, string> = {
  creator_fees: "creator fees",
  holder_rewards: "holder rewards",
  fee_share: "fee share",
  charity: "charity",
};

/** Image-gen placeholder: ticker monogram until generation lands on imagePath. */
export function TokenImage({
  ticker,
  imagePath,
  size = "w-12 h-12",
}: {
  ticker: string | null;
  imagePath: string | null;
  size?: string;
}) {
  if (imagePath) {
    return <img src={`/images/${imagePath.split("/").pop()}`} alt="" className={`${size} rounded-md object-cover border border-line shrink-0`} />;
  }
  return (
    <div
      className={`${size} rounded-md bg-raised border border-dashed border-line shrink-0 flex items-center justify-center`}
      title="Token image — generation pending"
    >
      <span className="text-faint font-semibold text-xs tracking-tight select-none">
        {(ticker ?? "?").slice(0, 4)}
      </span>
    </div>
  );
}

export default function NarrativeTokenTile({
  t,
  onOpen,
  onDeploy,
}: {
  t: NarrativeTokenCard;
  onOpen: (id: string) => void;
  onDeploy?: (id: string) => void;
}) {
  const momentum = (t.momentum && MOMENTUM_STYLES[t.momentum]) || null;
  return (
    <article
      onClick={() => onOpen(t.id)}
      className="border border-line rounded-lg px-5 py-4 cursor-pointer hover:border-accent/60 bg-surface"
    >
      <div className="flex items-center gap-3">
        <TokenImage ticker={t.ticker} imagePath={t.imagePath} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="font-medium truncate">{t.tokenName ?? t.title}</h2>
            {t.ticker && <span className="text-dim text-sm shrink-0">${t.ticker}</span>}
            {momentum && (
              <span className={`ml-auto shrink-0 font-semibold ${momentum.cls.split(" ")[0]}`}>{momentum.glyph}</span>
            )}
          </div>
          {t.title && <p className="text-faint text-xs mt-0.5 truncate">{t.title}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
        {t.category && <Chip text={t.category.replace(/_/g, " ")} />}
        {t.feeType && <Chip text={FEE_LABELS[t.feeType] ?? t.feeType} className="text-accent border-accent/40" />}
        {t.confidence && (
          <Chip text={t.confidence} className={CONFIDENCE_STYLES[t.confidence] ?? "text-dim border-line"} />
        )}
        {t.deployed ? (
          <a
            href={`https://pump.fun/coin/${t.deployed.mint}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="ml-auto text-[11px] border border-worked/40 text-worked rounded-full px-2 py-0.5 hover:border-worked"
          >
            deployed ↗
          </a>
        ) : (
          onDeploy && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeploy(t.id);
              }}
              className="ml-auto text-[11px] border border-line text-dim rounded-full px-2 py-0.5 hover:text-accent hover:border-accent/60"
            >
              deploy
            </button>
          )
        )}
      </div>
    </article>
  );
}
