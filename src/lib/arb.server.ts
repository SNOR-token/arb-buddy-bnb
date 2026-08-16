import { createPublicClient, http, parseAbi, parseUnits, formatUnits, decodeEventLog } from "viem";
import { bsc } from "viem/chains";
import { DEX_LIST, PAIRS, TOKENS, type DexId } from "./chain";

function rpcUrl() {
  const explicit =
    process.env["QUICKNODE_BSC_URL"] ??
    process.env["QUICKNODE_HTTP_URL"] ??
    process.env["BSC_RPC_URL"];
  if (explicit) return explicit;
  const token = process.env["QUICKNODE_TOKEN"];
  const host = process.env["QUICKNODE_HOST"];
  if (token && host) return `https://${host}/${token}/`;
  return "https://bsc-dataseed.bnbchain.org";
}

export function usingPrivateRpc() {
  return Boolean(
    process.env["QUICKNODE_BSC_URL"] ??
      process.env["QUICKNODE_HTTP_URL"] ??
      process.env["BSC_RPC_URL"] ??
      (process.env["QUICKNODE_TOKEN"] && process.env["QUICKNODE_HOST"]),
  );
}

export function client() {
  return createPublicClient({
    chain: bsc,
    transport: http(rpcUrl(), { batch: true, timeout: 15_000 }),
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

export interface Quote {
  pairId: string;
  dex: DexId;
  price: number | null;
  amountOut: string | null;
}

export interface QuoteSnapshot {
  blockNumber: string;
  gasPriceGwei: number;
  timestamp: number;
  privateRpc: boolean;
  quotes: Quote[];
}

export async function fetchQuotes(): Promise<QuoteSnapshot> {
  const pc = client();
  type MulticallContract = {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  };
  const calls: {
    pairId: string;
    dex: DexId;
    decimalsOut: number;
    size: number;
    contract: MulticallContract;
  }[] = [];


  for (const pair of PAIRS) {
    const base = TOKENS[pair.base];
    const quote = TOKENS[pair.quote];
    const amountIn = parseUnits(String(pair.size), base.decimals);
    for (const dex of DEX_LIST) {
      if (dex.kind === "v2") {
        calls.push({
          pairId: pair.id,
          dex: dex.id,
          decimalsOut: quote.decimals,
          size: pair.size,
          contract: {
            address: dex.quoter,
            abi: V2_ABI,
            functionName: "getAmountsOut",
            args: [amountIn, [base.address, quote.address]],
          },
        });
      } else {
        // Probe every fee tier; the deepest pool wins.
        for (const fee of [100, 500, 2500, 10000]) {
          calls.push({
            pairId: pair.id,
            dex: dex.id,
            decimalsOut: quote.decimals,
            size: pair.size,
            contract: {
              address: dex.quoter,
              abi: V3_QUOTER_ABI,
              functionName: "quoteExactInputSingle",
              args: [
                {
                  tokenIn: base.address,
                  tokenOut: quote.address,
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
  }

  const [results, blockNumber, gasPrice] = await Promise.all([
    pc.multicall({
      contracts: calls.map((c) => c.contract) as never,
      allowFailure: true,
    }),

    pc.getBlockNumber(),
    pc.getGasPrice(),
  ]);

  const quotes: Quote[] = results.map((res, i) => {
    const meta = calls[i]!;
    if (res.status !== "success" || res.result == null) {
      return { pairId: meta.pairId, dex: meta.dex, price: null, amountOut: null };
    }
    let raw: bigint | null = null;
    const value = res.result as unknown;
    if (Array.isArray(value)) {
      const arr = value as unknown[];
      const last = arr[arr.length - 1];
      raw = typeof arr[0] === "bigint" && arr.length === 4 ? (arr[0] as bigint) : (last as bigint);
    }
    if (raw == null || raw === 0n) {
      return { pairId: meta.pairId, dex: meta.dex, price: null, amountOut: null };
    }
    const out = Number(formatUnits(raw, meta.decimalsOut));
    return {
      pairId: meta.pairId,
      dex: meta.dex,
      price: out / meta.size,
      amountOut: out.toString(),
    };
  });

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
    PAIRS.map(async (pair) => {
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
