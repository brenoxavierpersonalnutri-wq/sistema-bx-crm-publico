import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LogOut, Users, GraduationCap, BarChart3, DollarSign, FlaskConical, Video, CreditCard, Receipt, Filter, Network , Target, Smartphone, Radio} from "lucide-react";
import { Link } from "react-router-dom";

import { podeAbrirRota } from "@/lib/modules";
import { UserProfileHeader } from "@/components/UserProfileHeader";

const menuItems = [
  {
    title: "Gestão de Alunas",
    description: "Gestão de planos, pagamentos e vencimentos",
    icon: GraduationCap,
    to: "/alunas",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
  {
    title: "App das Alunas",
    description: "Treinos com vídeo, fases mensais, dieta e feedback",
    icon: Smartphone,
    to: "/alunas/app",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    title: "Mapa Mental",
    description: "Como a operação funciona — o time cria e edita os balões",
    icon: Network,
    to: "/mapamental",
    external: true,
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    title: "Conteúdo",
    description: "Board de conteúdo dos 5 perfis: jogo, tipos, produção e DNA",
    icon: Video,
    to: "/conteudo",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
  {
    title: "Monitoramento das Consultas",
    description: "Acompanhe consultas, conversões e leads",
    icon: BarChart3,
    to: "/vendas",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    title: "Dash Financeiro",
    description: "Faturamento, metas e métricas financeiras",
    icon: DollarSign,
    to: "/financeiro",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    title: "Teste de Página",
    description: "Área de testes e experimentações",
    icon: FlaskConical,
    to: "/teste",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    title: "CRM / Kanban",
    description: "Gestão de leads e contatos por etapas",
    icon: Users,
    to: "/crm",
    color: "text-purple-500",
    bg: "bg-purple-500/10",
  },
  {
    title: "Meus Funis",
    description: "Crie funis com nome e UTMs sem precisar de código",
    icon: Filter,
    to: "/funis",
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
  },
  {
    title: "Lives e Webinários",
    description: "Estúdio ao vivo, transmissão RTMP e webinário com ofertas",
    icon: Radio,
    to: "/lives",
    color: "text-red-500",
    bg: "bg-red-500/10",
  },
];

export default function Home() {
  const { signOut, profile, isAdmin, allowedModules } = useAuth();

  const visibleItems = menuItems.filter((item) => podeAbrirRota(item.to, isAdmin, allowedModules));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="container max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <UserProfileHeader />
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link to="/admin/users">
                <Button variant="outline" size="sm" className="gap-2">
                  <Users className="h-4 w-4" />
                  Usuários
                </Button>
              </Link>
            )}
            <Button variant="ghost" size="sm" className="gap-2" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h2 className="font-display text-2xl font-bold tracking-tight">O que deseja acessar?</h2>
            <p className="text-sm text-muted-foreground">Escolha uma das opções abaixo</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            {visibleItems.map((item) => {
              // O mapa mental é uma página estática fora do app — <Link> não a alcança
              const Wrapper = ({ children }: { children: React.ReactNode }) =>
                item.external
                  ? <a href={item.to}>{children}</a>
                  : <Link to={item.to}>{children}</Link>;
              return (
              <Wrapper key={item.to}>
                <Card className="group cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] hover:border-primary/30 h-full">
                  <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                    <div className={`p-3 rounded-xl ${item.bg} transition-transform group-hover:scale-110`}>
                      <item.icon className={`h-7 w-7 ${item.color}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base">{item.title}</h3>
                      <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Wrapper>
              );
            })}

            {isAdmin && (
              <>
                <Link to="/gateway/dashboard">
                  <Card className="group cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] hover:border-primary/30 h-full">
                    <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                      <div className="p-3 rounded-xl bg-emerald-500/10 transition-transform group-hover:scale-110">
                        <CreditCard className="h-7 w-7 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-base">Gateway de Pagamento</h3>
                        <p className="text-xs text-muted-foreground mt-1">Receba por Pix, Cartão e Boleto</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                <Link to="/gateway/links">
                  <Card className="group cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] hover:border-primary/30 h-full">
                    <CardContent className="p-6 flex flex-col items-center text-center gap-3">
                      <div className="p-3 rounded-xl bg-blue-500/10 transition-transform group-hover:scale-110">
                        <Receipt className="h-7 w-7 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-base">Links de Pagamento</h3>
                        <p className="text-xs text-muted-foreground mt-1">Crie links para receber pagamentos</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
