import { useCallback, useEffect, useState } from "react";
import { BSC_CHAIN_ID_HEX } from "@/lib/chain";

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

const BSC_PARAMS = {
  chainId: BSC_CHAIN_ID_HEX,
  chainName: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
  blockExplorerUrls: ["https://bscscan.com"],
};

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const eth = window.ethereum;
    setAvailable(Boolean(eth));
    if (!eth) return;

    void (async () => {
      const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
      if (accounts?.[0]) setAddress(accounts[0]);
      setChainId((await eth.request({ method: "eth_chainId" })) as string);
    })();

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts?.[0] ?? null);
    };
    const onChain = (...args: unknown[]) => setChainId(args[0] as string);
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) throw new Error("No injected wallet found. Install MetaMask or Trust Wallet.");
    setConnecting(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts?.[0] ?? null);
      const current = (await eth.request({ method: "eth_chainId" })) as string;
      if (current !== BSC_CHAIN_ID_HEX) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_CHAIN_ID_HEX }],
          });
        } catch {
          await eth.request({ method: "wallet_addEthereumChain", params: [BSC_PARAMS] });
        }
      }
      setChainId((await eth.request({ method: "eth_chainId" })) as string);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setAddress(null), []);

  return {
    address,
    chainId,
    connect,
    disconnect,
    connecting,
    available,
    onBsc: chainId === BSC_CHAIN_ID_HEX,
  };
}
