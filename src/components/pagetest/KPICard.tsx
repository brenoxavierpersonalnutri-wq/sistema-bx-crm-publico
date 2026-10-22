import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  change: number;
  delay: number;
}

export const KPICard = ({ icon: Icon, label, value, change, delay }: KPICardProps) => {
  const TrendIcon = change > 0 ? TrendingUp : change < 0 ? TrendingDown : Minus;
  const trendColor = change > 0 ? "text-[hsl(var(--success))]" : change < 0 ? "text-destructive" : "text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className={`flex items-center gap-1 font-mono text-xs ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />
          <span>{change > 0 ? "+" : ""}{change}%</span>
        </div>
      </div>
      <div className="mt-3">
        <span className="font-mono text-2xl font-bold text-foreground">{value}</span>
      </div>
      <span className="mt-1 block text-xs text-muted-foreground">{label}</span>
    </motion.div>
  );
};
