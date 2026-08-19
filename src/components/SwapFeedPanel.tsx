import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { getLargeSwaps } from "@/lib/arb.functions";
import { readWssUrl, saveWssUrl, useSwapStream, type StreamSwap } from "@/hooks/useSwapStream";
import { fmt } from "@/lib/arb-math";
import { BSC_WSS_RPC } from "@/lib/chain";
import { cn } from "@/lib/utils";
import { Radio } from "lucide-react";

export function SwapFeedPanel({ minSizePct }: { minSizePct: number }) {
  const [wssInput, setWssInput] = useState(BSC_WSS_RPC as string);
  const [wssUrl, setWssUrl] = useState(BSC_WSS_RPC as string);
  const [streamOn, setStreamOn] = useState(true);

  useEffect(() => {
    // SwiftNodes websocket is hardcoded; a saved override still wins if present.
    const saved = readWssUrl();
    setWssInput(saved || BSC_WSS_RPC);
    setWssUrl(saved || BSC_WSS_RPC);
  }, []);

  const { status, swaps: streamed } = useSwapStream(wssUrl, streamOn);

  const polled = useQuery({
    queryKey: ["largeSwaps", minSizePct],
    queryFn: () => getLargeSwaps({ data: { lookbackBlocks: 300, minSizePct } }),
    refetchInterval: status === "live" ? false : 12_000,
    enabled: status !== "live",
  });

  const rows = useMemo(() => {
    if (status === "live") {
      return streamed.filter((s) => s.baseAmount > 0).slice(0, 25);
    }
    return (polled.data?.swaps ?? []).slice(0, 25).map<StreamSwap>((s) => ({
      id: s.id,
      pairId: s.pairId,
      side: s.side,
      baseAmount: s.baseAmount,
      quoteAmount: s.quoteAmount,
      txHash: s.txHash,
      ts: Date.now(),
    }));
  }, [status, streamed, polled.data]);

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <Radio
            className={cn(
              "size-3.5",
              status === "live" ? "live-dot text-success" : "text-muted-foreground",
            )}
          />
          Large swap feed
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="stream" className="text-[11px] text-muted-foreground">
            {status === "live" ? "websocket" : status === "error" ? "ws failed · polling" : "polling"}
          </Label>
          <Switch id="stream" checked={streamOn} onCheckedChange={setStreamOn} />
        </div>
      </div>

      <div className="flex gap-2 border-b border-border px-4 py-2.5">
        <Input
          value={wssInput}
          onChange={(e) => setWssInput(e.target.value)}
          placeholder="wss://rpc.swiftnodes.io/ws/bsc?key=…"
          className="h-8 text-[11px]"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-[11px]"
          onClick={() => {
            saveWssUrl(wssInput.trim());
            setWssUrl(wssInput.trim());
          }}
        >
          Subscribe
        </Button>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            No large swaps yet. Paste a websocket endpoint for instant events.
          </p>
        )}
        {rows.map((s) => (
          <a
            key={s.id}
            href={`https://bscscan.com/tx/${s.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs transition-colors hover:bg-surface-2"
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  s.side === "buy" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive",
                )}
              >
                {s.side}
              </span>
              <span className="font-medium">{s.pairId}</span>
            </span>
            <span className="tabular text-muted-foreground">
              {fmt(s.baseAmount, 3)} / {fmt(s.quoteAmount, 2)}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
