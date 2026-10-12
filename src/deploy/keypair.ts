import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, type Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config } from "../config.js";

/**
 * Burner deployer keypair (PLAN.md §7e / §12 exception). Lives at
 * data/deployer-keypair.json (gitignored, 0600), solana-CLI format (JSON array
 * of 64 bytes). Generated on first use. The secret never leaves this module —
 * callers get the Keypair only to sign, and nothing here ever logs it.
 * Fund it only with what you intend to spend.
 */

const KEYPAIR_FILE = "deployer-keypair.json";

let cached: Keypair | null = null;

function keypairPath(): string {
  return resolve(config.dataDir, KEYPAIR_FILE);
}

export function getDeployerKeypair(): Keypair {
  if (cached) return cached;
  const path = keypairPath();
  if (existsSync(path)) {
    const bytes = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(
        `Deployer keypair file ${KEYPAIR_FILE} is not a 64-byte solana-CLI array — refusing to guess.`
      );
    }
    cached = Keypair.fromSecretKey(Uint8Array.from(bytes));
    return cached;
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  chmodSync(path, 0o600);
  console.warn(
    `[deploy] Generated burner deployer keypair → data/${KEYPAIR_FILE}\n` +
      `[deploy] Address: ${kp.publicKey.toBase58()}\n` +
      `[deploy] FUND ONLY WHAT YOU WILL SPEND. This file is the only copy of the key.`
  );
  cached = kp;
  return cached;
}

export function getDeployerPubkey(): string {
  return getDeployerKeypair().publicKey.toBase58();
}

export async function getDeployerStatus(
  connection: Connection
): Promise<{ pubkey: string; balanceSol: number }> {
  const kp = getDeployerKeypair();
  const lamports = await connection.getBalance(kp.publicKey);
  return { pubkey: kp.publicKey.toBase58(), balanceSol: lamports / LAMPORTS_PER_SOL };
}
