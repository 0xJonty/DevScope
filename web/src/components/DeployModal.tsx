import { useEffect, useState } from "react";
import { api, type Deployment, type NarrativeTokenDetail } from "../api";
import Modal from "./Modal";
import DeployForm from "./DeployForm";

/** Deploy modal for a narrative token — fetches the detail and prefills the
 * form (name/ticker exactly as the crowd spells them, summary → description,
 * holder-rewards fee type → the holderReward flag, narrative image if any). */
export default function DeployModal({
  narrativeTokenId,
  onClose,
  onDeployed,
}: {
  narrativeTokenId: string;
  onClose: () => void;
  onDeployed?: (d: Deployment) => void;
}) {
  const [detail, setDetail] = useState<NarrativeTokenDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getNarrativeToken(narrativeTokenId)
      .then(setDetail, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [narrativeTokenId]);

  const n = detail?.narrative;
  return (
    <Modal title={n ? `Deploy ${n.token_name ?? n.title}` : "Deploy"} onClose={onClose}>
      {error && <p className="text-failed text-sm">{error}</p>}
      {!detail && !error && <p className="text-faint text-sm">Loading…</p>}
      {detail && n && (
        <DeployForm
          prefill={{
            name: n.token_name ?? n.title,
            ticker: n.ticker ?? "",
            description: n.summary,
            imagePath: detail.imagePath,
            holderReward: n.fee_type === "holder_rewards",
            narrativeTokenId,
          }}
          onDeployed={onDeployed}
        />
      )}
    </Modal>
  );
}
