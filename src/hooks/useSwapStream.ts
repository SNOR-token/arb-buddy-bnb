import { useEffect, useRef, useState } from "react";
import { decodeEventLog, formatUnits, keccak256, toHex } from "viem";
import { PAIRS, TOKENS } from "@/lib/chain";

export const SWAP_TOPIC = keccak256(
  toHex("Swap(address,uint256,uint256,uint256,uint256,address)"),
);

const SWAP_ABI = [
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

export interface StreamSwap {
  id: string;
  pairId: string;
  side: "buy" | "sell";
  baseAmount: number;
  quoteAmount: number;
  txHash: string;
  ts: number;
}

export type StreamStatus = "idle" | "connecting" | "live" | "error";

const WSS_KEY = "bnb-arb-wss-url";

export function readWssUrl() {
  try {
    return localStorage.getItem(WSS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveWssUrl(url: string) {
  try {
    if (url) localStorage.setItem(WSS_KEY, url);
    else localStorage.removeItem(WSS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Subscribes to PancakeSwap V2 pool Swap events over a websocket RPC.
 * Pass a wss:// endpoint (e.g. your QuickNode BSC websocket URL).
 */
export function useSwapStream(wssUrl: string, enabled: boolean) {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [swaps, setSwaps] = useState<StreamSwap[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!enabled || !wssUrl || !wssUrl.startsWith("wss://")) {
      setStatus("idle");
      socketRef.current?.close();
      socketRef.current = null;
      return;
    }

    setStatus("connecting");
    let closed = false;
    const ws = new WebSocket(wssUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      setStatus("live");
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_subscribe",
          params: [
            "logs",
            { address: PAIRS.map((p) => p.watchPool), topics: [SWAP_TOPIC] },
          ],
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as {
          method?: string;
          params?: { result?: { address: string; data: `0x${string}`; topics: [`0x${string}`, ...`0x${string}`[]]; transactionHash: string; logIndex: string } };
        };
        const log = msg.params?.result;
        if (msg.method !== "eth_subscription" || !log) return;
        const pair = PAIRS.find((p) => p.watchPool.toLowerCase() === log.address.toLowerCase());
        if (!pair) return;

        const decoded = decodeEventLog({ abi: SWAP_ABI, data: log.data, topics: log.topics });
        const a = decoded.args as unknown as {
          amount0In: bigint;
          amount1In: bigint;
          amount0Out: bigint;
          amount1Out: bigint;
        };
        const base = TOKENS[pair.base];
        const quote = TOKENS[pair.quote];
        const baseIsToken0 = base.address.toLowerCase() < quote.address.toLowerCase();
        const baseIn = baseIsToken0 ? a.amount0In : a.amount1In;
        const baseOut = baseIsToken0 ? a.amount0Out : a.amount1Out;
        const quoteIn = baseIsToken0 ? a.amount1In : a.amount0In;
        const quoteOut = baseIsToken0 ? a.amount1Out : a.amount0Out;

        const entry: StreamSwap = {
          id: `${log.transactionHash}-${log.logIndex}`,
          pairId: pair.id,
          side: baseOut > 0n ? "buy" : "sell",
          baseAmount: Number(formatUnits(baseIn > 0n ? baseIn : baseOut, base.decimals)),
          quoteAmount: Number(formatUnits(quoteIn > 0n ? quoteIn : quoteOut, quote.decimals)),
          txHash: log.transactionHash,
          ts: Date.now(),
        };
        setSwaps((prev) => [entry, ...prev].slice(0, 60));
      } catch {
        /* malformed frame, ignore */
      }
    };

    ws.onerror = () => {
      if (!closed) setStatus("error");
    };
    ws.onclose = () => {
      if (!closed) setStatus("error");
    };

    return () => {
      closed = true;
      ws.close();
      socketRef.current = null;
    };
  }, [wssUrl, enabled]);

  return { status, swaps };
}
