import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { config, deployConfig } from "../config.js";

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solanaRpcUrl, { commitment: "confirmed" });
  }
  return connection;
}

export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/** Total priority fee (SOL) → per-CU price in micro-lamports for the configured CU limit. */
export function priorityFeeMicroLamports(priorityFeeSol: number): number {
  return Math.round((priorityFeeSol * LAMPORTS_PER_SOL * 1_000_000) / deployConfig.compute_units);
}
