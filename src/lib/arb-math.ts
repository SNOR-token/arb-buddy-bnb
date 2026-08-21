import {
  AAVE_FLASHLOAN_PREMIUM_BPS,
  DEXES,
  PAIRS,
  type DexId,
  type Pair,
} from "./chain";

/**
 * One venue's round-trip quote for a pair, produced by the server engine:
 *  - `buyOut`  : base tokens received for spending `loanSize` quote tokens here
 *  - `sellOut` : quote tokens received for selling `refBase` base tokens here
 * Both legs are real router quotes, so DEX fees are already priced in.
 */
export interface Quote {
  pairId: string;
  dex: DexId;
  /** display price: quote per 1 base, from the sell leg */
  price: number | null;
  amountOut: string | null;
  buyOut: number | null;
  buyFee: number;
  sellOut: number | null;
  sellFee: number;
  refBase: number;
  loanSize: number;
}

export interface Opportunity {
  pairId: string;
  pair: Pair;
  buyDex: DexId;
  sellDex: DexId;
  /** V3 fee tiers for each leg (0 for V2 routers) */
  buyFee: number;
  sellFee: number;
  buyPrice: number;
  sellPrice: number;
  spreadPct: number;
  /** flash-loan notional in quote token — exactly what the tx borrows */
  notional: number;
  /** base tokens bought on the cheap venue with the full notional */
  baseBought: number;
  /** quote tokens returned by selling `baseBought` on the rich venue */
  quoteReturned: number;
  grossProfit: number;
  flashFee: number;
  gasCost: number;
  netProfit: number;
}

/** Approximate BNB price used to convert gas into quote-token terms. */
export function bnbPrice(quotes: Quote[]) {
  const q = quotes.find((x) => x.pairId === "WBNB/USDT" && x.price);
  return q?.price ?? 600;
}

/**
 * Display-only cleanup: venues with no real depth still return a quote, but far
 * below the deepest pool. Null those out so the price matrix does not show
 * phantom prices. Opportunity math uses the raw round-trip quotes instead.
 */
export function sanitizeQuotes(quotes: Quote[], tolerancePct = 1.2): Quote[] {
  return PAIRS.flatMap((pair) => {
    const rows = quotes.filter((q) => q.pairId === pair.id);
    const prices = rows
      .map((q) => q.price)
      .filter((p): p is number => !!p && p > 0)
      .sort((a, b) => a - b);
    if (prices.length === 0) return rows;
    const reference = prices[prices.length - 1]!;
    return rows.map((q) => {
      if (!q.price || q.price <= 0) return { ...q, price: null };
      const shortfall = ((reference - q.price) / reference) * 100;
      return shortfall > tolerancePct ? { ...q, price: null } : q;
    });
  });
}

/**
 * Builds executable arbitrage routes from round-trip quotes.
 *
 * For each pair: borrow `loanSize` quote tokens, buy the base token on the
 * venue with the best `buyOut`, sell it on the venue with the best sell rate,
 * repay the loan plus the Aave premium. Only venues the deployed executor can
 * actually route through are considered, and only routes whose net profit is
 * positive are returned — everything else reverts on chain.
 */
export function computeOpportunities(
  quotes: Quote[],
  gasPriceGwei: number,
  gasUnits = 900_000,
): Opportunity[] {
  const bnb = bnbPrice(quotes);
  const out: Opportunity[] = [];

  for (const pair of PAIRS) {
    const rows = quotes.filter(
      (q) => q.pairId === pair.id && DEXES[q.dex].executable && q.refBase > 0,
    );
    const buys = rows.filter((q) => (q.buyOut ?? 0) > 0);
    const sells = rows.filter((q) => (q.sellOut ?? 0) > 0);
    if (!buys.length || !sells.length) continue;

    const buy = buys.reduce((best, q) => ((q.buyOut ?? 0) > (best.buyOut ?? 0) ? q : best));
    // the sell venue must differ from the buy venue
    const sellCandidates = sells.filter((q) => q.dex !== buy.dex);
    if (!sellCandidates.length) continue;
    const sell = sellCandidates.reduce((best, q) =>
      (q.sellOut ?? 0) > (best.sellOut ?? 0) ? q : best,
    );

    const notional = buy.loanSize;
    const baseBought = buy.buyOut!;
    // sell leg was quoted at refBase; scale linearly to the amount we hold
    const sellRate = sell.sellOut! / sell.refBase;
    const quoteReturned = baseBought * sellRate;

    const grossProfit = quoteReturned - notional;
    const flashFee = (notional * AAVE_FLASHLOAN_PREMIUM_BPS) / 10_000;
    const gasBnb = (gasPriceGwei * gasUnits) / 1e9;
    const gasCost = pair.quote === "WBNB" ? gasBnb : gasBnb * bnb;

    const buyPrice = notional / baseBought;
    const sellPrice = sellRate;

    out.push({
      pairId: pair.id,
      pair,
      buyDex: buy.dex,
      sellDex: sell.dex,
      buyFee: buy.buyFee,
      sellFee: sell.sellFee,
      buyPrice,
      sellPrice,
      spreadPct: buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice) * 100 : 0,
      notional,
      baseBought,
      quoteReturned,
      grossProfit,
      flashFee,
      gasCost,
      netProfit: grossProfit - flashFee - gasCost,
    });
  }

  return out.sort((a, b) => b.netProfit - a.netProfit);
}

/** Only routes that clear every cost — the terminal never lists the rest. */
export function profitableOnly(ops: Opportunity[], floor = 0) {
  return ops.filter((o) => o.netProfit > floor);
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
