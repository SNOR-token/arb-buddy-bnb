import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/arb-math";
import type { Trade } from "@/hooks/useTrades";
import { cn } from "@/lib/utils";

interface Props {
  trades: Trade[];
  realized: number;
  winRate: number;
  onClear: () => void;
}

export function PnlPanel({ trades, realized, winRate, onClear }: Props) {
  const series = useMemo(() => {
    let cum = 0;
    return [...trades]
      .sort((a, b) => a.ts - b.ts)
      .map((t) => {
        cum += t.netProfit;
        return {
          t: new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          pnl: Number(cum.toFixed(4)),
        };
      });
  }, [trades]);

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Live P&amp;L</h2>
        <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClear}>
          Reset
        </Button>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border/60 border-b border-border/60">
        <Stat label="Realized" value={`${realized >= 0 ? "+" : ""}${fmt(realized, 4)}`} positive={realized >= 0} />
        <Stat label="Trades" value={String(trades.length)} />
        <Stat label="Win rate" value={`${winRate.toFixed(0)}%`} />
      </div>

      <div className="h-40 px-2 py-3">
        {series.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke="var(--color-primary)"
                strokeWidth={2}
                fill="url(#pnlFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
            P&amp;L curve appears after your first executed or simulated arb.
          </p>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto border-t border-border/60">
        {trades.slice(0, 20).map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between border-b border-border/40 px-4 py-2 text-[11px]"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] uppercase",
                  t.mode === "live" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {t.mode}
              </span>
              <span>{t.pairId}</span>
            </span>
            <span
              className={cn("tabular", t.netProfit >= 0 ? "text-success" : "text-destructive")}
            >
              {t.netProfit >= 0 ? "+" : ""}
              {fmt(t.netProfit, 4)} {t.quoteSymbol}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "tabular mt-0.5 text-base font-semibold",
          positive === undefined ? "text-foreground" : positive ? "text-success" : "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
