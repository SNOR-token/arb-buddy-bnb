import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { Wallet, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletButton() {
  const { address, connect, connecting, onBsc, available } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        {!onBsc && (
          <Badge className="gap-1 border-destructive/40 bg-destructive/15 text-destructive">
            <AlertTriangle className="size-3" /> Wrong network
          </Badge>
        )}
        <span className="tabular rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground">
          {short(address)}
        </span>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() =>
        connect().catch((e: Error) => toast.error(e.message ?? "Could not connect wallet"))
      }
      disabled={connecting}
      className="gap-1.5"
    >
      <Wallet className="size-4" />
      {connecting ? "Connecting…" : available ? "Connect wallet" : "Install wallet"}
    </Button>
  );
}
