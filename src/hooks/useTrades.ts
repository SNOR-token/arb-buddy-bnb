import { useCallback, useEffect, useState } from "react";

export interface Trade {
  id: string;
  ts: number;
  pairId: string;
  buyDex: string;
  sellDex: string;
  notional: number;
  netProfit: number;
  mode: "sim" | "live";
  txHash?: string;
  quoteSymbol: string;
}

const KEY = "bnb-arb-trades-v1";

function read(): Trade[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Trade[]) : [];
  } catch {
    return [];
  }
}

export function useTrades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTrades(read());
    setHydrated(true);
  }, []);

  const persist = useCallback((next: Trade[]) => {
    setTrades(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next.slice(0, 400)));
    } catch {
      /* storage full or unavailable */
    }
  }, []);

  const addTrade = useCallback(
    (trade: Omit<Trade, "id" | "ts">) => {
      const entry: Trade = { ...trade, id: crypto.randomUUID(), ts: Date.now() };
      persist([entry, ...read()]);
      return entry;
    },
    [persist],
  );

  const clear = useCallback(() => persist([]), [persist]);

  const realized = trades.reduce((sum, t) => sum + t.netProfit, 0);
  const wins = trades.filter((t) => t.netProfit > 0).length;

  return {
    trades,
    addTrade,
    clear,
    hydrated,
    realized,
    wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
  };
}
