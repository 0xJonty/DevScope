import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { Keypair } from "@solana/web3.js";
import { config, deployConfig } from "../config.js";

/**
 * Vanity mint grind-ahead pool (PLAN.md §7e). Keypairs whose address ends in
 * the configured suffix ("pump" — what frontend-launched coins look like) are
 * pre-ground into data/vanity/<pubkey>.json so a deploy never waits. Consuming
 * one deletes its file BEFORE returning (a mint keypair must never be reused)
 * and kicks off a background re-grind.
 *
 * The grind runs in worker_threads using only node builtins (node:crypto
 * ed25519 keygen — considerably faster than tweetnacl), passed as an eval'd
 * CJS string so it works identically under tsx without loader plumbing.
 */

interface VanityState {
  ready: number;
  grinding: boolean;
  attempts: number;
  ratePerSec: number;
}

const state = { grinding: false, attempts: 0, startedAt: 0 };
let workers: Worker[] = [];

function poolDir(): string {
  return resolve(config.dataDir, "vanity");
}

/** Only keys matching the CURRENT suffix count — a stale pool file ground for
 * another suffix (e.g. a test run) must never satisfy a real deploy. */
function poolFiles(): string[] {
  const dir = poolDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(`${deployConfig.vanity.suffix}.json`));
}

// CJS, builtins only — safe to eval in a Worker regardless of the host loader.
const WORKER_CODE = `
const { parentPort, workerData } = require("node:worker_threads");
const { generateKeyPairSync } = require("node:crypto");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n; }
  return "1".repeat(zeros) + out;
}
const suffix = workerData.suffix;
const REPORT_EVERY = 25000;
let sinceReport = 0;
function main() {
  for (;;) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
    const addr = base58(pub);
    if (addr.endsWith(suffix)) {
      const seed = privateKey.export({ type: "pkcs8", format: "der" }).subarray(-32);
      parentPort.postMessage({ found: { seed: Array.from(seed), pubkey: addr } });
      return;
    }
    if (++sinceReport >= REPORT_EVERY) {
      parentPort.postMessage({ tries: sinceReport });
      sinceReport = 0;
    }
  }
}
main();
`;

/** Spawn one grind round (all cores minus one); resolves when a key lands in the pool. */
function grindOne(suffix: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const threadCount = Math.max(1, cpus().length - 1);
    state.grinding = true;
    state.attempts = 0;
    state.startedAt = Date.now();
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      for (const w of workers) void w.terminate();
      workers = [];
      state.grinding = false;
      err ? rejectPromise(err) : resolvePromise();
    };

    for (let i = 0; i < threadCount; i++) {
      const worker = new Worker(WORKER_CODE, { eval: true, workerData: { suffix } });
      workers.push(worker);
      worker.on("message", (msg: { tries?: number; found?: { seed: number[]; pubkey: string } }) => {
        if (msg.tries) state.attempts += msg.tries;
        if (msg.found) {
          try {
            const kp = Keypair.fromSeed(Uint8Array.from(msg.found.seed));
            const addr = kp.publicKey.toBase58();
            if (addr !== msg.found.pubkey || !addr.endsWith(suffix)) {
              throw new Error(`ground keypair failed validation (${addr} vs ${msg.found.pubkey})`);
            }
            mkdirSync(poolDir(), { recursive: true });
            writeFileSync(resolve(poolDir(), `${addr}.json`), JSON.stringify(Array.from(kp.secretKey)), {
              mode: 0o600,
            });
            const secs = (Date.now() - state.startedAt) / 1000;
            console.log(
              `[vanity] ground …${suffix} mint in ${secs.toFixed(0)}s (${state.attempts.toLocaleString()} reported tries)`
            );
            finish();
          } catch (err) {
            finish(err as Error);
          }
        }
      });
      worker.on("error", (err) => finish(err as Error));
    }
  });
}

/** Top the pool back up to pool_target. Fire-and-forget safe; re-entrant calls no-op. */
export function ensureVanityPool(): void {
  if (state.grinding) return;
  const { suffix, pool_target } = deployConfig.vanity;
  if (pool_target === 0 || poolFiles().length >= pool_target) return;
  void (async () => {
    try {
      while (poolFiles().length < pool_target) {
        await grindOne(suffix);
      }
    } catch (err) {
      console.error("[vanity] grind failed:", err);
    }
  })();
}

/** Take a pre-ground keypair, deleting its file before returning. Null = pool empty. */
export function takeVanityKeypair(): Keypair | null {
  const [first] = poolFiles();
  if (!first) return null;
  const path = resolve(poolDir(), first);
  const bytes = JSON.parse(readFileSync(path, "utf8"));
  rmSync(path);
  ensureVanityPool();
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

export function getVanityState(): VanityState {
  const elapsed = (Date.now() - state.startedAt) / 1000;
  return {
    ready: poolFiles().length,
    grinding: state.grinding,
    attempts: state.attempts,
    ratePerSec: state.grinding && elapsed > 1 ? Math.round(state.attempts / elapsed) : 0,
  };
}
