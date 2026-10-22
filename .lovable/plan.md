# Plano: Modo Privacidade para Valores Monetários

## Objetivo
Adicionar um botão de olho (👁 / 👁‍🗨) que oculta todos os valores em R$ na interface, para gravações de tela. Quando ativo, valores viram `R$ ••••••`. Estado persiste em `localStorage` e vale para todas as telas.

## Arquitetura

### 1. Contexto global de privacidade
Criar `src/hooks/usePrivacy.tsx`:
- `PrivacyProvider` com state `hidden: boolean` (persistido em `localStorage` chave `bg_privacy_hidden`)
- Hook `usePrivacy()` → `{ hidden, toggle, formatMoney(value) }`
- `formatMoney` retorna `R$ ••••••` quando `hidden`, senão o valor formatado normal em BRL

Registrar `<PrivacyProvider>` em `src/App.tsx` envolvendo as rotas.

### 2. Botão toggle no header
Criar `src/components/PrivacyToggle.tsx`:
- Ícone `Eye` / `EyeOff` do lucide-react
- Tooltip "Ocultar valores" / "Mostrar valores"
- Coloca ao lado do `UserProfileHeader` ou nos headers das páginas de vendas/financeiro

Adicionar nos headers de:
- `src/pages/VendasFunil.tsx`
- `src/pages/Index.tsx` (Vendas Geral)
- `src/pages/MonthlyDashboard.tsx`
- `src/pages/AnnualDashboard.tsx`
- `src/pages/Financeiro.tsx`
- `src/pages/GatewayDashboard.tsx`, `GatewayFinanceiro.tsx`, `GatewayTransacoes.tsx`, `GatewayCobrancas.tsx`
- `src/pages/Alunas.tsx`

### 3. Componente reutilizável `<Money />`
Criar `src/components/Money.tsx`:
```tsx
<Money value={1234.56} /> // R$ 1.234,56  ou  R$ ••••••
```
Usa `usePrivacy()` internamente. Mantém className/props.

### 4. Aplicar nos pontos que exibem dinheiro
Substituir `toLocaleString("pt-BR", { style: "currency", currency: "BRL" })` por `<Money>` ou usar `formatMoney` nos seguintes arquivos (mapeamento do faturamento/comissão/gastos/ticket/saldo):

**Funil (prioritário, foco do pedido):**
- `src/components/dashboard/FunnelDashboard.tsx`
- `src/components/dashboard/FunnelConversionsSection.tsx`
- `src/components/dashboard/WebhookSourcesCard.tsx`

**Geral / Mensal / Anual:**
- `src/components/dashboard/SummaryCards.tsx` (Faturamento, Comissão, Gastos, Lucro)
- `src/components/dashboard/MonthlyTable.tsx`
- `src/components/dashboard/RevenueExpenseChart.tsx` (tooltip e eixos)
- `src/components/dashboard/ExpenseBreakdownChart.tsx`
- `src/components/dashboard/ExpenseDetailCards.tsx`
- `src/components/dashboard/FinanceDrillDialog.tsx`
- `src/components/StatsCards.tsx` (subtítulos com R$: reembolsadas, negociando)
- `src/components/RevenueChart.tsx`

**Gateway:**
- `src/pages/GatewayDashboard.tsx`, `GatewayFinanceiro.tsx`, `GatewayTransacoes.tsx`, `GatewayCobrancas.tsx`
- `src/components/gateway/StatCard.tsx`

**Alunas:**
- `src/components/alunas/AlunaStatsCards.tsx`, `AlunaDashboard.tsx`

### 5. Gráficos (recharts)
Para tooltips/eixos Y, criar um `tickFormatter` que respeita o modo. Quando oculto, eixo Y mostra `••` e tooltip mostra `R$ ••••••`. Barras/linhas continuam renderizando normalmente (apenas o label oculta).

## Comportamento
- Estado salvo em `localStorage`, ativa no carregamento da página
- Atalho de teclado opcional: `Ctrl+H` para alternar (a confirmar)
- Não oculta percentuais (%) nem contagens — apenas valores em R$

## Testes
- Toggle no header funciona e persiste após refresh
- Em `/vendas/funil`: cards de faturamento mostram `R$ ••••••`
- Em `/vendas` (geral) e `/balanco-mensal`: SummaryCards ocultam corretamente
- Gráficos: tooltip oculta valor mas mantém categoria
- Reativar mostra os valores normais

## Confirmações antes de implementar
1. Atalho de teclado `Ctrl+H` — quer?
2. Onde prefere o botão: no header global (ao lado do avatar, aparece em todas as telas) ou só nas telas de vendas/financeiro?
3. Ocultar também ticket médio, saldo do gateway, e valores nas tabelas de transações? (assumo que sim)