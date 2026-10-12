import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair, LAMPORTS_PER_SOL, type Connection } from "@solana/web3.js";
import { config } from "../config.js";

/**
 * Deploy wallet manager (PLAN.md §7e / §12 exception). Multiple imported
 * wallets live in data/wallets.json (gitignored, 0600); one is "main" — the
 * default signer for deploys, overridable per deploy. Secrets never leave this
 * module except as a Keypair handed to the signer, and are never logged or
 * returned by any API.
 *
 * Import formats: base58 secret (Phantom/Solflare export) or a solana-CLI
 * JSON array of 64 bytes.
 */

const WALLETS_FILE = "wallets.json";
const LEGACY_KEYPAIR_FILE = "deployer-keypair.json";

interface StoredWallet {
  name: string;
  pubkey: string;
  secretKey: number[];
}

interface WalletsFile {
  main: string | null;
  wallets: StoredWallet[];
}

function walletsPath(): string {
  return resolve(config.dataDir, WALLETS_FILE);
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = BASE58_ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 character '${c}'`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function load(): WalletsFile {
  if (existsSync(walletsPath())) {
    return JSON.parse(readFileSync(walletsPath(), "utf8")) as WalletsFile;
  }
  // Migrate the 0.14.0 single burner keypair, if present.
  const legacy = resolve(config.dataDir, LEGACY_KEYPAIR_FILE);
  if (existsSync(legacy)) {
    const bytes = JSON.parse(readFileSync(legacy, "utf8")) as number[];
    const kp = Keypair.fromSecretKey(Uint8Array.from(bytes));
    const file: WalletsFile = {
      main: kp.publicKey.toBase58(),
      wallets: [{ name: "burner", pubkey: kp.publicKey.toBase58(), secretKey: bytes }],
    };
    save(file);
    console.log(`[deploy] migrated ${LEGACY_KEYPAIR_FILE} into wallets.json as "burner" (main)`);
    return file;
  }
  return { main: null, wallets: [] };
}

function save(file: WalletsFile): void {
  writeFileSync(walletsPath(), JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  chmodSync(walletsPath(), 0o600);
}

export function listWallets(): Array<{ name: string; pubkey: string; isMain: boolean }> {
  const file = load();
  return file.wallets.map((w) => ({ name: w.name, pubkey: w.pubkey, isMain: w.pubkey === file.main }));
}

export function importWallet(name: string, secret: string): { pubkey: string } {
  const trimmed = secret.trim();
  let bytes: Uint8Array;
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr) || arr.length !== 64) {
      throw new Error("JSON secret must be a 64-byte array (solana-CLI format)");
    }
    bytes = Uint8Array.from(arr as number[]);
  } else {
    bytes = base58Decode(trimmed);
    if (bytes.length !== 64) {
      throw new Error(`base58 secret decodes to ${bytes.length} bytes — expected 64 (full secret key, not a seed)`);
    }
  }
  const kp = Keypair.fromSecretKey(bytes); // throws on an invalid key
  const file = load();
  const pubkey = kp.publicKey.toBase58();
  if (file.wallets.some((w) => w.pubkey === pubkey)) {
    throw new Error(`wallet ${pubkey.slice(0, 8)}… is already imported`);
  }
  file.wallets.push({ name: name.trim() || `wallet ${file.wallets.length + 1}`, pubkey, secretKey: Array.from(bytes) });
  if (!file.main) file.main = pubkey;
  save(file);
  return { pubkey };
}

export function removeWallet(pubkey: string): void {
  const file = load();
  const before = file.wallets.length;
  file.wallets = file.wallets.filter((w) => w.pubkey !== pubkey);
  if (file.wallets.length === before) throw new Error("wallet not found");
  if (file.main === pubkey) file.main = file.wallets[0]?.pubkey ?? null;
  save(file);
}

export function setMainWallet(pubkey: string): void {
  const file = load();
  if (!file.wallets.some((w) => w.pubkey === pubkey)) throw new Error("wallet not found");
  file.main = pubkey;
  save(file);
}

/** The signing keypair: a specific wallet, or main when pubkey is omitted. */
export function getWallet(pubkey?: string | null): Keypair {
  const file = load();
  const target = pubkey ?? file.main;
  if (!target) {
    throw new Error("no deploy wallet imported — add one in Settings → Wallets");
  }
  const row = file.wallets.find((w) => w.pubkey === target);
  if (!row) throw new Error(`deploy wallet ${target.slice(0, 8)}… not found — re-select it in Settings → Wallets`);
  return Keypair.fromSecretKey(Uint8Array.from(row.secretKey));
}

export function hasWallets(): boolean {
  return load().wallets.length > 0;
}

export async function walletStatuses(
  connection: Connection
): Promise<Array<{ name: string; pubkey: string; isMain: boolean; balanceSol: number }>> {
  const file = load();
  const balances = await Promise.all(
    file.wallets.map((w) =>
      connection.getBalance(Keypair.fromSecretKey(Uint8Array.from(w.secretKey)).publicKey).catch(() => 0)
    )
  );
  return file.wallets.map((w, i) => ({
    name: w.name,
    pubkey: w.pubkey,
    isMain: w.pubkey === file.main,
    balanceSol: (balances[i] ?? 0) / LAMPORTS_PER_SOL,
  }));
}
