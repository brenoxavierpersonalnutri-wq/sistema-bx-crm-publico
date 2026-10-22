import { motion } from "framer-motion";
import { Eye, MousePointerClick, ShoppingCart, DollarSign } from "lucide-react";
import { MetaAd, getConversions } from "@/lib/metaApi";

interface Props {
  ads: MetaAd[];
}

export const MetaAdsList = ({ ads }: Props) => {
  if (ads.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Nenhum anúncio encontrado.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ads.map((ad, i) => {
        const insight = ad.insights?.data?.[0];
        const impressions = parseInt(insight?.impressions || "0");
        const clicks = parseInt(insight?.clicks || "0");
        const spend = parseFloat(insight?.spend || "0");
        const ctr = parseFloat(insight?.ctr || "0");
        const conversions = getConversions(insight?.actions);
        const cpa = conversions > 0 ? spend / conversions : 0;

        return (
          <motion.div
            key={ad.id}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/30"
          >
            <div className="flex items-start gap-3">
              {ad.creative?.thumbnail_url && (
                <img src={ad.creative.thumbnail_url} alt={ad.name} className="h-12 w-12 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-foreground">{ad.name}</h3>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  ad.status === "ACTIVE" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"
                }`}>
                  {ad.status}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Eye className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider">Impressões</span>
                </div>
                <span className="text-sm font-medium text-foreground">{(impressions / 1000).toFixed(1)}k</span>
              </div>
              <div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MousePointerClick className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider">CTR</span>
                </div>
                <span className="text-sm font-medium text-foreground">{ctr.toFixed(2)}%</span>
              </div>
              <div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <ShoppingCart className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider">Conv.</span>
                </div>
                <span className="text-sm font-medium text-[hsl(var(--success))]">{conversions}</span>
              </div>
              <div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <DollarSign className="h-3 w-3" />
                  <span className="text-[10px] uppercase tracking-wider">CAC</span>
                </div>
                <span className="text-sm font-medium text-foreground">
                  {cpa > 0 ? `R$${cpa.toFixed(2)}` : "—"}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">{clicks} cliques</span>
              <span className="text-xs font-medium text-primary">R${spend.toFixed(2)}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
