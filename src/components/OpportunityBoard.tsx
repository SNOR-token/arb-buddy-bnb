import { Button } from "@/components/ui/button";
import { dexLabel } from "@/lib/chain";
import { fmt, type Opportunity } from "@/lib/arb-math";
import { cn } from "@/lib/utils";
import { ArrowRight, CheckCircle2, FlaskConical, X, Zap } from "lucide-react";

export interface SimResult {
  ok: boolean;
  message: string;
}

interface Props {
  opportunities: Opportunity[];
  onExecute: (op: Opportunity) => void;
  onSimulate: (op: Opportunity) => void;
  onDismiss: (pairId: string) => void;
  executing: string | null;
  simulating: string | null;
  sims: Record<string, SimResult>;
}

export function OpportunityBoard({
  opportunities,
  onExecute,
  onSimulate,
  onDismiss,
  executing,
  simulating,
  sims,
}: Props) {
  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Profitable arbitrage routes</h2>
        <span className="text-[11px] text-muted-foreground">
          round-trip quoted · net of Aave fee · DEX fees · gas
        </span>
      </div>
      <div className="divide-y divide-border/60">
        {opportunities.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No route currently clears the flash-loan premium, DEX fees and gas. Scanning every
            block…
          </p>
        )}
        {opportunities.map((op) => {
          const quote = op.pair.quote;
          const sim = sims[op.pairId];
          return (
            <div key={op.pairId} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{op.pairId}</span>
                  <span className="text-muted-foreground">{dexLabel(op.buyDex)}</span>
                  <ArrowRight className="size-3 text-primary" />
                  <span className="text-muted-foreground">{dexLabel(op.sellDex)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs font-semibold text-success">
                    +{fmt(op.netProfit, 4)} {quote}
                  </span>
                  <button
                    type="button"
                    aria-label={`Dismiss ${op.pairId} route`}
                    onClick={() => onDismiss(op.pairId)}
                    className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </div>

              <div className="tabular mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span>spread {op.spreadPct.toFixed(3)}%</span>
                <span>
                  loan {fmt(op.notional, 2)} {quote}
                </span>
                <span>flash fee {fmt(op.flashFee, 4)}</span>
                <span>gas {fmt(op.gasCost, 5)}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={simulating === op.pairId}
                  onClick={() => onSimulate(op)}
                  className="h-7 gap-1.5 text-[11px]"
                >
                  <FlaskConical className="size-3" />
                  {simulating === op.pairId ? "Simulating…" : "Simulate"}
                </Button>
                <Button
                  size="sm"
                  disabled={executing === op.pairId}
                  onClick={() => onExecute(op)}
                  className="h-7 gap-1.5 text-[11px]"
                >
                  <Zap className="size-3" />
                  {executing === op.pairId ? "Submitting…" : "Flashloan arb"}
                </Button>
                {sim && (
                  <span
                    className={cn(
                      "flex items-center gap-1 text-[11px]",
                      sim.ok ? "text-success" : "text-warning",
                    )}
                  >
                    {sim.ok && <CheckCircle2 className="size-3" />}
                    {sim.message}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
