import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Link } from "@tanstack/react-router";
import { AAVE_V3_POOL } from "@/lib/chain";
import { ExternalLink } from "lucide-react";

export type { BotSettings } from "@/hooks/useBotSettings";
import type { BotSettings } from "@/hooks/useBotSettings";

interface Props {
  settings: BotSettings;
  onChange: (next: Partial<BotSettings>) => void;
}

export function BotConfig({ settings, onChange }: Props) {
  return (
    <div className="panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide">Bot configuration</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          BnbArbExecutor · <span className="tabular">executeArbitrage()</span> · Aave V3 pool{" "}
          <span className="tabular">{AAVE_V3_POOL.slice(0, 10)}…</span> on BNB Chain
        </p>
      </div>


      <div className="space-y-4 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="contract" className="text-[11px] uppercase tracking-wider text-muted-foreground">
            FlashArb contract address
          </Label>
          <Input
            id="contract"
            value={settings.contract}
            onChange={(e) => onChange({ contract: e.target.value.trim() })}
            placeholder="0x… your deployed executor"
            className="tabular h-9 text-xs"
          />
          <Link
            to="/contract"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Get the contract &amp; deploy guide <ExternalLink className="size-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Loan size (quote)
            </Label>
            <Input
              type="number"
              value={settings.loanAmount}
              onChange={(e) => onChange({ loanAmount: Number(e.target.value) })}
              className="tabular h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Min profit (quote)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={settings.minProfit}
              onChange={(e) => onChange({ minProfit: Number(e.target.value) })}
              className="tabular h-9 text-xs"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Whale swap threshold
            </Label>
            <span className="tabular text-[11px] text-primary">{settings.minSizePct}%</span>
          </div>
          <Slider
            value={[settings.minSizePct]}
            min={5}
            max={1000}
            step={5}
            onValueChange={([v]) => onChange({ minSizePct: v ?? 100 })}
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2.5">
          <div>
            <Label htmlFor="auto" className="text-xs font-medium">
              Auto-fire on whale swaps
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Logs simulated fills until a contract address is set
            </p>
          </div>
          <Switch
            id="auto"
            checked={settings.autoMode}
            onCheckedChange={(v) => onChange({ autoMode: v })}
          />
        </div>
      </div>
    </div>
  );
}
