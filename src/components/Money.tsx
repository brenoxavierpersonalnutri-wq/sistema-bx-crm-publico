import { usePrivacy } from "@/hooks/usePrivacy";
import type { HTMLAttributes } from "react";

interface MoneyProps extends HTMLAttributes<HTMLSpanElement> {
  value: number | null | undefined;
}

/** Render a BRL value respecting the global privacy/hide-money toggle. */
export function Money({ value, ...rest }: MoneyProps) {
  const { formatMoney } = usePrivacy();
  return <span {...rest}>{formatMoney(value)}</span>;
}
