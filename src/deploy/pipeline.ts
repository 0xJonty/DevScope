import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import PQueue from "p-queue";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  donationFeePda,
  feeSharingConfigPda,
  creatorVaultPda,
  ammCreatorVaultPda,
  type Shareholder,
} from "@pump-fun/pump-sdk";
import {
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { config, deployConfig } from "../config.js";
import { db, schema } from "../db/index.js";
import type { DeployParams, DeploymentStatus } from "../db/schema.js";
import { scanEvents } from "../pipeline/events.js";
import type { ScanEvent } from "../pipeline/types.js";
import { ensureLookupTable, getCachedLookupTable, staticKeysAcross } from "./alt.js";
import { getPinner } from "./ipfs.js";
import { charityWeights, createDonateConfig } from "./pump-extras.js";
import { getWallet } from "./wallets.js";
import { ensureVanityPool, takeVanityKeypair } from "./vanity.js";
import { getConnection, lamportsToSol, priorityFeeMicroLamports, solToLamports } from "./solana.js";

/**
 * Token Deploy pipeline (PLAN.md §7e) — pure Layer A, no Agent SDK anywhere.
 * One atomic create(+dev-buy) transaction per attempt; a failed deploy is
 * retried as a brand-new row. Deployed tokens NEVER enter `tokens`.
 *
 * Own queue (concurrency 1): a deploy must never wait behind a Layer B scan,
 * and two deploys must never race the vanity pool or the blockhash.
 */
export const deployQueue = new PQueue({ concurrency: 1 });

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
export const ALLOWED_IMAGE_MIMES = Object.keys(MIME_EXT);

const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime])
);
EXT_MIME["jpeg"] = "image/jpeg";

export function createDeployment(input: {
  params: DeployParams;
  vanity: boolean;
  narrativeTokenId: string | null;
  image: { data: Buffer; mimeType: string } | null;
}): string {
  const id = randomUUID();
  let imagePath: string | null = null;

  if (input.image) {
    const ext = MIME_EXT[input.image.mimeType];
    if (!ext) throw new Error(`unsupported image type ${input.image.mimeType}`);
    imagePath = resolve(config.dataDir, "images", `deploy-${id}.${ext}`);
    writeFileSync(imagePath, input.image.data);
  } else if (input.narrativeTokenId) {
    const nt = db
      .select()
      .from(schema.narrativeTokens)
      .where(eq(schema.narrativeTokens.id, input.narrativeTokenId))
      .get();
    if (nt?.imagePath && existsSync(nt.imagePath)) imagePath = nt.imagePath;
  }
  if (!imagePath) throw new Error("image required — upload one or pick a narrative token that has one");

  db.insert(schema.deployments)
    .values({
      id,
      narrativeTokenId: input.narrativeTokenId,
      status: "pending",
      params: input.params,
      imagePath,
      vanity: input.vanity,
      createdAt: Date.now(),
    })
    .run();
  return id;
}

export function getDeployment(id: string) {
  const row = db.select().from(schema.deployments).where(eq(schema.deployments.id, id)).get();
  if (!row) throw new Error(`Deployment ${id} not found`);
  return row;
}

export function listDeployments(limit = 50) {
  return db
    .select()
    .from(schema.deployments)
    .orderBy(desc(schema.deployments.createdAt))
    .limit(limit)
    .all();
}

export function deploymentInFlight(): boolean {
  const live: DeploymentStatus[] = ["pending", "pinning", "building", "sending", "confirming", "sharing"];
  return (
    db.select({ id: schema.deployments.id })
      .from(schema.deployments)
      .where(inArray(schema.deployments.status, live))
      .get() !== undefined
  );
}

/** Confirmed deployments keyed by narrative token id (for "deployed" chips). */
export function deployedByNarrativeToken(
  ids: string[]
): Map<string, { mint: string; signature: string }> {
  const map = new Map<string, { mint: string; signature: string }>();
  if (ids.length === 0) return map;
  const rows = db
    .select()
    .from(schema.deployments)
    .where(and(eq(schema.deployments.status, "confirmed"), inArray(schema.deployments.narrativeTokenId, ids)))
    .all();
  for (const r of rows) {
    if (r.narrativeTokenId && r.mint && r.signature) {
      map.set(r.narrativeTokenId, { mint: r.mint, signature: r.signature });
    }
  }
  return map;
}

function patch(id: string, fields: Partial<typeof schema.deployments.$inferInsert>): void {
  db.update(schema.deployments).set(fields).where(eq(schema.deployments.id, id)).run();
}

function setStatus(id: string, status: DeploymentStatus, reason?: string): void {
  patch(id, {
    status,
    statusReason: reason ?? null,
    ...(status === "confirmed" || status === "failed" || status === "dry_run_ok"
      ? { finishedAt: Date.now() }
      : {}),
  });
}

export interface DeployEstimate {
  createCostSol: number;
  devBuySol: number;
  feeShareCostSol: number;
  priorityFeeSol: number;
  txFeeSol: number;
  totalSol: number;
  balanceSol: number;
  sufficient: boolean;
}

export async function estimateDeployCost(
  devBuySol: number,
  priorityFeeSol: number,
  walletPubkey?: string | null,
  withCharity = false,
  /** false = token-quoted deploy: the dev buy is paid in the quote token, not SOL. */
  solQuote = true
): Promise<DeployEstimate> {
  const connection = getConnection();
  const balance = await connection.getBalance(getWallet(walletPubkey).publicKey);
  const txFeeSol = lamportsToSol(5000 * 2); // base fee × 2 signatures
  const feeShareCostSol = withCharity ? deployConfig.fee_share_cost_sol_estimate : 0;
  const totalSol =
    deployConfig.create_cost_sol_estimate +
    (solQuote ? devBuySol : 0) +
    feeShareCostSol +
    priorityFeeSol +
    txFeeSol;
  return {
    createCostSol: deployConfig.create_cost_sol_estimate,
    devBuySol,
    feeShareCostSol,
    priorityFeeSol,
    txFeeSol,
    totalSol,
    balanceSol: lamportsToSol(balance),
    sufficient: lamportsToSol(balance) >= totalSol,
  };
}

export function startDeployment(id: string): void {
  void deployQueue.add(() => executeDeployment(id));
}

async function executeDeployment(id: string): Promise<void> {
  const row = getDeployment(id);
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) =>
    scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  const p = row.params;

  try {
    // 1 — pin image + metadata (nothing spent on failure).
    setStatus(id, "pinning");
    emit({ type: "stage", message: `Pinning image + metadata (${getPinner().name})…` });
    const imageData = readFileSync(row.imagePath!);
    const ext = row.imagePath!.split(".").pop() ?? "png";
    const { metadataUri } = await getPinner().pin({
      image: {
        data: imageData,
        mimeType: EXT_MIME[ext] ?? "image/png",
        filename: `token.${ext}`,
      },
      meta: {
        name: p.name,
        symbol: p.ticker,
        description: p.description,
        twitter: p.twitter,
        telegram: p.telegram,
        website: p.website,
      },
    });
    patch(id, { metadataUri });
    emit({ type: "progress", message: `Metadata pinned: ${metadataUri}` });

    // 1b — donate.gg charity config (fails loud BEFORE anything is spent; a
    // dry run skips it so no real config is created server-side).
    let donateConfigId: PublicKey | null = null;
    const charities = p.charities ?? [];
    if (charities.length > 0 && !p.dryRun) {
      emit({
        type: "progress",
        message: `Creating donate.gg config for ${charities.length} charit${charities.length === 1 ? "y" : "ies"}…`,
      });
      const weights = charityWeights(charities.map((c) => c.shareBps));
      donateConfigId = await createDonateConfig(
        charities.map((c, i) => ({ charityId: c.id, weight: weights[i]! }))
      );
      emit({ type: "progress", message: `Charity config: ${donateConfigId.toBase58()}` });
    } else if (charities.length > 0 && p.dryRun) {
      emit({ type: "log", message: "Dry run — skipping the donate.gg config and the fee-split tx." });
    }

    // 2 — mint keypair (vanity pool or random).
    let mintKeypair: Keypair | null = null;
    if (row.vanity) {
      mintKeypair = takeVanityKeypair();
      if (!mintKeypair) {
        setStatus(id, "failed", "vanity pool empty — wait for the grind or deploy with a random mint");
        emit({ type: "error", message: "Vanity pool empty. Grind in progress — retry shortly, or disable the vanity toggle." });
        ensureVanityPool();
        return;
      }
    } else {
      mintKeypair = Keypair.generate();
    }
    const mint = mintKeypair.publicKey;
    patch(id, { mint: mint.toBase58() });
    emit({ type: "progress", message: `Mint: ${mint.toBase58()}` });

    // 3 — build + simulate.
    setStatus(id, "building");
    emit({ type: "stage", message: "Building create transaction…" });
    const connection = getConnection();
    const onlineSdk = new OnlinePumpSdk(connection);
    const deployer = getWallet(p.walletPubkey);

    const global = await onlineSdk.fetchGlobal();
    const quoteMintPk = p.quoteMint ? new PublicKey(p.quoteMint) : NATIVE_MINT;
    const isSolQuote = quoteMintPk.equals(NATIVE_MINT);
    const resolvedQuote = await onlineSdk.resolveQuoteMint(quoteMintPk);
    if (resolvedQuote.source === "pumpCoin") {
      setStatus(id, "failed", "pump-coin pairings are not supported yet — pick SOL or a listed token quote");
      emit({ type: "error", message: "Pump-coin pairings are not supported yet." });
      return;
    }
    const feeConfig = p.devBuySol > 0 ? await onlineSdk.fetchFeeConfig() : null;

    /** The pump-program instructions for a given mint (no compute budget). */
    const buildPumpIxs = async (mintPk: PublicKey): Promise<TransactionInstruction[]> => {
      const common = {
        global,
        mint: mintPk,
        name: p.name,
        symbol: p.ticker,
        uri: metadataUri,
        creator: deployer.publicKey,
        user: deployer.publicKey,
        mayhemMode: false,
        holderReward: p.holderReward,
      };
      if (p.devBuySol > 0) {
        // Dev buy is denominated in the quote (lamports for SOL, token units otherwise).
        const quoteAmount = new BN(Math.round(p.devBuySol * 10 ** resolvedQuote.decimals));
        const quoted = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: null,
          bondingCurve: null,
          amount: quoteAmount,
          quoteMint: quoteMintPk,
        });
        // Atomic create+buy on a fresh curve — pump.fun's own frontend uses
        // 0 bps for SOL creates, 1000 for token quotes; p.slippageBps mirrors it.
        const minOut = quoted.muln(10000 - p.slippageBps).divn(10000);
        if (isSolQuote) {
          return PUMP_SDK.createV2AndBuyInstructions({
            ...common,
            amount: minOut,
            solAmount: quoteAmount,
          });
        }
        return PUMP_SDK.createV2AndBuyV2Instructions({
          ...common,
          amount: minOut,
          quoteAmount,
          quoteMint: quoteMintPk,
          quoteTokenProgram: resolvedQuote.quoteTokenProgram,
          slippage: p.slippageBps / 100,
        });
      }
      return [
        await PUMP_SDK.createV2Instruction({
          ...common,
          ...(isSolQuote
            ? {}
            : { quoteMint: quoteMintPk, quoteTokenProgram: resolvedQuote.quoteTokenProgram }),
        }),
      ];
    };

    const pumpIxs = await buildPumpIxs(mint);
    const cbIxs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: deployConfig.compute_units }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeMicroLamports(p.priorityFeeSol),
      }),
    ];

    // Packet-size budget: a create+buy with compute-budget ixs overflows 1232
    // bytes (measured 1263 raw). The deployer-owned lookup table absorbs the
    // static accounts; without one (unfunded dry run) we drop the CB ixs.
    const FAKE_BLOCKHASH = mint.toBase58(); // any 32-byte base58 works for sizing
    const sizeOf = (ixs: TransactionInstruction[], tables: AddressLookupTableAccount[]) =>
      new VersionedTransaction(
        new TransactionMessage({
          payerKey: deployer.publicKey,
          recentBlockhash: FAKE_BLOCKHASH,
          instructions: ixs,
        }).compileToV0Message(tables)
      ).serialize().length;

    let instructions = [...cbIxs, ...pumpIxs];
    let tables: AddressLookupTableAccount[] = [];
    if (sizeOf(instructions, tables) > 1232) {
      const probeIxs = await buildPumpIxs(Keypair.generate().publicKey);
      const programIds = new Set(instructions.map((ix) => ix.programId.toBase58()));
      const wanted = staticKeysAcross(pumpIxs, probeIxs).filter(
        (k) => !programIds.has(k.toBase58()) && !k.equals(deployer.publicKey)
      );
      if (p.dryRun) {
        const cached = await getCachedLookupTable(connection);
        if (cached) {
          tables = [cached];
        } else {
          emit({
            type: "log",
            message:
              "Tx oversize and no lookup table yet (created on the first real deploy) — dry-running without compute-budget ixs.",
          });
          instructions = [...pumpIxs];
        }
      } else {
        tables = [
          await ensureLookupTable(
            connection,
            deployer,
            wanted,
            (m) => emit({ type: "progress", message: m }),
            (authority) => {
              try {
                return getWallet(authority);
              } catch {
                return null;
              }
            }
          ),
        ];
      }
      if (sizeOf(instructions, tables) > 1232) {
        setStatus(id, "failed", `transaction oversize: ${sizeOf(instructions, tables)} > 1232 bytes`);
        emit({ type: "error", message: "Transaction does not fit a packet even with the lookup table — this is a bug, report the sizes." });
        return;
      }
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({
      payerKey: deployer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(tables);
    const tx = new VersionedTransaction(message);
    tx.sign([deployer, mintKeypair]);

    const sim = await connection.simulateTransaction(tx, { commitment: "confirmed" });
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-6).join("\n");
      setStatus(id, "failed", `simulation failed: ${JSON.stringify(sim.value.err)}`);
      emit({ type: "error", message: `Simulation failed (nothing spent):\n${logs}` });
      return;
    }
    emit({
      type: "progress",
      message: `Simulation OK — ${sim.value.unitsConsumed?.toLocaleString() ?? "?"} CU.`,
    });

    if (p.dryRun) {
      setStatus(id, "dry_run_ok");
      emit({ type: "done", message: "Dry run complete — transaction simulates clean. Nothing sent." });
      return;
    }

    // 4 — send (signature recorded immediately; past this point never auto-fail
    // on timeout — the tx may have landed).
    setStatus(id, "sending");
    emit({ type: "stage", message: "Sending transaction…" });
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true, // already simulated
      maxRetries: 3,
    });
    patch(id, { signature });
    emit({ type: "progress", message: `Sent: ${signature}` });

    // 5 — confirm.
    setStatus(id, "confirming");
    try {
      const conf = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      if (conf.value.err) {
        setStatus(id, "failed", `on-chain error: ${JSON.stringify(conf.value.err)}`);
        emit({ type: "error", message: `Transaction failed on-chain: ${JSON.stringify(conf.value.err)}` });
        return;
      }
    } catch (err) {
      // Confirmation timeout ≠ failure — leave `confirming`; reconcile resolves it.
      emit({
        type: "log",
        message: `Confirmation timed out — reconciling against the chain (${(err as Error).message}).`,
      });
      await reconcileDeployment(id);
      return;
    }

    // 6 — charity fee split (second tx; the create is already safely landed).
    if (donateConfigId) {
      setStatus(id, "sharing");
      emit({ type: "stage", message: "Configuring charity fee split…" });
      try {
        const feeShareSignature = await sendFeeShareTx({
          deployer,
          mint,
          donateConfigId,
          charities,
          quoteMintPk,
          quoteTokenProgram: resolvedQuote.quoteTokenProgram,
          isSolQuote,
        });
        patch(id, { feeShareSignature });
        emit({ type: "progress", message: `Fee split set: https://solscan.io/tx/${feeShareSignature}` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(id, "confirmed", `charity fee split failed — fees remain 100% creator: ${msg.slice(0, 300)}`);
        emit({
          type: "error",
          message: `Token deployed, but the charity fee split FAILED (fees stay with the creator): ${msg}`,
        });
        return;
      }
    }

    setStatus(id, "confirmed");
    emit({
      type: "done",
      message: `Deployed! https://pump.fun/coin/${mint.toBase58()} — https://solscan.io/tx/${signature}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStatus(id, "failed", msg.slice(0, 500));
    emit({ type: "error", message: `Deploy failed: ${msg}` });
  }
}

/** The follow-up charity tx: sharing config + donation PDA + fee shares.
 * Mirrors pump.fun's own frontend assembly (bundle-verified 2026-10-12). */
async function sendFeeShareTx(input: {
  deployer: Keypair;
  mint: PublicKey;
  donateConfigId: PublicKey;
  charities: Array<{ shareBps: number }>;
  quoteMintPk: PublicKey;
  quoteTokenProgram: PublicKey;
  isSolQuote: boolean;
}): Promise<string> {
  const { deployer, mint, donateConfigId, charities, quoteMintPk, quoteTokenProgram, isSolQuote } = input;
  const connection = getConnection();
  const totalBps = charities.reduce((acc, c) => acc + c.shareBps, 0);
  const donationPda = donationFeePda(mint, donateConfigId);
  const newShareholders: Shareholder[] = [
    ...(totalBps < 10000 ? [{ address: deployer.publicKey, shareBps: 10000 - totalBps }] : []),
    { address: donationPda, shareBps: totalBps },
  ];

  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFeeMicroLamports() }),
    await PUMP_SDK.createFeeSharingConfig({ creator: deployer.publicKey, mint, pool: null }),
    await PUMP_SDK.createDonationFeePda({
      coinCreator: deployer.publicKey,
      mint,
      configId: donateConfigId,
      ...(isSolQuote ? {} : { quoteMint: quoteMintPk }),
    }),
  ];

  if (!isSolQuote) {
    // Token-quoted coins need quote ATAs for the sharing-config vaults and
    // every shareholder before fees can move (as the pump frontend does).
    const sharingConfig = feeSharingConfigPda(mint);
    const owners = [
      creatorVaultPda(sharingConfig),
      ammCreatorVaultPda(sharingConfig),
      ...newShareholders.map((s) => s.address),
    ];
    for (const owner of owners) {
      const ata = getAssociatedTokenAddressSync(quoteMintPk, owner, true, quoteTokenProgram);
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          deployer.publicKey,
          ata,
          owner,
          quoteMintPk,
          quoteTokenProgram
        )
      );
    }
  }

  instructions.push(
    await PUMP_SDK.updateFeeSharesV2({
      authority: deployer.publicKey,
      mint,
      currentShareholders: [deployer.publicKey],
      newShareholders,
      quoteMint: quoteMintPk,
      quoteTokenProgram,
    })
  );

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: deployer.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message()
  );
  tx.sign([deployer]);
  const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const conf = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (conf.value.err) {
    throw new Error(`fee-split tx failed on-chain: ${JSON.stringify(conf.value.err)} (${signature})`);
  }
  return signature;
}

/** Resolve a `sending`/`confirming` row against the chain. Safe to call anytime. */
export async function reconcileDeployment(id: string): Promise<void> {
  const row = getDeployment(id);
  if (row.status !== "confirming" && row.status !== "sending") return;
  if (!row.signature) {
    setStatus(id, "failed", "no signature recorded — nothing was sent");
    return;
  }
  const emit = (ev: Omit<ScanEvent, "scanId" | "at">) =>
    scanEvents.publish({ ...ev, scanId: id, at: Date.now() });
  const connection = getConnection();
  const statuses = await connection.getSignatureStatuses([row.signature], {
    searchTransactionHistory: true,
  });
  const st = statuses.value[0];
  if (st) {
    if (st.err) {
      setStatus(id, "failed", `on-chain error: ${JSON.stringify(st.err)}`);
      emit({ type: "error", message: `Transaction failed on-chain: ${JSON.stringify(st.err)}` });
    } else if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") {
      setStatus(id, "confirmed");
      emit({
        type: "done",
        message: `Deployed! https://pump.fun/coin/${row.mint} — https://solscan.io/tx/${row.signature}`,
      });
    }
    return; // still processing — leave confirming
  }
  // Unknown signature: expired without landing once it's clearly stale.
  if (Date.now() - row.createdAt > 5 * 60_000) {
    setStatus(id, "failed", "transaction expired without landing (not found on chain)");
    emit({ type: "error", message: "Transaction expired without landing — nothing was spent beyond fees. Retry the deploy." });
  }
}

/** Boot recovery — mirrors the scan pipelines' recoverInterrupted* pattern. */
export function recoverInterruptedDeployments(): void {
  const rows = db
    .select()
    .from(schema.deployments)
    .where(
      inArray(schema.deployments.status, [
        "pending",
        "pinning",
        "building",
        "sending",
        "confirming",
        "sharing",
      ] satisfies DeploymentStatus[])
    )
    .all();
  for (const row of rows) {
    if (row.status === "sharing") {
      // The create landed; only the fee-split outcome is unknown.
      setStatus(
        row.id,
        "confirmed",
        row.feeShareSignature
          ? "restarted during fee-split confirm — check the signature on solscan"
          : "restarted before the fee-split tx was sent — fees remain 100% creator"
      );
      continue;
    }
    if (row.signature) {
      void reconcileDeployment(row.id).catch((err) =>
        console.error(`[deploy] reconcile ${row.id} failed:`, err)
      );
    } else {
      setStatus(row.id, "failed", "process restarted mid-deploy (nothing sent)");
    }
  }
  ensureVanityPool();
}
