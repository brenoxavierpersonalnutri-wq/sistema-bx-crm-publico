import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { usePrivacy } from "@/hooks/usePrivacy";

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  color = "emerald",
  monetary = true,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  color?: "emerald" | "blue" | "amber" | "purple";
  /** When true, mask the value when privacy mode is on. Defaults to true. */
  monetary?: boolean;
}) {
  const { hidden } = usePrivacy();
  const palette: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-600",
    blue: "bg-blue-500/10 text-blue-600",
    amber: "bg-amber-500/10 text-amber-600",
    purple: "bg-purple-500/10 text-purple-600",
  };
  const isMasked = monetary && hidden;
  const displayValue = isMasked ? "R$ ••••••" : value;
  const displayHint = isMasked && hint && /R\$/.test(hint) ? "•••••" : hint;
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{title}</p>
          <div className={`p-2 rounded-lg ${palette[color]}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">{displayValue}</p>
        {displayHint && <p className="text-xs text-muted-foreground">{displayHint}</p>}
      </CardContent>
    </Card>
  );
}
