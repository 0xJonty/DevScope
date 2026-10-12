import { z } from "zod";
import { deployConfig, requireEnv } from "../config.js";

/**
 * Metadata pinning for token deploys (PLAN.md §7e). The pin backend is
 * swappable via config/deploy.json `pin_backend`:
 *  - "pumpfun": pump.fun's own unofficial upload endpoint — zero config.
 *    Verified live 2026-10-12 server-side (POST https://pump.fun/api/ipfs,
 *    multipart file+fields → { metadataUri }) despite third-party reports of
 *    deprecation; it may be browser-origin-blocked, but server calls pass.
 *  - "pinata": Pinata pinning API, needs PINATA_JWT (free tier).
 * Every response is schema-validated — fail loud, never degrade.
 */

export interface PinInput {
  image: { data: Buffer; mimeType: string; filename: string };
  meta: {
    name: string;
    symbol: string;
    description: string;
    twitter?: string;
    telegram?: string;
    website?: string;
  };
}

export interface MetadataPinner {
  name: "pumpfun" | "pinata";
  pin(input: PinInput): Promise<{ metadataUri: string }>;
}

export class PinError extends Error {
  constructor(backend: string, detail: string) {
    super(`Metadata pin failed (${backend}): ${detail}`);
    this.name = "PinError";
  }
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/create",
};

const pumpfunPinSchema = z.object({
  metadataUri: z.string().url(),
});

const pumpfunPinner: MetadataPinner = {
  name: "pumpfun",
  async pin({ image, meta }) {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), image.filename);
    form.append("name", meta.name);
    form.append("symbol", meta.symbol);
    form.append("description", meta.description);
    form.append("showName", "true");
    if (meta.twitter) form.append("twitter", meta.twitter);
    if (meta.telegram) form.append("telegram", meta.telegram);
    if (meta.website) form.append("website", meta.website);

    const res = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      headers: BROWSER_HEADERS,
      body: form,
    });
    if (!res.ok) {
      throw new PinError("pumpfun", `HTTP ${res.status} ${await safeText(res)}`);
    }
    const parsed = pumpfunPinSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new PinError("pumpfun", `unexpected response shape: ${parsed.error.message}`);
    }
    return { metadataUri: parsed.data.metadataUri };
  },
};

const pinataPinSchema = z.object({
  IpfsHash: z.string().min(1),
});

const PINATA_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

const pinataPinner: MetadataPinner = {
  name: "pinata",
  async pin({ image, meta }) {
    const jwt = requireEnv("PINATA_JWT");
    const auth = { Authorization: `Bearer ${jwt}` };

    const fileForm = new FormData();
    fileForm.append(
      "file",
      new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
      image.filename
    );
    const fileRes = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: auth,
      body: fileForm,
    });
    if (!fileRes.ok) {
      throw new PinError("pinata", `image pin HTTP ${fileRes.status} ${await safeText(fileRes)}`);
    }
    const fileParsed = pinataPinSchema.safeParse(await fileRes.json());
    if (!fileParsed.success) {
      throw new PinError("pinata", `image pin response shape: ${fileParsed.error.message}`);
    }

    // pump.fun-convention metadata JSON — same shape its own pinner returns.
    const metadata = {
      name: meta.name,
      symbol: meta.symbol,
      description: meta.description,
      image: `${PINATA_GATEWAY}${fileParsed.data.IpfsHash}`,
      ...(meta.twitter ? { twitter: meta.twitter } : {}),
      ...(meta.telegram ? { telegram: meta.telegram } : {}),
      ...(meta.website ? { website: meta.website } : {}),
      showName: true,
      createdOn: "https://pump.fun",
    };
    const jsonRes = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ pinataContent: metadata }),
    });
    if (!jsonRes.ok) {
      throw new PinError("pinata", `metadata pin HTTP ${jsonRes.status} ${await safeText(jsonRes)}`);
    }
    const jsonParsed = pinataPinSchema.safeParse(await jsonRes.json());
    if (!jsonParsed.success) {
      throw new PinError("pinata", `metadata pin response shape: ${jsonParsed.error.message}`);
    }
    return { metadataUri: `${PINATA_GATEWAY}${jsonParsed.data.IpfsHash}` };
  },
};

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "<unreadable body>";
  }
}

export function getPinner(): MetadataPinner {
  return deployConfig.pin_backend === "pinata" ? pinataPinner : pumpfunPinner;
}
