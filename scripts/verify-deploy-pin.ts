/**
 * Live regression check for the deploy metadata pinner (free, no SOL).
 * Pins a tiny generated PNG + probe metadata through the configured backend,
 * fetches the metadata URI back through an IPFS gateway and schema-validates
 * the round-trip. Run after touching src/deploy/ipfs.ts or config/deploy.json.
 *
 *   npx tsx scripts/verify-deploy-pin.ts
 */
import { z } from "zod";
import { getPinner } from "../src/deploy/ipfs.js";

// 1×1 red PNG, pre-encoded (keeps the script dependency-free).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const roundTripSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  description: z.string(),
  image: z.string().url(),
  showName: z.boolean().optional(),
});

async function main() {
  const pinner = getPinner();
  console.log(`[pin-verify] backend: ${pinner.name}`);

  const { metadataUri } = await pinner.pin({
    image: { data: TINY_PNG, mimeType: "image/png", filename: "probe.png" },
    meta: {
      name: "DevScope Pin Probe",
      symbol: "PROBE",
      description: "verify-deploy-pin.ts round-trip check — not a token",
    },
  });
  console.log(`[pin-verify] metadataUri: ${metadataUri}`);

  // ipfs.io is deprecating plain gateway fetches; gateway.pinata.cloud resolves
  // both backends' CIDs (verified 2026-10-12).
  const cid = metadataUri.split("/ipfs/")[1];
  if (!cid) throw new Error(`metadataUri has no /ipfs/ CID segment: ${metadataUri}`);
  const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
  const res = await fetch(gatewayUrl);
  if (!res.ok) throw new Error(`gateway fetch failed: HTTP ${res.status}`);
  const parsed = roundTripSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`metadata shape invalid: ${parsed.error.message}`);

  console.log(`[pin-verify] round-trip OK — image: ${parsed.data.image}`);
}

main().catch((err) => {
  console.error("[pin-verify] FAILED:", err);
  process.exit(1);
});
