import { DEX_LIST, PAIRS } from "@/lib/chain";
import { fmt, type Quote } from "@/lib/arb-math";
import { cn } from "@/lib/utils";

export function PriceMatrix({ quotes, loading }: { quotes: Quote[]; loading: boolean }) {
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Live DEX quotes</h2>
        <span className="text-[11px] text-muted-foreground">
          mid price per 1 base token
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Pair</th>
              {DEX_LIST.map((d) => (
                <th key={d.id} className="px-4 py-2 font-medium whitespace-nowrap">
                  {d.label}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Spread</th>
            </tr>
          </thead>
          <tbody>
            {PAIRS.map((pair) => {
              const row = DEX_LIST.map(
                (d) => quotes.find((q) => q.pairId === pair.id && q.dex === d.id)?.price ?? null,
              );
              const valid = row.filter((p): p is number => !!p && p > 0);
              const min = valid.length ? Math.min(...valid) : 0;
              const max = valid.length ? Math.max(...valid) : 0;
              const spread = min ? ((max - min) / min) * 100 : 0;
              return (
                <tr key={pair.id} className="border-t border-border/60">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold">{pair.id}</div>
                    <div className="text-[10px] text-muted-foreground">size {pair.size}</div>
                  </td>
                  {row.map((price, i) => (
                    <td key={i} className="tabular px-4 py-2.5">
                      {loading && price == null ? (
                        <span className="text-muted-foreground">···</span>
                      ) : (
                        <span
                          className={cn(
                            price != null && price === min && valid.length > 1 && "text-success",
                            price != null && price === max && valid.length > 1 && "text-primary",
                          )}
                        >
                          {fmt(price, price && price > 100 ? 2 : 6)}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="tabular px-4 py-2.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        spread > 0.35
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {spread ? `${spread.toFixed(3)}%` : "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
