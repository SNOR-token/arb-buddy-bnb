import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Fuel, Blocks, TriangleAlert } from "lucide-react";

import { getQuotes } from "@/lib/arb.functions";
import { computeOpportunities, fmt, sanitizeQuotes, type Opportunity } from "@/lib/arb-math";
import { executeFlashArb, isAddress } from "@/lib/execute";
import { useWallet } from "@/hooks/useWallet";
import { useTrades } from "@/hooks/useTrades";
import { WalletButton } from "@/components/WalletButton";
import { PriceMatrix } from "@/components/PriceMatrix";
import { OpportunityBoard } from "@/components/OpportunityBoard";
import { SwapFeedPanel } from "@/components/SwapFeedPanel";
import { PnlPanel } from "@/components/PnlPanel";
import { BotConfig, type BotSettings } from "@/components/BotConfig";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BNB Arb Terminal — Live DEX Arbitrage & Aave Flashloans" },
      {
        name: "description",
        content:
          "Live BNB Chain arbitrage terminal: real-time PancakeSwap, Uniswap V3 and SushiSwap quotes, whale swap streaming, Aave V3 flashloan execution and live P&L.",
      },
      { property: "og:title", content: "BNB Arb Terminal — Live DEX Arbitrage" },
      {
        property: "og:description",
        content:
          "Spot cross-DEX price dislocations on BNB Chain and fire Aave V3 flashloan arbitrage in one atomic transaction.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const DEFAULTS: BotSettings = {
  contract: "",
  loanAmount: 5000,
  minProfit: 1,
  autoMode: false,
  minSizePct: 25,
};

function Dashboard() {
  const [settings, setSettings] = useState<BotSettings>(DEFAULTS);
  const [executing, setExecuting] = useState<string | null>(null);
  const { address, onBsc } = useWallet();
  const { trades, addTrade, clear, realized, winRate } = useTrades();
  const lastAuto = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("bnb-arb-settings");
      if (raw) setSettings({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<BotSettings>) });
    } catch {
      /* ignore */
    }
  }, []);

  const update = (next: Partial<BotSettings>) =>
    setSettings((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem("bnb-arb-settings", JSON.stringify(merged));
      } catch {
        /* ignore */
      }
      return merged;
    });

  const snapshot = useQuery({
    queryKey: ["quotes"],
    queryFn: () => getQuotes(),
    refetchInterval: 6_000,
  });

  const quotes = useMemo(
    () => sanitizeQuotes(snapshot.data?.quotes ?? []),
    [snapshot.data?.quotes],
  );
  const opportunities = useMemo(
    () => computeOpportunities(quotes, snapshot.data?.gasPriceGwei ?? 1),
    [quotes, snapshot.data?.gasPriceGwei],
  );

  const runArb = async (op: Opportunity, mode: "auto" | "manual") => {
    const quoteSymbol = op.pair.quote;
    if (!isAddress(settings.contract) || !address || !onBsc) {
      addTrade({
        pairId: op.pairId,
        buyDex: op.buyDex,
        sellDex: op.sellDex,
        notional: op.notional,
        netProfit: op.netProfit,
        mode: "sim",
        quoteSymbol,
      });
      if (mode === "manual") {
        toast.info("Simulated fill logged", {
          description: !address
            ? "Connect a wallet and set your FlashArb contract to trade live."
            : "Set a valid FlashArb contract address to trade live.",
        });
      }
      return;
    }

    setExecuting(op.pairId);
    try {
      const txHash = await executeFlashArb({
        provider: window.ethereum!,
        from: address,
        contract: settings.contract as `0x${string}`,
        opportunity: op,
        loanAmount: settings.loanAmount,
        minProfit: settings.minProfit,
      });
      addTrade({
        pairId: op.pairId,
        buyDex: op.buyDex,
        sellDex: op.sellDex,
        notional: settings.loanAmount,
        netProfit: op.netProfit,
        mode: "live",
        txHash,
        quoteSymbol,
      });
      toast.success("Flashloan arb submitted", { description: txHash.slice(0, 18) + "…" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction rejected";
      toast.error("Arb failed", { description: message.slice(0, 140) });
    } finally {
      setExecuting(null);
    }
  };

  // Auto-fire: whenever the top opportunity clears the profit floor.
  useEffect(() => {
    if (!settings.autoMode) return;
    const best = opportunities[0];
    if (!best || best.netProfit < settings.minProfit) return;
    if (Date.now() - lastAuto.current < 20_000) return;
    lastAuto.current = Date.now();
    void runArb(best, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunities, settings.autoMode, settings.minProfit]);

  const block = snapshot.data?.blockNumber ?? "0";
  const gas = snapshot.data?.gasPriceGwei ?? 0;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-5 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight sm:text-xl">
            BNB Arb Terminal
          </h1>
          <p className="text-[11px] text-muted-foreground">
            BNB Chain mainnet · PancakeSwap V2 · Uniswap V3 · SushiSwap · Aave V3 flashloans
          </p>
        </div>
        <WalletButton />
      </header>

      <div className="tabular mt-4 flex flex-wrap gap-2 text-[11px]">
        <Chip icon={<Blocks className="size-3" />} label={`block ${block}`} />
        <Chip icon={<Fuel className="size-3" />} label={`${gas.toFixed(2)} gwei`} />
        <Chip
          icon={<Activity className="size-3 live-dot text-success" />}
          label={snapshot.isFetching ? "refreshing" : "6s refresh"}
        />
        {!snapshot.data?.privateRpc && (
          <Chip
            icon={<TriangleAlert className="size-3 text-warning" />}
            label="public RPC — add QuickNode for speed"
          />
        )}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PriceMatrix quotes={quotes} loading={snapshot.isLoading} />
          <OpportunityBoard
            opportunities={opportunities}
            minNetProfit={settings.minProfit}
            onExecute={(op) => void runArb(op, "manual")}
            executing={executing}
          />
          <SwapFeedPanel minSizePct={settings.minSizePct} />
        </div>

        <div className="space-y-4">
          <BotConfig settings={settings} onChange={update} />
          <PnlPanel trades={trades} realized={realized} winRate={winRate} onClear={clear} />
        </div>
      </div>

      <footer className="mt-8 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-[11px] leading-relaxed text-foreground">
        <strong>Risk notice.</strong> Quotes are indicative and move every block; net profit
        estimates assume {fmt(0.9, 1)}M gas units and ignore MEV competition and sandwich risk.
        Flashloan arbitrage on mainnet can lose gas on every reverted attempt. Deploy, audit and
        fund the executor contract yourself —{" "}
        <Link to="/contract" className="text-primary hover:underline">
          see the contract
        </Link>
        .
      </footer>
    </main>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}
