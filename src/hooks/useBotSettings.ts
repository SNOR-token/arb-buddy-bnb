import { useCallback, useEffect, useState } from "react";
import { EXECUTOR_ADDRESS } from "@/lib/chain";

export interface BotSettings {
  contract: string;
  loanAmount: number;
  minProfit: number;
  autoMode: boolean;
  minSizePct: number;
}

export const DEFAULT_SETTINGS: BotSettings = {
  contract: EXECUTOR_ADDRESS,
  loanAmount: 5000,
  minProfit: 1,
  autoMode: false,
  minSizePct: 25,
};


const KEY = "bnb-arb-settings";
const EVENT = "bnb-arb-settings-change";

export function readSettings(): BotSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<BotSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(patch: Partial<BotSettings>): BotSettings {
  const merged = { ...readSettings(), ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent<BotSettings>(EVENT, { detail: merged }));
  return merged;
}

/** Bot settings shared between the terminal and the AI agent, synced across tabs. */
export function useBotSettings() {
  const [settings, setSettings] = useState<BotSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(readSettings());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<BotSettings>).detail;
      setSettings(detail ?? readSettings());
    };
    const onStorage = () => setSettings(readSettings());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const update = useCallback((patch: Partial<BotSettings>) => {
    setSettings(writeSettings(patch));
  }, []);

  return { settings, update };
}
