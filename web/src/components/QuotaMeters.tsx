import type { QuotaMap } from "../api";

export default function QuotaMeters({ quota }: { quota: QuotaMap | null }) {
  if (!quota) return null;
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-md">
      {Object.entries(quota).map(([provider, { used, limit }]) => {
        const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
        const hot = pct > 80;
        return (
          <div key={provider}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-dim">{provider}</span>
              <span className={hot ? "text-failed" : "text-faint"}>
                {used.toLocaleString()}/{limit.toLocaleString()}
              </span>
            </div>
            <div className="h-1 rounded-full bg-raised overflow-hidden">
              <div
                className={`h-full rounded-full ${hot ? "bg-failed" : "bg-accent"}`}
                style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
