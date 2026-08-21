import {
  createPublicClient,
  http,
  fallback,
  parseAbi,
  parseUnits,
  formatUnits,
  decodeEventLog,
} from "viem";
import { bsc } from "viem/chains";
import { DEX_LIST, PAIRS, WATCHED_PAIRS, TOKENS, BSC_HTTP_RPC, type DexId } from "./chain";

/** Public BSC endpoints kept only as a last-resort fallback. */
const PUBLIC_FALLBACKS = [
  "https://bsc-rpc.publicnode.com",
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.defibit.io",
];

export function usingPrivateRpc() {
  return true;
}

export function client() {
  const urls = [BSC_HTTP_RPC, ...PUBLIC_FALLBACKS];
  return createPublicClient({
    chain: bsc,
    transport: fallback(
      urls.map((url) => http(url, { batch: true, timeout: 12_000 })),
      { rank: false, retryCount: 1 },
    ),
  });
}



const V2_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
]);

const V3_QUOTER_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

export const SWAP_EVENT_ABI = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0In", type: "uint256", indexed: false },
      { name: "amount1In", type: "uint256", indexed: false },
      { name: "amount0Out", type: "uint256", indexed: false },
      { name: "amount1Out", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
] as const;

export type { Quote } from "./arb-math";


export interface QuoteSnapshot {
  blockNumber: string;
  gasPriceGwei: number;
  timestamp: number;
  privateRpc: boolean;
  quotes: Quote[];
}

interface Call {
  pairId: string;
  dex: DexId;
  fee: number;
  decimalsOut: number;
  contract: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  };
}

const V3_FEE_TIERS = [100, 500, 2500, 10000];

/** Builds one quote call per venue (and per V3 fee tier) for tokenIn -> tokenOut. */
function legCalls(
  pairId: string,
  tokenIn: { address: `0x${string}`; decimals: number },
  tokenOut: { address: `0x${string}`; decimals: number },
  amountIn: bigint,
): Call[] {
  const calls: Call[] = [];
  for (const dex of DEX_LIST) {
    if (dex.kind === "v2") {
      calls.push({
        pairId,
        dex: dex.id,
        fee: 0,
        decimalsOut: tokenOut.decimals,
        contract: {
          address: dex.quoter,
          abi: V2_ABI,
          functionName: "getAmountsOut",
          args: [amountIn, [tokenIn.address, tokenOut.address]],
        },
      });
    } else {
      for (const fee of V3_FEE_TIERS) {
        calls.push({
          pairId,
          dex: dex.id,
          fee,
          decimalsOut: tokenOut.decimals,
          contract: {
            address: dex.quoter,
            abi: V3_QUOTER_ABI,
            functionName: "quoteExactInputSingle",
            args: [
              {
                tokenIn: tokenIn.address,
                tokenOut: tokenOut.address,
                amountIn,
                fee,
                sqrtPriceLimitX96: 0n,
              },
            ],
          },
        });
      }
    }
  }
  return calls;
}

function amountFrom(result: unknown): bigint | null {
  if (!Array.isArray(result)) return null;
  const arr = result as unknown[];
  // V3 quoter returns [amountOut, ...]; V2 getAmountsOut returns [in, ..., out]
  const raw =
    typeof arr[0] === "bigint" && arr.length === 4 ? (arr[0] as bigint) : (arr[arr.length - 1] as bigint);
  return typeof raw === "bigint" && raw > 0n ? raw : null;
}

/**
 * Quotes the FULL round trip the executor actually performs:
 *   1. spend `loanSize` quote tokens to buy the base token on venue A
 *   2. sell the base token back to the quote token on venue B
 * Quoting only one direction (the old behaviour) produced phantom spreads that
 * always reverted on chain, because buying is priced worse than selling.
 */
export async function fetchQuotes(loanScale = 1): Promise<QuoteSnapshot> {
  const pc = client();
  const scale = Math.min(Math.max(loanScale, 0.05), 25);

  // Round 1 — quote -> base with the real loan notional.
  const buyCalls: Call[] = [];
  const loanSizes = new Map<string, number>();
  for (const pair of PAIRS) {
    const base = TOKENS[pair.base];
    const quote = TOKENS[pair.quote];
    const loanSize = pair.loanSize * scale;
    loanSizes.set(pair.id, loanSize);
    buyCalls.push(
      ...legCalls(pair.id, quote, base, parseUnits(loanSize.toFixed(quote.decimals), quote.decimals)),
    );
  }

  const buyResults = await pc.multicall({
    contracts: buyCalls.map((c) => c.contract) as never,
    allowFailure: true,
  });

  // best base amount per venue, and the deepest venue's amount as the sell-leg reference
  const buyBest = new Map<string, { out: number; fee: number }>();
  const refBase = new Map<string, number>();
  buyResults.forEach((res, i) => {
    const meta = buyCalls[i]!;
    if (res.status !== "success") return;
    const raw = amountFrom(res.result);
    if (raw == null) return;
    const out = Number(formatUnits(raw, meta.decimalsOut));
    const key = `${meta.pairId}|${meta.dex}`;
    const current = buyBest.get(key);
    if (!current || out > current.out) buyBest.set(key, { out, fee: meta.fee });
    if (out > (refBase.get(meta.pairId) ?? 0)) refBase.set(meta.pairId, out);
  });

  // Round 2 — base -> quote using each pair's reference base amount.
  const sellCalls: Call[] = [];
  for (const pair of PAIRS) {
    const ref = refBase.get(pair.id);
    if (!ref || ref <= 0) continue;
    const base = TOKENS[pair.base];
    const quote = TOKENS[pair.quote];
    sellCalls.push(
      ...legCalls(pair.id, base, quote, parseUnits(ref.toFixed(base.decimals), base.decimals)),
    );
  }

  const [sellResults, blockNumber, gasPrice] = await Promise.all([
    sellCalls.length
      ? pc.multicall({ contracts: sellCalls.map((c) => c.contract) as never, allowFailure: true })
      : Promise.resolve([] as { status: string; result?: unknown }[]),
    pc.getBlockNumber(),
    pc.getGasPrice(),
  ]);

  const sellBest = new Map<string, { out: number; fee: number }>();
  sellResults.forEach((res, i) => {
    const meta = sellCalls[i]!;
    if (res.status !== "success") return;
    const raw = amountFrom(res.result);
    if (raw == null) return;
    const out = Number(formatUnits(raw, meta.decimalsOut));
    const key = `${meta.pairId}|${meta.dex}`;
    const current = sellBest.get(key);
    if (!current || out > current.out) sellBest.set(key, { out, fee: meta.fee });
  });

  const quotes: Quote[] = [];
  for (const pair of PAIRS) {
    const ref = refBase.get(pair.id) ?? 0;
    for (const dex of DEX_LIST) {
      const key = `${pair.id}|${dex.id}`;
      const buy = buyBest.get(key);
      const sell = sellBest.get(key);
      const price = sell && ref > 0 ? sell.out / ref : null;
      quotes.push({
        pairId: pair.id,
        dex: dex.id,
        price,
        amountOut: sell ? sell.out.toString() : null,
        buyOut: buy?.out ?? null,
        buyFee: buy?.fee ?? 0,
        sellOut: sell?.out ?? null,
        sellFee: sell?.fee ?? 0,
        refBase: ref,
        loanSize: loanSizes.get(pair.id) ?? pair.loanSize,
      });
    }
  }

  return {
    blockNumber: blockNumber.toString(),
    gasPriceGwei: Number(gasPrice) / 1e9,
    timestamp: Date.now(),
    privateRpc: usingPrivateRpc(),
    quotes,
  };
}

export interface LargeSwap {
  id: string;
  pairId: string;
  blockNumber: string;
  txHash: string;
  side: "buy" | "sell";
  baseAmount: number;
  quoteAmount: number;
}

export async function fetchLargeSwaps(lookbackBlocks: number, minQuote: number) {
  const pc = client();
  const head = await pc.getBlockNumber();
  const fromBlock = head - BigInt(Math.max(1, Math.min(lookbackBlocks, 900)));

  const perPair = await Promise.all(
    WATCHED_PAIRS.map(async (pair) => {
      try {
        const logs = await pc.getLogs({
          address: pair.watchPool,
          event: SWAP_EVENT_ABI[0],
          fromBlock,
          toBlock: head,
        });
        const base = TOKENS[pair.base];
        const quote = TOKENS[pair.quote];
        // token0 is the lower address in a V2 pool
        const baseIsToken0 = base.address.toLowerCase() < quote.address.toLowerCase();
        return logs.map((log) => {
          const decoded = decodeEventLog({
            abi: SWAP_EVENT_ABI,
            data: log.data,
            topics: log.topics,
          });
          const a = decoded.args as unknown as {
            amount0In: bigint;
            amount1In: bigint;
            amount0Out: bigint;
            amount1Out: bigint;
          };
          const baseIn = baseIsToken0 ? a.amount0In : a.amount1In;
          const baseOut = baseIsToken0 ? a.amount0Out : a.amount1Out;
          const quoteIn = baseIsToken0 ? a.amount1In : a.amount0In;
          const quoteOut = baseIsToken0 ? a.amount1Out : a.amount0Out;
          const baseAmount = Number(formatUnits(baseIn > 0n ? baseIn : baseOut, base.decimals));
          const quoteAmount = Number(formatUnits(quoteIn > 0n ? quoteIn : quoteOut, quote.decimals));
          const swap: LargeSwap = {
            id: `${log.transactionHash}-${log.logIndex}`,
            pairId: pair.id,
            blockNumber: (log.blockNumber ?? 0n).toString(),
            txHash: log.transactionHash ?? "",
            side: baseOut > 0n ? "buy" : "sell",
            baseAmount,
            quoteAmount,
          };
          return swap;
        });
      } catch {
        return [] as LargeSwap[];
      }
    }),
  );

  const flat = perPair.flat();
  const filtered = flat.filter((s) => {
    const pair = PAIRS.find((p) => p.id === s.pairId)!;
    // threshold expressed in multiples of the pair's quoting size
    return s.baseAmount >= pair.size * (minQuote / 100);
  });

  filtered.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));
  return { head: head.toString(), swaps: filtered.slice(0, 40) };
}
