import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchQuotes, fetchLargeSwaps } from "./arb.server";

export const getQuotes = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await fetchQuotes();
  } catch (error) {
    console.error("[arb] quote fetch failed", error);
    return {
      blockNumber: "0",
      gasPriceGwei: 0,
      timestamp: Date.now(),
      privateRpc: false,
      quotes: [],
      error: "RPC unavailable",
    };
  }
});

export const getLargeSwaps = createServerFn({ method: "POST" })
  .inputValidator((input: { lookbackBlocks?: number; minSizePct?: number }) =>
    z
      .object({
        lookbackBlocks: z.number().min(1).max(900).default(300),
        minSizePct: z.number().min(1).max(10000).default(100),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      return await fetchLargeSwaps(data.lookbackBlocks, data.minSizePct);
    } catch (error) {
      console.error("[arb] swap feed failed", error);
      return { head: "0", swaps: [], error: "RPC unavailable" };
    }
  });
