import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";

import { createResponsesProvider, withLovableAiGatewayRunIdHeader } from "@/lib/ai-gateway.server";
import { authorizeChatRequest } from "@/lib/chat-auth.server";
import { fetchQuotes, fetchLargeSwaps } from "@/lib/arb.server";
import { computeOpportunities, sanitizeQuotes } from "@/lib/arb-math";
import { PAIRS, TOKENS, DEX_LIST } from "@/lib/chain";

const SYSTEM_PROMPT = `You are the live trading co-pilot inside "BNB Arb Terminal", a BNB Chain (BSC mainnet) cross-DEX arbitrage bot that borrows via Aave V3 flash loans.

What you can do:
- Read live market state with your tools (quotes from PancakeSwap V2, Uniswap V3, SushiSwap V2, Biswap V2 and ApeSwap V2; computed arbitrage opportunities net of the 0.05% Aave premium, DEX fees and gas; recent large "whale" swaps).
- Adjust the bot's live settings with update_bot_settings (loan size, minimum net profit floor, whale-swap threshold, auto-fire on/off).
- Explain the strategy, the risks, and which pairs and venues currently look interesting.

Rules:
- Always call your tools for market facts. Never guess prices, spreads or profits.
- Be concise and quantitative. Use the quote token symbol with numbers.
- Before enabling auto-fire, warn that every reverted attempt still costs gas and that MEV bots compete for the same spreads.
- You cannot deploy contracts, move funds or sign transactions. The user does that from their wallet.
- Keep answers under about 180 words unless the user asks for depth.`;

async function marketSnapshot() {
  const snapshot = await fetchQuotes();
  const quotes = sanitizeQuotes(snapshot.quotes);
  const opportunities = computeOpportunities(quotes, snapshot.gasPriceGwei);
  return {
    blockNumber: snapshot.blockNumber,
    gasPriceGwei: Number(snapshot.gasPriceGwei.toFixed(3)),
    quotes: quotes
      .filter((q) => q.price)
      .map((q) => ({ pair: q.pairId, dex: q.dex, price: q.price })),
    opportunities: opportunities.slice(0, 8).map((o) => ({
      pair: o.pairId,
      buyDex: o.buyDex,
      sellDex: o.sellDex,
      spreadPct: Number(o.spreadPct.toFixed(4)),
      notional: Number(o.notional.toFixed(2)),
      netProfit: Number(o.netProfit.toFixed(4)),
      quoteToken: o.pair.quote,
    })),
  };
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await authorizeChatRequest(request);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as { messages?: UIMessage[]; threadId?: string };
        const messages = body.messages;
        const threadId = body.threadId;
        if (!Array.isArray(messages) || !threadId) {
          return new Response("messages and threadId are required", { status: 400 });
        }

        const { supabase, userId } = session;
        const { data: thread, error: threadError } = await supabase
          .from("agent_threads")
          .select("id")
          .eq("id", threadId)
          .maybeSingle();
        if (threadError || !thread) return new Response("Thread not found", { status: 404 });

        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          const { error } = await supabase.from("agent_messages").insert({
            thread_id: threadId,
            user_id: userId,
            client_id: last.id,
            role: "user",
            parts: last.parts as unknown as never,
          });
          if (error) console.error("[agent] failed to save user message", error);
        }

        let provider;
        let runIdFetch;
        try {
          ({ provider, runIdFetch } = createResponsesProvider(request));
        } catch (error) {
          console.error("[agent]", error);
          return new Response("AI is not configured", { status: 500 });
        }

        const result = streamText({
          model: provider.responses("openai/gpt-5.6-sol"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          abortSignal: request.signal,
          stopWhen: stepCountIs(50),
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
          tools: {
            get_market_snapshot: tool({
              description:
                "Live DEX quotes for every tracked pair plus the ranked arbitrage opportunities, net of the Aave flash-loan premium, DEX fees and gas.",
              inputSchema: z.object({}),
              execute: async () => marketSnapshot(),
            }),
            get_whale_swaps: tool({
              description:
                "Recent large swaps on the watched PancakeSwap V2 pools. Use it to spot the price dislocations worth front-running on another venue.",
              inputSchema: z.object({
                lookbackBlocks: z.number().nullable(),
                minQuoteSize: z.number().nullable(),
              }),
              execute: async ({ lookbackBlocks, minQuoteSize }) => {
                const feed = await fetchLargeSwaps(
                  Math.min(Math.max(lookbackBlocks ?? 300, 1), 900),
                  Math.max(minQuoteSize ?? 100, 1),
                );
                return { head: feed.head, swaps: feed.swaps.slice(0, 15) };
              },
            }),
            list_universe: tool({
              description: "The tokens, pairs and DEX venues the bot currently tracks.",
              inputSchema: z.object({}),
              execute: async () => ({
                tokens: Object.values(TOKENS).map((t) => t.symbol),
                pairs: PAIRS.map((p) => ({ id: p.id, size: p.size, watched: p.watch })),
                venues: DEX_LIST.map((d) => ({ id: d.id, label: d.label, kind: d.kind })),
              }),
            }),
            update_bot_settings: tool({
              description:
                "Change the live bot configuration. Only include the fields you want to change. The terminal applies the change immediately.",
              inputSchema: z.object({
                loanAmount: z.number().nullable(),
                minProfit: z.number().nullable(),
                minSizePct: z.number().nullable(),
                autoMode: z.boolean().nullable(),
                reason: z.string(),
              }),
              execute: async ({ loanAmount, minProfit, minSizePct, autoMode, reason }) => {
                const patch: Record<string, number | boolean> = {};
                if (loanAmount != null) patch['loanAmount'] = Math.max(1, loanAmount);
                // Min profit is hardcoded to 0 for now; ignore agent attempts to raise it.
                if (minProfit != null) patch['minProfit'] = 0;
                if (minSizePct != null) patch['minSizePct'] = Math.min(Math.max(minSizePct, 5), 1000);
                if (autoMode != null) patch['autoMode'] = autoMode;
                return { applied: patch, reason };
              },
            }),
          },
          onError: ({ error }) => console.error("[agent] stream error", error),
        });

        const response = result.toUIMessageStreamResponse({
          originalMessages: messages,
          sendReasoning: true,
          onFinish: async ({ responseMessage }) => {
            if (!responseMessage) return;
            const { error } = await supabase.from("agent_messages").insert({
              thread_id: threadId,
              user_id: userId,
              client_id: responseMessage.id,
              role: responseMessage.role,
              parts: responseMessage.parts as unknown as never,
            });
            if (error) console.error("[agent] failed to save assistant message", error);
            await supabase
              .from("agent_threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);
          },
        });

        return withLovableAiGatewayRunIdHeader(response, runIdFetch);
      },
    },
  },
});
