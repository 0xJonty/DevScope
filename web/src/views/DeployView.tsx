import { useCallback, useEffect, useState } from "react";
import { api, type Deployment, type DeploymentStatus } from "../api";
import DeployForm from "../components/DeployForm";

const STATUS_STYLES: Record<DeploymentStatus, string> = {
  pending: "text-dim border-line",
  pinning: "text-mid border-mid/40",
  building: "text-mid border-mid/40",
  sending: "text-mid border-mid/40",
  confirming: "text-mid border-mid/40",
  confirmed: "text-worked border-worked/40",
  failed: "text-failed border-failed/40",
  dry_run_ok: "text-dim border-line",
};

/** Deploy page — pump.fun launcher (PLAN.md §7e). */
export default function DeployView() {
  const [deployments, setDeployments] = useState<Deployment[]>([]);

  const refresh = useCallback(() => {
    api.listDeployments().then(setDeployments, () => {});
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <div className="space-y-10 max-w-2xl">
      <section className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Deploy</h1>
          <p className="text-dim text-sm mt-1">
            Launch a pump.fun token straight from DevScope — direct program calls, no third-party fee.
          </p>
        </div>
        <DeployForm onDeployed={refresh} />
      </section>

      {deployments.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-dim">Recent deploys</h2>
          <ul className="space-y-2">
            {deployments.map((d) => (
              <li key={d.id} className="border border-line rounded-md px-4 py-2.5 text-sm flex items-center gap-3 min-w-0">
                {d.imageUrl && <img src={d.imageUrl} alt="" className="w-8 h-8 rounded object-cover border border-line shrink-0" />}
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-dim text-xs ml-2">${d.ticker}</span>
                  {d.dryRun && <span className="text-faint text-xs ml-2">dry run</span>}
                  {d.status === "failed" && d.statusReason && (
                    <p className="text-faint text-xs truncate" title={d.statusReason}>{d.statusReason}</p>
                  )}
                </div>
                {d.status === "confirmed" && d.mint && (
                  <a className="text-accent text-xs hover:underline shrink-0" href={`https://pump.fun/coin/${d.mint}`} target="_blank" rel="noreferrer">
                    pump.fun
                  </a>
                )}
                <span className={`text-[11px] border rounded-full px-2 py-0.5 shrink-0 ${STATUS_STYLES[d.status]}`}>
                  {d.status.replace(/_/g, " ")}
                </span>
                <span className="text-faint text-xs shrink-0">{new Date(d.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
