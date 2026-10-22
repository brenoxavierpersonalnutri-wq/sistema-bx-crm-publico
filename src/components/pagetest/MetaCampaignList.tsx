import { motion } from "framer-motion";
import { MetaCampaign, getConversions } from "@/lib/metaApi";

interface Props {
  campaigns: MetaCampaign[];
}

export const MetaCampaignList = ({ campaigns }: Props) => {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Nenhuma campanha encontrada.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Campanha</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Impressões</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Cliques</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">CTR</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Gasto</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Conv.</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => {
              const insight = c.insights?.data?.[0];
              const impressions = parseInt(insight?.impressions || "0");
              const clicks = parseInt(insight?.clicks || "0");
              const spend = parseFloat(insight?.spend || "0");
              const ctr = parseFloat(insight?.ctr || "0");
              const conversions = getConversions(insight?.actions);

              return (
                <motion.tr
                  key={c.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="border-b border-border/50 transition-colors hover:bg-secondary/30"
                >
                  <td className="px-4 py-3">
                    <span className="text-sm text-foreground">{c.name}</span>
                    <span className="ml-2 text-[10px] text-muted-foreground">{c.objective}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      c.status === "ACTIVE" ? "bg-[hsl(var(--success))]/20 text-[hsl(var(--success))]" : "bg-muted text-muted-foreground"
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-foreground">{impressions.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-right text-sm text-foreground">{clicks.toLocaleString("pt-BR")}</td>
                  <td className="px-4 py-3 text-right text-sm text-primary">{ctr.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right text-sm text-foreground">R${spend.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-[hsl(var(--success))]">{conversions}</td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
