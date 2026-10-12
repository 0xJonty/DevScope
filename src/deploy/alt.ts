import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from "@solana/web3.js";
import { config } from "../config.js";

/**
 * Deployer-owned address lookup table (PLAN.md §7e). A create(+dev-buy) tx has
 * ~40 account keys and overflows the 1232-byte packet by ~30 bytes with the
 * compute-budget instructions in (measured live 2026-10-12: 1263 raw). Moving
 * the per-wallet-static keys (global/fee/mayhem/vault PDAs, the creator vault…)
 * into a one-time ALT frees ~300+ bytes, keeping priority fees possible.
 *
 * The static key set is DERIVED, not hardcoded: build the same instruction list
 * for two throwaway mints and intersect the account keys — whatever appears in
 * both is mint-independent. Survives pump-sdk account-layout changes.
 *
 * One-time cost: ALT rent (~0.002 SOL) paid by the deployer on the first
 * funded deploy; the address is cached in data/deploy-alt.json and extended
 * in place if the static set ever grows.
 */

const ALT_FILE = "deploy-alt.json";

function altPath(): string {
  return resolve(config.dataDir, ALT_FILE);
}

export function staticKeysAcross(
  ixListA: TransactionInstruction[],
  ixListB: TransactionInstruction[]
): PublicKey[] {
  const keysOf = (list: TransactionInstruction[]) => {
    const set = new Set<string>();
    for (const ix of list) for (const k of ix.keys) set.add(k.pubkey.toBase58());
    return set;
  };
  const a = keysOf(ixListA);
  const b = keysOf(ixListB);
  return [...a].filter((k) => b.has(k)).map((k) => new PublicKey(k));
}

async function fetchTable(
  connection: Connection,
  address: PublicKey
): Promise<AddressLookupTableAccount | null> {
  const res = await connection.getAddressLookupTable(address);
  return res.value;
}

async function sendAltIx(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  extraSigners: Keypair[] = []
): Promise<void> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extraSigners.filter((k) => !k.publicKey.equals(payer.publicKey))]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (conf.value.err) {
    throw new Error(`lookup-table tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
}

/** Wait until the table's freshly-extended addresses are usable (next slot). */
async function waitActive(connection: Connection, address: PublicKey): Promise<AddressLookupTableAccount> {
  for (let i = 0; i < 20; i++) {
    const table = await fetchTable(connection, address);
    if (table && (await connection.getSlot("confirmed")) > table.state.lastExtendedSlot) {
      return table;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("lookup table did not activate within 10s");
}

/** The cached table, if it exists on chain (never creates/spends). */
export async function getCachedLookupTable(
  connection: Connection
): Promise<AddressLookupTableAccount | null> {
  if (!existsSync(altPath())) return null;
  const address = new PublicKey(JSON.parse(readFileSync(altPath(), "utf8")).address);
  return fetchTable(connection, address);
}

/**
 * Return a usable ALT covering `wanted`, creating/extending it as needed
 * (costs a little SOL — only call on a funded, non-dry-run deploy).
 */
export async function ensureLookupTable(
  connection: Connection,
  payer: Keypair,
  wanted: PublicKey[],
  log: (msg: string) => void,
  /** The ALT authority's keypair, when the cached table was created by another
   * wallet (extend must be authority-signed). Null = recreate instead. */
  getAuthorityKeypair: (authorityPubkey: string) => Keypair | null = () => null
): Promise<AddressLookupTableAccount> {
  let address: PublicKey | null = null;
  let authority: string | null = null;
  if (existsSync(altPath())) {
    const cached = JSON.parse(readFileSync(altPath(), "utf8")) as { address: string; authority?: string };
    address = new PublicKey(cached.address);
    authority = cached.authority ?? null;
  }

  let table = address ? await fetchTable(connection, address) : null;
  if (address && !table) log(`cached lookup table ${address.toBase58()} not found on chain — recreating.`);

  if (table) {
    const have = new Set(table.state.addresses.map((a) => a.toBase58()));
    const missing = wanted.filter((k) => !have.has(k.toBase58()));
    if (missing.length === 0) return table;

    const authoritySigner =
      !authority || authority === payer.publicKey.toBase58()
        ? payer
        : getAuthorityKeypair(authority);
    if (authoritySigner) {
      log(`extending deploy lookup table with ${missing.length} new static account(s)…`);
      await sendAltIx(
        connection,
        payer,
        [
          AddressLookupTableProgram.extendLookupTable({
            lookupTable: table.key,
            authority: authoritySigner.publicKey,
            payer: payer.publicKey,
            addresses: missing,
          }),
        ],
        [authoritySigner]
      );
      return waitActive(connection, table.key);
    }
    log("lookup-table authority wallet no longer imported — recreating the table under the current wallet.");
    table = null;
  }

  const slot = await connection.getSlot("confirmed");
  const [createIx, newAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: slot,
  });
  log(`creating deploy lookup table ${newAddress.toBase58()} (one-time, ~0.002 SOL rent)…`);
  await sendAltIx(connection, payer, [
    createIx,
    AddressLookupTableProgram.extendLookupTable({
      lookupTable: newAddress,
      authority: payer.publicKey,
      payer: payer.publicKey,
      addresses: wanted,
    }),
  ]);
  writeFileSync(
    altPath(),
    JSON.stringify({ address: newAddress.toBase58(), authority: payer.publicKey.toBase58() }, null, 2) + "\n"
  );
  return waitActive(connection, newAddress);
}
