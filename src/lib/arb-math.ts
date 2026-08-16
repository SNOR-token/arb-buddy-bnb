import {
  AAVE_FLASHLOAN_PREMIUM_BPS,
  DEXES,
  PAIRS,
  type DexId,
  type Pair,
} from "./chain";

export interface Quote {
  pairId: string;
  dex: DexId;
  price: number | null;
  amountOut: string | null;
}

export interface Opportunity {
  pairId: string;
  pair: Pair;
  buyDex: DexId;
  sellDex: DexId;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  /** notional of the flashloan leg, in quote token */
  notional: number;
  grossProfit: number;
  flashFee: number;
  dexFees: number;
  gasCost: number;
  netProfit: number;
}

/** Approximate BNB price used to convert gas into quote-token terms. */
export function bnbPrice(quotes: Quote[]) {
  const q = quotes.find((x) => x.pairId === "WBNB/USDT" && x.price);
  return q?.price ?? 600;
}

/**
 * Venues with no real depth for a pair still return a quote, but at an absurd
 * price. Drop any venue more than `tolerancePct` away from the pair median so
 * illiquid pools never masquerade as an arbitrage.
 */
export function sanitizeQuotes(quotes: Quote[], tolerancePct = 4): Quote[] {
  return PAIRS.flatMap((pair) => {
    const rows = quotes.filter((q) => q.pairId === pair.id);
    const prices = rows
      .map((q) => q.price)
      .filter((p): p is number => !!p && p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return rows;
    const median = prices[Math.floor(prices.length / 2)]!;
    return rows.map((q) => {
      if (!q.price || q.price <= 0) return { ...q, price: null };
      const deviation = Math.abs(q.price - median) / median;
      return deviation * 100 > tolerancePct ? { ...q, price: null, amountOut: null } : q;
    });
  });
}

const DEX_FEE_BPS: Record<DexId, number> = { pancake: 25, uniswap: 5, sushi: 30 };

export function computeOpportunities(
  quotes: Quote[],
  gasPriceGwei: number,
  gasUnits = 900_000,
): Opportunity[] {
  const bnb = bnbPrice(quotes);
  const out: Opportunity[] = [];

  for (const pair of PAIRS) {
    const valid = quotes.filter((q) => q.pairId === pair.id && q.price && q.price > 0);
    if (valid.length < 2) continue;

    const sorted = [...valid].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
    const cheapest = sorted[0]!;
    const richest = sorted[sorted.length - 1]!;
    const buyPrice = cheapest.price!;
    const sellPrice = richest.price!;
    if (buyPrice <= 0) continue;

    const spreadPct = ((sellPrice - buyPrice) / buyPrice) * 100;
    const notional = pair.size * buyPrice; // quote-token notional of one loop
    const grossProfit = (sellPrice - buyPrice) * pair.size;
    const flashFee = (notional * AAVE_FLASHLOAN_PREMIUM_BPS) / 10_000;
    const dexFees =
      (notional * (DEX_FEE_BPS[cheapest.dex] + DEX_FEE_BPS[richest.dex])) / 10_000;

    // gas in BNB -> quote token. Pairs quoted in WBNB already price in BNB.
    const gasBnb = (gasPriceGwei * gasUnits) / 1e9;
    const gasCost = pair.quote === "WBNB" ? gasBnb : gasBnb * bnb;

    out.push({
      pairId: pair.id,
      pair,
      buyDex: cheapest.dex,
      sellDex: richest.dex,
      buyPrice,
      sellPrice,
      spreadPct,
      notional,
      grossProfit,
      flashFee,
      dexFees,
      gasCost,
      netProfit: grossProfit - flashFee - dexFees - gasCost,
    });
  }

  return out.sort((a, b) => b.netProfit - a.netProfit);
}

export function routerFor(dex: DexId) {
  return DEXES[dex].router;
}

export function fmt(n: number | null | undefined, digits = 4) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return n.toFixed(digits);
}

export function fmtUsd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
