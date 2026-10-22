const PropostaParceria = () => {
  return (
    <div style={{ background: "#FAFAF8", minHeight: "100vh" }}>
      <style>{`
        .pp-page {
          max-width: 680px;
          margin: 0 auto;
          padding: 52px 36px 88px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 15px;
          line-height: 1.65;
          color: #111115;
          -webkit-font-smoothing: antialiased;
        }
        .pp-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding-bottom: 36px;
          border-bottom: 1px solid #E0DDD6;
          margin-bottom: 52px;
          gap: 24px;
        }
        .pp-header-left { display: flex; align-items: center; gap: 14px; }
        .pp-brand-mark {
          width: 44px; height: 44px;
          background: #2B5040; color: #fff;
          border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-size: 16px; font-weight: 800; letter-spacing: 0.5px; flex-shrink: 0;
        }
        .pp-brand-name { font-size: 17px; font-weight: 700; letter-spacing: -0.2px; line-height: 1.2; }
        .pp-brand-handle { font-size: 12px; color: #6B6B74; letter-spacing: 0.3px; margin-top: 2px; }
        .pp-brand-creds { font-size: 11px; color: #9B9BA4; letter-spacing: 0.2px; margin-top: 4px; line-height: 1.5; }
        .pp-doc-meta {
          text-align: right; font-size: 11px;
          text-transform: uppercase; letter-spacing: 1.8px; color: #6B6B74; line-height: 1.9;
        }
        .pp-title-block { margin-bottom: 60px; }
        .pp-eyebrow {
          font-size: 11px; text-transform: uppercase; letter-spacing: 2.5px;
          color: #2B5040; font-weight: 600; margin-bottom: 14px;
        }
        .pp-h1 {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 36px; line-height: 1.15; letter-spacing: -0.5px;
          color: #111115; margin-bottom: 20px; font-weight: normal;
        }
        .pp-intro { font-size: 15px; color: #6B6B74; line-height: 1.75; max-width: 540px; }
        .pp-section { margin-bottom: 56px; }
        .pp-h2 {
          font-family: Georgia, 'Times New Roman', serif;
          font-size: 22px; font-weight: normal; color: #111115;
          margin-bottom: 22px; letter-spacing: -0.2px;
        }
        .pp-deliverables { list-style: none; display: flex; flex-direction: column; gap: 10px; padding: 0; }
        .pp-deliverables li {
          display: flex; gap: 16px; align-items: flex-start;
          padding: 18px 20px; background: #F2F0EB; border-radius: 8px;
        }
        .pp-del-icon {
          width: 34px; height: 34px; flex-shrink: 0;
          background: #2B5040; color: #fff; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; margin-top: 1px;
        }
        .pp-del-title { font-weight: 600; font-size: 14px; color: #111115; margin-bottom: 4px; line-height: 1.3; }
        .pp-del-desc { font-size: 13px; color: #6B6B74; line-height: 1.6; }
        .pp-process-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .pp-process-card { padding: 20px; border: 1px solid #E0DDD6; border-radius: 8px; background: #fff; }
        .pp-process-card.match { border-color: #2B5040; background: rgba(43,80,64,0.04); }
        .pp-process-tag {
          display: inline-block; font-size: 10px; text-transform: uppercase;
          letter-spacing: 1.8px; font-weight: 700; color: #6B6B74; margin-bottom: 10px;
        }
        .pp-process-card.match .pp-process-tag { color: #2B5040; }
        .pp-process-card p { font-size: 13.5px; line-height: 1.65; color: #111115; }
        .pp-benefit-main {
          background: #2B5040; color: #fff; border-radius: 10px;
          padding: 28px 28px 24px; margin-bottom: 14px;
        }
        .pp-prog-label {
          font-size: 10px; text-transform: uppercase; letter-spacing: 2px;
          opacity: 0.7; margin-bottom: 10px; font-weight: 600;
        }
        .pp-prog-name {
          font-family: Georgia, serif; font-size: 24px; font-weight: normal;
          margin-bottom: 12px; line-height: 1.2; letter-spacing: -0.2px;
        }
        .pp-prog-value {
          display: inline-block; background: rgba(255,255,255,0.15);
          border-radius: 4px; padding: 4px 10px; font-size: 13px;
          font-variant-numeric: tabular-nums; margin-bottom: 14px;
        }
        .pp-benefit-main p { font-size: 14px; opacity: 0.85; line-height: 1.65; }
        .pp-benefit-note { font-size: 13px; color: #6B6B74; line-height: 1.65; padding: 0 4px; }
        .pp-comp-table { width: 100%; border-collapse: collapse; }
        .pp-comp-table tr { border-bottom: 1px solid #E0DDD6; }
        .pp-comp-table tr:first-child { border-top: 1px solid #E0DDD6; }
        .pp-comp-table td { padding: 15px 0; font-size: 14px; vertical-align: middle; }
        .pp-comp-value {
          text-align: right; font-weight: 700; font-size: 15px;
          color: #B8872C; font-variant-numeric: tabular-nums;
          white-space: nowrap; padding-left: 16px;
        }
        .pp-comp-note { font-size: 12px; color: #6B6B74; margin-top: 10px; padding: 0 2px; }
        .pp-earnings-block {
          margin-top: 24px; background: #FBF5E6;
          border: 1px solid #E4CFA0; border-radius: 10px;
          padding: 28px; text-align: center;
        }
        .pp-earnings-eyebrow {
          font-size: 10px; text-transform: uppercase; letter-spacing: 2.5px;
          color: #B8872C; font-weight: 700; margin-bottom: 14px;
        }
        .pp-earnings-range {
          font-family: Georgia, serif; font-size: 40px; letter-spacing: -1px;
          color: #111115; line-height: 1; margin-bottom: 10px;
          font-variant-numeric: tabular-nums;
        }
        .pp-earnings-sub { font-size: 13px; color: #6B6B74; line-height: 1.6; }
        .pp-growth-card {
          border-left: 3px solid #2B5040; background: #F2F0EB;
          border-radius: 0 8px 8px 0; padding: 20px 22px;
          font-size: 14px; line-height: 1.75; color: #111115;
        }
        .pp-growth-card strong { color: #2B5040; }
        .pp-footer {
          margin-top: 68px; padding-top: 28px; border-top: 1px solid #E0DDD6;
          display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
        }
        .pp-footer-brand { font-size: 13px; color: #6B6B74; line-height: 1.8; }
        .pp-footer-brand strong { display: block; font-size: 14px; color: #111115; font-weight: 700; margin-bottom: 2px; }
        .pp-footer-seal {
          text-align: right; font-size: 10px; text-transform: uppercase;
          letter-spacing: 2px; color: #E0DDD6; line-height: 1.9;
        }
        @media (max-width: 500px) {
          .pp-page { padding: 36px 20px 64px; }
          .pp-h1 { font-size: 28px; }
          .pp-header { flex-direction: column; gap: 12px; }
          .pp-doc-meta { text-align: left; }
          .pp-process-grid { grid-template-columns: 1fr; }
          .pp-earnings-range { font-size: 32px; }
          .pp-footer { flex-direction: column; align-items: flex-start; }
          .pp-footer-seal { text-align: left; }
        }
      `}</style>

      <div className="pp-page">
        <header className="pp-header">
          <div className="pp-header-left">
            <div className="pp-brand-mark">BX</div>
            <div>
              <div className="pp-brand-name">Breno Xavier</div>
              <div className="pp-brand-handle">@brenoxavieer_</div>
              <div className="pp-brand-creds">Ed. Física · Nutrição · Pós Biomecânica · Pós Bases Fisiológicas</div>
            </div>
          </div>
          <div className="pp-doc-meta">Proposta de Parceria<br />Microinfluenciadores</div>
        </header>

        <div className="pp-title-block">
          <div className="pp-eyebrow">Parceria Estratégica</div>
          <h1 className="pp-h1">Uma parceria que faz sentido dos dois lados</h1>
          <p className="pp-intro">Você tem uma audiência que confia em você. Nós temos um programa que transforma o corpo de mulheres 24–45. Abaixo, como isso funciona na prática — sem enrolação.</p>
        </div>

        {/* Deliverables */}
        <div className="pp-section">
          <h2 className="pp-h2">O que esperamos de você</h2>
          <ul className="pp-deliverables">
            <li>
              <div className="pp-del-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div>
                <div className="pp-del-title">3 a 5 menções por semana nos Stories</div>
                <div className="pp-del-desc">Do dia a dia mesmo — sem roteiro, sem formatação especial. Você conta como está sendo o processo de forma natural, do jeito que contaria pra qualquer amiga.</div>
              </div>
            </li>
            <li>
              <div className="pp-del-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </div>
              <div>
                <div className="pp-del-title">2 chamadas semanais com link rastreado nos Stories</div>
                <div className="pp-del-desc">Uma chamada para consultoria (quando as bases estiverem fechadas) e uma chamada para a avaliação gratuita. Cada parceira tem um link único — a gente consegue ver exatamente quantas pessoas chegaram por você.</div>
              </div>
            </li>
            <li>
              <div className="pp-del-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <line x1="3" y1="9" x2="21" y2="9"/>
                  <line x1="9" y1="21" x2="9" y2="9"/>
                </svg>
              </div>
              <div>
                <div className="pp-del-title">1 post semanal em formato colab no feed</div>
                <div className="pp-del-desc">Um conteúdo por semana no feed, no formato parceria. A gente entra junto na produção — você valida antes de publicar.</div>
              </div>
            </li>
          </ul>
        </div>

        {/* Selection */}
        <div className="pp-section">
          <h2 className="pp-h2">Como funciona a seleção</h2>
          <div className="pp-process-grid">
            <div className="pp-process-card match">
              <div className="pp-process-tag">Perfil aprovado</div>
              <p>Se o seu perfil estiver dentro do que a gente busca, entramos com a parceria completa: conteúdo conjunto, link rastreável próprio e todos os benefícios listados aqui.</p>
            </div>
            <div className="pp-process-card">
              <div className="pp-process-tag">Só a marcação</div>
              <p>Se a parceria completa não fizer sentido agora, a marcação com a gente nos seus conteúdos já tem valor. A porta fica aberta conforme a relação evolui.</p>
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="pp-section">
          <h2 className="pp-h2">O que você recebe</h2>
          <div className="pp-benefit-main">
            <div className="pp-prog-label">Benefício principal</div>
            <div className="pp-prog-name">Acompanhamento Anual Completo</div>
            <div className="pp-prog-value">Programa de R$ 2.500 · 12 meses</div>
            <p>Você entra no nosso programa como parceira, na fase de teste. Funcionando bem para os dois lados, a parceria renova todo mês — sem burocracia.</p>
          </div>
          <p className="pp-benefit-note">A parceria só faz sentido se for boa para você também. Por isso a renovação é mensal: ninguém fica presa em algo que não está entregando resultado.</p>
        </div>

        {/* Compensation */}
        <div className="pp-section">
          <h2 className="pp-h2">Remuneração</h2>
          <table className="pp-comp-table">
            <tbody>
              <tr>
                <td>Comissão por assinatura gerada pelo seu link</td>
                <td className="pp-comp-value">10%</td>
              </tr>
              <tr>
                <td>Valor médio por indicação</td>
                <td className="pp-comp-value">R$ 150 — R$ 300</td>
              </tr>
            </tbody>
          </table>
          <p className="pp-comp-note">O valor varia conforme o plano fechado pela indicada.</p>

          <div className="pp-earnings-block">
            <div className="pp-earnings-eyebrow">Potencial mensal com indicações</div>
            <div className="pp-earnings-range">R$ 1.500 — R$ 4.000</div>
            <div className="pp-earnings-sub">Quanto mais a gente pagar pra você, melhor para a parceria.<br />Esse é o nosso interesse em te ver indicando bem.</div>
          </div>
        </div>

        {/* Growth */}
        <div className="pp-section">
          <h2 className="pp-h2">O que vem depois</h2>
          <div className="pp-growth-card">
            Conforme a parceria cresce e os números mostram resultado, a conversa de <strong>remuneração fixa</strong> acontece naturalmente. Os próximos níveis dependem da sua entrega — e a gente valoriza quem entrega de verdade.<br /><br />
            O objetivo é que essa parceria valha cada vez mais para você. Tanto financeiramente quanto em visibilidade e posicionamento.
          </div>
        </div>

        <footer className="pp-footer">
          <div className="pp-footer-brand">
            <strong>Breno Xavier</strong>
            Ed. Física · Nutrição · Pós Biomecânica · Pós Bases Fisiológicas<br />
            @brenoxavieer_ · (31) 9 7000-0106<br />
            www.brenoxavier.com.br
          </div>
          <div className="pp-footer-seal">
            Proposta de parceria<br />
            Confidencial
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PropostaParceria;
