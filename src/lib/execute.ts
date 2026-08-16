import { encodeFunctionData, parseUnits } from "viem";
import { FLASH_ARB_ABI, TOKENS, type Pair } from "./chain";
import { routerFor } from "./arb-math";
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
}

/**
 * Sends FlashArb.executeArb: borrow the quote token, buy the base token on the
 * cheap venue, sell it on the rich venue, repay the loan in one transaction.
 */
export async function executeFlashArb({
  provider,
  from,
  contract,
  opportunity,
  loanAmount,
  minProfit,
}: ExecuteArgs) {
  const pair: Pair = opportunity.pair;
  const asset = TOKENS[pair.quote];
  const intermediate = TOKENS[pair.base];

  const data = encodeFunctionData({
    abi: FLASH_ARB_ABI,
    functionName: "executeArb",
    args: [
      asset.address,
      parseUnits(loanAmount.toString(), asset.decimals),
      intermediate.address,
      routerFor(opportunity.buyDex),
      routerFor(opportunity.sellDex),
      parseUnits(minProfit.toString(), asset.decimals),
    ],
  });

  const txHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: contract, data }],
  })) as string;

  return txHash;
}

export function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
