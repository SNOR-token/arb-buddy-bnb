import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Copy } from "lucide-react";
import { AAVE_V3_POOL, DEXES, TOKENS } from "@/lib/chain";
import { FLASH_ARB_SOURCE } from "@/lib/flash-arb-source";

export const Route = createFileRoute("/contract")({
  head: () => ({
    meta: [
      { title: "FlashArb Contract — Aave V3 Flashloan Arbitrage on BNB Chain" },
      {
        name: "description",
        content:
          "Solidity source, constructor arguments and deploy steps for the FlashArb Aave V3 flashloan arbitrage executor on BNB Chain mainnet.",
      },
      { property: "og:title", content: "FlashArb Contract — Aave V3 Flashloan Arbitrage" },
      {
        property: "og:description",
        content:
          "Copy the FlashArb Solidity source, deploy it to BNB Chain with Remix and wire it into the arbitrage terminal.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContractPage,
});

function ContractPage() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(FLASH_ARB_SOURCE);
    setCopied(true);
    toast.success("Solidity source copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-5 sm:px-6">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to terminal
      </Link>

      <h1 className="mt-4 text-lg font-bold tracking-tight sm:text-xl">
        FlashArb executor contract
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Borrows from Aave V3 on BNB Chain, buys on the cheap venue, sells on the rich venue and
        repays in a single atomic transaction. It reverts unless your minimum profit is met, so a
        failed attempt costs gas only.
      </p>

      <section className="panel mt-5 p-4">
        <h2 className="text-sm font-semibold">Deploy steps</h2>
        <ol className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          <li>1. Copy the source below into Remix (Solidity 0.8.20+, optimizer on).</li>
          <li>
            2. Deploy to BNB Chain mainnet with constructor argument{" "}
            <code className="tabular text-primary">{AAVE_V3_POOL}</code> (Aave V3 Pool).
          </li>
          <li>
            3. Paste the deployed address into <strong>Bot configuration</strong> on the terminal.
          </li>
          <li>
            4. Keep a little BNB in your wallet for gas. No capital sits in the contract — profits
            accrue there and you sweep them with <code className="text-primary">withdraw(token)</code>.
          </li>
          <li>5. Audit the code before sending real value through it.</li>
        </ol>
      </section>

      <section className="panel mt-4 p-4">
        <h2 className="text-sm font-semibold">Wired addresses</h2>
        <div className="tabular mt-2 space-y-1 text-[11px] text-muted-foreground">
          <Row label="Aave V3 Pool" value={AAVE_V3_POOL} />
          <Row label="PancakeSwap V2 router" value={DEXES.pancake.router} />
          <Row label="SushiSwap V2 router" value={DEXES.sushi.router} />
          <Row label="Uniswap V3 quoter" value={DEXES.uniswap.quoter} />
          <Row label="WBNB" value={TOKENS.WBNB.address} />
          <Row label="USDT" value={TOKENS.USDT.address} />
        </div>
      </section>

      <section className="panel mt-4">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">FlashArb.sol</h2>
          <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-[11px]" onClick={copy}>
            <Copy className="size-3" /> {copied ? "Copied" : "Copy source"}
          </Button>
        </div>
        <pre className="max-h-[28rem] overflow-auto px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <code>{FLASH_ARB_SOURCE}</code>
        </pre>
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
