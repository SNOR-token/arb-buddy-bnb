import { Button } from "@/components/ui/button";
import { dexLabel } from "@/lib/chain";
import { fmt, type Opportunity } from "@/lib/arb-math";
import { cn } from "@/lib/utils";
import { ArrowRight, Zap } from "lucide-react";

interface Props {
  opportunities: Opportunity[];
  minNetProfit: number;
  onExecute: (op: Opportunity) => void;
  executing: string | null;
}

export function OpportunityBoard({ opportunities, minNetProfit, onExecute, executing }: Props) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Arbitrage opportunities</h2>
        <span className="text-[11px] text-muted-foreground">
          net of Aave fee · DEX fees · gas
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {opportunities.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Scanning venues for price dislocations…
          </p>
        )}
        {opportunities.map((op) => {
          const viable = op.netProfit >= minNetProfit;
          const quote = op.pair.quote;
          return (
            <div key={op.pairId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{op.pairId}</span>
                  <span className="text-muted-foreground">{dexLabel(op.buyDex)}</span>
                  <ArrowRight className="size-3 text-primary" />
                  <span className="text-muted-foreground">{dexLabel(op.sellDex)}</span>
                </div>
                <span
                  className={cn(
                    "tabular text-xs font-semibold",
                    viable ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {op.netProfit >= 0 ? "+" : ""}
                  {fmt(op.netProfit, 4)} {quote}
                </span>
              </div>

              <div className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span>spread {op.spreadPct.toFixed(3)}%</span>
                <span>notional {fmt(op.notional, 2)}</span>
                <span>flash fee {fmt(op.flashFee, 4)}</span>
                <span>gas {fmt(op.gasCost, 5)}</span>
              </div>

              <div className="mt-2.5">
                <Button
                  size="sm"
                  variant={viable ? "default" : "secondary"}
                  disabled={!viable || executing === op.pairId}
                  onClick={() => onExecute(op)}
                  className="h-7 gap-1.5 text-[11px]"
                >
                  <Zap className="size-3" />
                  {executing === op.pairId ? "Submitting…" : "Flashloan arb"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
