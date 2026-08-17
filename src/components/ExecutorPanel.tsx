import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleSlash, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DEXES, type DexId } from "@/lib/chain";
import {
  isAddress,
  readExecutorStatus,
  setRouterAllowed,
  type ExecutorStatus,
} from "@/lib/execute";
import { cn } from "@/lib/utils";

interface Props {
  contract: string;
  address: string | null;
  onBsc: boolean;
}

/** Live preflight of the deployed BnbArbExecutor: owner, pause flag, routers. */
export function ExecutorPanel({ contract, address, onBsc }: Props) {
  const [status, setStatus] = useState<ExecutorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<DexId | "refresh" | null>(null);

  const valid = isAddress(contract);

  const refresh = useCallback(async () => {
    if (!valid || !window.ethereum || !onBsc) return;
    setBusy("refresh");
    try {
      setStatus(await readExecutorStatus(window.ethereum, contract as `0x${string}`, address));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 120) : "Preflight failed");
      setStatus(null);
    } finally {
      setBusy(null);
    }
  }, [valid, contract, address, onBsc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allow = async (dex: DexId) => {
    if (!window.ethereum || !address) return;
    setBusy(dex);
    try {
      const hash = await setRouterAllowed(
        window.ethereum,
        address,
        contract as `0x${string}`,
        DEXES[dex].router,
        true,
      );
      toast.success(`Allowlisting ${DEXES[dex].label}`, { description: hash.slice(0, 18) + "…" });
    } catch (e) {
      toast.error("Allowlist failed", {
        description: e instanceof Error ? e.message.slice(0, 140) : "Rejected",
      });
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  return (
    <div className="panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide">
            <ShieldCheck className="size-3.5 text-primary" /> Executor preflight
          </h2>
          <p className="tabular mt-0.5 text-[11px] text-muted-foreground">
            {valid ? `${contract.slice(0, 10)}…${contract.slice(-6)}` : "no contract set"}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1.5 text-[11px]"
          disabled={busy === "refresh" || !valid}
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn("size-3", busy === "refresh" && "animate-spin")} /> Check
        </Button>
      </div>

      <div className="space-y-2 px-4 py-3 text-[11px]">
        {!address && <p className="text-muted-foreground">Connect a wallet to read on-chain state.</p>}
        {address && !onBsc && <p className="text-warning">Switch the wallet to BNB Chain mainnet.</p>}
        {error && <p className="text-destructive">{error}</p>}

        {status && (
          <>
            <Row
              ok={status.isOwner}
              label="signer is owner"
              value={`${status.owner.slice(0, 8)}…${status.owner.slice(-4)}`}
            />
            <Row ok={!status.paused} label="not paused" value={status.paused ? "paused" : "active"} />
            <Row
              ok
              label="Aave pool"
              value={`${status.pool.slice(0, 8)}…${status.pool.slice(-4)}`}
            />
            {(Object.keys(DEXES) as DexId[]).map((id) => (
              <div key={id} className="flex items-center justify-between gap-2">
                <Row ok={status.routers[id]} label={DEXES[id].label} value="" />
                {!status.routers[id] && status.isOwner && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 text-[10px]"
                    disabled={busy === id}
                    onClick={() => void allow(id)}
                  >
                    {busy === id ? "…" : "Allow"}
                  </Button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex flex-1 items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {ok ? (
          <CheckCircle2 className="size-3 text-success" />
        ) : (
          <CircleSlash className="size-3 text-warning" />
        )}
        {label}
      </span>
      <span className="tabular text-muted-foreground">{value}</span>
    </div>
  );
}
