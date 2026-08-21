import {
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  toHex,
} from "viem";
import { DEXES, DEX_TYPE, FLASH_ARB_ABI, TOKENS, type DexId, type Pair } from "./chain";
import type { Opportunity } from "./arb-math";
import type { Eip1193Provider } from "@/hooks/useWallet";

export interface ExecuteArgs {
  provider: Eip1193Provider;
  from: string;
  contract: `0x${string}`;
  opportunity: Opportunity;
  /** loan size denominated in the pair's quote token */
  loanAmount: number;
  /** minimum profit in quote token required or the tx reverts */
  minProfit: number;
  /** seconds the request stays valid on chain */
  deadlineSeconds?: number;
}

interface SwapLeg {
  dexType: number;
  router: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  poolFee: number;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96: bigint;
}

function leg(
  dex: DexId,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  poolFee = 0,
): SwapLeg {
  const venue = DEXES[dex];
  return {
    dexType: DEX_TYPE[venue.kind],
    router: venue.router,
    tokenIn,
    tokenOut,
    // uint24 pool fee is only meaningful for V3 routers
    poolFee: venue.kind === "v3" ? (poolFee || venue.fee || 500) : 0,
    // profit is enforced atomically by minimumProfit at the end of the loop
    amountOutMinimum: 0n,
    sqrtPriceLimitX96: 0n,
  };
}

/** Builds the exact calldata the executor expects for this opportunity. */
export function buildArbCalldata(
  opportunity: Opportunity,
  loanAmount: number,
  minProfit = 0,
  deadlineSeconds = 120,
) {
  const pair: Pair = opportunity.pair;
  const asset = TOKENS[pair.quote];
  const intermediate = TOKENS[pair.base];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);

  const data = encodeFunctionData({
    abi: FLASH_ARB_ABI,
    functionName: "executeArbitrage",
    args: [
      asset.address,
      parseUnits(loanAmount.toFixed(asset.decimals), asset.decimals),
      leg(opportunity.buyDex, asset.address, intermediate.address, opportunity.buyFee),
      leg(opportunity.sellDex, intermediate.address, asset.address, opportunity.sellFee),
      parseUnits(Math.max(minProfit, 0).toFixed(asset.decimals), asset.decimals),
      deadline,
    ],
  });

  return { data, asset };
}

/**
 * Dry-runs executeArbitrage with eth_call. The executor is owner-gated, so the
 * call is made *from* the on-chain owner: a green result means the atomic route
 * (borrow -> buy -> sell -> repay) clears every cost at the current block.
 */
export async function simulateFlashArb({
  provider,
  contract,
  opportunity,
  loanAmount,
  minProfit = 0,
}: Omit<ExecuteArgs, "from" | "provider"> & { provider: Eip1193Provider }) {
  const { data, asset } = buildArbCalldata(opportunity, loanAmount, minProfit);
  const owner = await read<`0x${string}`>(provider, contract, "owner");
  try {
    const result = (await provider.request({
      method: "eth_call",
      params: [{ from: owner, to: contract, data }, "latest"],
    })) as `0x${string}`;
    return { ok: true as const, requestHash: result, owner };
  } catch (error) {
    return {
      ok: false as const,
      owner,
      reason: describeRevert(error, asset.decimals, opportunity.pair.quote),
    };
  }
}

/**
 * Sends BnbArbExecutor.executeArbitrage: flash-borrow the quote token, buy the
 * base token on the cheap venue, sell it on the rich venue, repay in one tx.
 */
export async function executeFlashArb({
  provider,
  from,
  contract,
  opportunity,
  loanAmount,
  minProfit,
  deadlineSeconds = 120,
}: ExecuteArgs) {
  const { data, asset } = buildArbCalldata(
    opportunity,
    loanAmount,
    minProfit,
    deadlineSeconds,
  );

  // Simulate first so reverts surface as readable custom errors instead of a
  // wallet-level "transaction may fail" warning after the user has signed.
  let gas: bigint;
  try {
    const estimate = (await provider.request({
      method: "eth_estimateGas",
      params: [{ from, to: contract, data }],
    })) as `0x${string}`;
    gas = (BigInt(estimate) * 125n) / 100n;
  } catch (error) {
    throw new Error(describeRevert(error, asset.decimals, opportunity.pair.quote));
  }

  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: contract, data, gas: toHex(gas) }],
  })) as string;

  return txHash;
}


/** Turns an RPC revert payload into a human sentence using the executor ABI. */
export function describeRevert(error: unknown, decimals: number, symbol: string): string {
  const raw = extractRevertData(error);
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi: FLASH_ARB_ABI, data: raw }) as unknown as {
        errorName: string;
        args?: readonly unknown[];
      };
      if (decoded.errorName === "InsufficientProfit") {
        const [actual, required] = decoded.args as unknown as [bigint, bigint];
        return `Not profitable on-chain: ${formatUnits(actual, decimals)} ${symbol} vs required ${formatUnits(required, decimals)} ${symbol}. Lower min profit or wait for a wider spread.`;
      }
      if (decoded.errorName === "RouterNotAllowed") {
        return "Router is not allowlisted on the executor — allow it in the Executor panel first.";
      }
      if (decoded.errorName === "Paused") return "Executor is paused — unpause it to trade.";
      if (decoded.errorName === "NotOwner") {
        return "Connected wallet is not the executor owner.";
      }
      if (decoded.errorName === "InvalidDeadline") return "Request deadline already passed.";
      if (decoded.errorName === "InvalidAmount") return "Loan amount is invalid for this asset.";
      if (decoded.errorName === "InvalidRoute") return "Swap route is invalid for this executor.";
      if (decoded.errorName === "ExternalCallFailed") {
        return "A DEX swap call failed (likely insufficient pool liquidity for this size).";
      }
      return `Reverted with ${decoded.errorName}.`;
    } catch {
      /* fall through to the raw message */
    }
  }
  const message =
    (error as { message?: string })?.message ?? "Transaction simulation failed on BNB Chain.";
  return message;
}

function extractRevertData(error: unknown): `0x${string}` | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): `0x${string}` | null => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    const obj = node as Record<string, unknown>;
    for (const key of ["data", "error", "cause", "originalError"]) {
      const value = obj[key];
      if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value)) {
        return value as `0x${string}`;
      }
      const nested = walk(value);
      if (nested) return nested;
    }
    return null;
  };
  return walk(error);
}


async function read<T>(
  provider: Eip1193Provider,
  contract: `0x${string}`,
  functionName: "owner" | "paused" | "BNB_POOL" | "allowedRouters",
  args?: readonly unknown[],
): Promise<T> {
  const data = encodeFunctionData({
    abi: FLASH_ARB_ABI,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  });
  const result = (await provider.request({
    method: "eth_call",
    params: [{ to: contract, data }, "latest"],
  })) as `0x${string}`;
  return decodeFunctionResult({
    abi: FLASH_ARB_ABI,
    functionName,
    data: result,
  }) as T;
}

export interface ExecutorStatus {
  owner: `0x${string}`;
  paused: boolean;
  pool: `0x${string}`;
  routers: Record<DexId, boolean>;
  isOwner: boolean;
  ready: boolean;
}

/**
 * Preflight the deployed executor: ownership, pause flag, Aave pool wiring and
 * the router allowlist. Cheap eth_calls, so it can run on an interval.
 */
export async function readExecutorStatus(
  provider: Eip1193Provider,
  contract: `0x${string}`,
  wallet?: string | null,
): Promise<ExecutorStatus> {
  const [owner, paused, pool] = await Promise.all([
    read<`0x${string}`>(provider, contract, "owner"),
    read<boolean>(provider, contract, "paused"),
    read<`0x${string}`>(provider, contract, "BNB_POOL"),
  ]);

  const ids = Object.keys(DEXES) as DexId[];
  const flags = await Promise.all(
    ids.map((id) => read<boolean>(provider, contract, "allowedRouters", [DEXES[id].router])),
  );
  const routers = Object.fromEntries(ids.map((id, i) => [id, flags[i] ?? false])) as Record<
    DexId,
    boolean
  >;

  const isOwner = !!wallet && wallet.toLowerCase() === owner.toLowerCase();
  return {
    owner,
    paused,
    pool,
    routers,
    isOwner,
    ready: isOwner && !paused && Object.values(routers).some(Boolean),
  };
}

/** Owner-only: allow or revoke a DEX router on the executor. */
export async function setRouterAllowed(
  provider: Eip1193Provider,
  from: string,
  contract: `0x${string}`,
  router: `0x${string}`,
  allowed: boolean,
) {
  const data = encodeFunctionData({
    abi: FLASH_ARB_ABI,
    functionName: "setRouterAllowed",
    args: [router, allowed],
  });
  return (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: contract, data }],
  })) as string;
}

export function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
