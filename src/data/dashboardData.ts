export interface MonthlyData {
  month: string;
  faturamento: number;
  comissao: number;
  trafego: number;
  campanhaMeta: number;
  ferramentas: number;
  colaboradores: number;
  impostoPercent: number;
  whatsappCost: number;
  whatsappMessagesSent: number;
  whatsappMessagesReceived: number;
}

export function getTotals(data: MonthlyData[]) {
  const totalFaturamento = data.reduce((s, d) => s + d.faturamento, 0);
  const totalComissao = data.reduce((s, d) => s + d.comissao, 0);
  const totalTrafego = data.reduce((s, d) => s + d.trafego, 0);
  const totalCampanha = data.reduce((s, d) => s + d.campanhaMeta, 0);
  const totalFerramentas = data.reduce((s, d) => s + d.ferramentas, 0);
  const totalColaboradores = data.reduce((s, d) => s + d.colaboradores, 0);
  const totalImposto = data.reduce((s, d) => s + (d.faturamento * d.impostoPercent / 100), 0);
  const totalWhatsappCost = data.reduce((s, d) => s + d.whatsappCost, 0);
  const totalWhatsappSent = data.reduce((s, d) => s + d.whatsappMessagesSent, 0);
  const totalWhatsappReceived = data.reduce((s, d) => s + d.whatsappMessagesReceived, 0);
  const totalGastos = totalTrafego + totalCampanha + totalFerramentas + totalColaboradores + totalImposto;
  const lucro = totalComissao - totalGastos;

  return {
    totalFaturamento,
    totalComissao,
    totalTrafego,
    totalCampanha,
    totalFerramentas,
    totalColaboradores,
    totalImposto,
    totalWhatsappCost,
    totalWhatsappSent,
    totalWhatsappReceived,
    totalGastos,
    lucro,
  };
}

export function getExpenseBreakdown(data: MonthlyData[]) {
  const t = getTotals(data);
  return [
    { name: "Tráfego", value: t.totalTrafego, fill: "hsl(var(--chart-traffic))" },
    { name: "13,83% Meta", value: t.totalCampanha, fill: "hsl(var(--chart-campaign))" },
    { name: "Ferramentas", value: t.totalFerramentas, fill: "hsl(var(--chart-tools))" },
    { name: "Colaboradores", value: t.totalColaboradores, fill: "hsl(var(--chart-collaborators))" },
    { name: "Imposto", value: t.totalImposto, fill: "hsl(var(--chart-tax))" },
  ];
}
