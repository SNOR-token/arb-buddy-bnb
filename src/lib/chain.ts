// Client-safe BSC mainnet constants shared by UI and server functions.
import { getCreate2Address, keccak256, encodePacked } from "viem";

export const BSC_CHAIN_ID = 56;
export const BSC_CHAIN_ID_HEX = "0x38";

export type TokenSymbol =
  | "WBNB"
  | "USDT"
  | "USDC"
  | "BUSD"
  | "CAKE"
  | "ETH"
  | "BTCB"
  | "XRP"
  | "ADA"
  | "DOT"
  | "LINK"
  | "LTC"
  | "DOGE"
  | "UNI"
  | "AAVE"
  | "XVS"
  | "TWT";

export interface Token {
  symbol: TokenSymbol;
  address: `0x${string}`;
  decimals: number;
}

export const TOKENS: Record<TokenSymbol, Token> = {
  WBNB: { symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  USDT: { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  USDC: { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  BUSD: { symbol: "BUSD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
  CAKE: { symbol: "CAKE", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
  ETH: { symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
  BTCB: { symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
  XRP: { symbol: "XRP", address: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", decimals: 18 },
  ADA: { symbol: "ADA", address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", decimals: 18 },
  DOT: { symbol: "DOT", address: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402", decimals: 18 },
  LINK: { symbol: "LINK", address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", decimals: 18 },
  LTC: { symbol: "LTC", address: "0x4338665CBB7B2485A8855A139b75D5e34AB0DB94", decimals: 18 },
  DOGE: { symbol: "DOGE", address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", decimals: 8 },
  UNI: { symbol: "UNI", address: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1", decimals: 18 },
  AAVE: { symbol: "AAVE", address: "0xfb6115445Bff7b52FeB98650C87f44907E58f802", decimals: 18 },
  XVS: { symbol: "XVS", address: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", decimals: 18 },
  TWT: { symbol: "TWT", address: "0x4B0F1812e5Df2A09796481Ff14017e6005508003", decimals: 18 },
};


export type DexId = "pancake" | "uniswap" | "sushi";

export interface Dex {
  id: DexId;
  label: string;
  kind: "v2" | "v3";
  /** V2 router or V3 quoter */
  quoter: `0x${string}`;
  /** Router used for swap execution */
  router: `0x${string}`;
  /** V3 fee tier used for quoting */
  fee?: number;
}

export const DEXES: Record<DexId, Dex> = {
  pancake: {
    id: "pancake",
    label: "PancakeSwap V2",
    kind: "v2",
    quoter: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  },
  uniswap: {
    id: "uniswap",
    label: "Uniswap V3",
    kind: "v3",
    quoter: "0x78D78E420Da98ad378D7799bE8f4AF69033EB077",
    router: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
    fee: 500,
  },
  sushi: {
    id: "sushi",
    label: "SushiSwap V2",
    kind: "v2",
    quoter: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
    router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
  },
};

export const DEX_LIST = Object.values(DEXES);

export interface Pair {
  id: string;
  base: TokenSymbol;
  quote: TokenSymbol;
  /** trade size in base units used for quoting */
  size: number;
  /** PancakeSwap V2 pool watched over websocket for large swaps */
  watchPool: `0x${string}`;
  /** include in the whale-swap watch list (kept small to stay under RPC limits) */
  watch: boolean;
}

/** PancakeSwap V2 factory + init code hash, for deterministic pool addresses. */
const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73" as const;
const PANCAKE_V2_INIT_CODE_HASH =
  "0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd3" as const;

export function pancakeV2Pool(a: TokenSymbol, b: TokenSymbol): `0x${string}` {
  const x = TOKENS[a].address.toLowerCase() as `0x${string}`;
  const y = TOKENS[b].address.toLowerCase() as `0x${string}`;
  const [token0, token1] = x < y ? [x, y] : [y, x];
  return getCreate2Address({
    from: PANCAKE_V2_FACTORY,
    bytecodeHash: PANCAKE_V2_INIT_CODE_HASH,
    salt: keccak256(encodePacked(["address", "address"], [token0!, token1!])),
  });
}

function pair(
  base: TokenSymbol,
  quote: TokenSymbol,
  size: number,
  watch = false,
): Pair {
  return {
    id: `${base}/${quote}`,
    base,
    quote,
    size,
    watchPool: pancakeV2Pool(base, quote),
    watch,
  };
}

export const PAIRS: Pair[] = [
  pair("WBNB", "USDT", 5, true),
  pair("CAKE", "WBNB", 500, true),
  pair("ETH", "WBNB", 2, true),
  pair("BTCB", "WBNB", 0.2, true),
  pair("USDC", "USDT", 5000, true),
  pair("XRP", "WBNB", 2000, true),
  pair("ADA", "WBNB", 3000, true),
  pair("DOT", "WBNB", 300, true),
  pair("LINK", "WBNB", 150, true),
  pair("LTC", "WBNB", 20, false),
  pair("DOGE", "WBNB", 20000, false),
  pair("UNI", "WBNB", 200, false),
  pair("AAVE", "WBNB", 15, false),
  pair("XVS", "WBNB", 300, false),
  pair("TWT", "WBNB", 2000, false),
];

export const WATCHED_PAIRS = PAIRS.filter((p) => p.watch);


/** Aave V3 on BNB Chain */
export const AAVE_V3_POOL = "0x6807dc923806fE8Fd134338EABCA509979a7e0cB" as const;
export const AAVE_FLASHLOAN_PREMIUM_BPS = 5; // 0.05%

export const FLASH_ARB_ABI = [
  {
    type: "function",
    name: "executeArb",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "intermediate", type: "address" },
      { name: "buyRouter", type: "address" },
      { name: "sellRouter", type: "address" },
      { name: "minProfit", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export function dexLabel(id: DexId) {
  return DEXES[id].label;
}
