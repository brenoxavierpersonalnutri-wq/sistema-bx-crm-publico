import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface PrivacyContextValue {
  hidden: boolean;
  toggle: () => void;
  formatMoney: (value: number | null | undefined) => string;
}

const STORAGE_KEY = "bg_privacy_hidden";
const MASK = "R$ ••••••";

const PrivacyContext = createContext<PrivacyContextValue | undefined>(undefined);

function formatBRL(value: number | null | undefined): string {
  const n = typeof value === "number" && isFinite(value) ? value : 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    document.body.classList.toggle("privacy-on", hidden);
  }, [hidden]);

  const toggle = useCallback(() => setHidden((h) => !h), []);

  const formatMoney = useCallback(
    (value: number | null | undefined) => (hidden ? MASK : formatBRL(value)),
    [hidden]
  );

  const value = useMemo<PrivacyContextValue>(() => ({ hidden, toggle, formatMoney }), [hidden, toggle, formatMoney]);

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) {
    // Fallback: no provider mounted -> never hide
    return {
      hidden: false,
      toggle: () => {},
      formatMoney: (v) => formatBRL(v),
    };
  }
  return ctx;
}

export { MASK as PRIVACY_MASK };
