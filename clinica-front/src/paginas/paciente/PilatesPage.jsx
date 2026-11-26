import { useState } from "react";
import { ModalAcao } from "../../componentes/Modal";
import { Button, Carregando, Chip, ErroBox, InfoBadge, Vazio } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { PacienteShell } from "./PacienteShell";
import { DEL, GET, POST } from "../../servicos/api";
import { DIA_SEMANA_API } from "../../utils/datas";

// ---------- Pilates: turmas fixas ----------
export function PilatesPage() {
  const { me, toast, recarregarMe } = useApp();
  const turmas = useCarregar(() => GET("/pilates/turmas"), []);
  const fixos = useCarregar(() => GET("/pilates/fixos"), []);
  const [escolha, setEscolha] = useState(null);
  const [remover, setRemover] = useState(null);
  const meusFixos = fixos.dados || [];
  const diasComFixo = new Set(meusFixos.map((f) => f.dia_semana));
  const porDia = [1, 2, 3, 4, 5].map((d) => ({ d, lista: (turmas.dados || []).filter((t) => t.dia_semana === d) })).filter((x) => x.lista.length);

  if (me && !me.liberado_pilates) {
    return <PacienteShell ativa="pilates"><div className="card" style={{ maxWidth: 620 }}><h3>Você ainda não foi liberado(a) para o pilates</h3><p className="muted" style={{ margin: "8px 0 16px" }}>Faça a avaliação de pilates primeiro.</p><Button variant="outline" onClick={() => ir("#/paciente")}>Voltar</Button></div></PacienteShell>;
  }
  return (
    <PacienteShell ativa="pilates">
      <div className="page-title"><div><h1>Meus horários de <span style={{ color: "var(--primaria)" }}>pilates</span></h1><p>Escolha até 2 turmas, em dias diferentes. A vaga fica reservada em todas as aulas da turma.</p></div></div>
      <div className="cols">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <div className="secao-titulo"><h3>Turmas disponíveis</h3>{meusFixos.length >= 2 && <Chip color="amarelo">Limite de 2 turmas atingido</Chip>}</div>
            <ErroBox erro={turmas.erro} onTentar={turmas.recarregar} />
            {turmas.carregando && <Carregando />}
            {turmas.dados && porDia.length === 0 && <Vazio>Nenhuma turma com aulas abertas no momento.</Vazio>}
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {porDia.map(({ d, lista }) => (
                <div key={d}>
                  <p className="slot-section-label">{DIA_SEMANA_API[d]}-feira{diasComFixo.has(d) ? " · você já tem turma neste dia" : ""}</p>
                  <div className="grade-cards">
                    {lista.map((t) => {
                      const minha = meusFixos.some((f) => f.dia_semana === d && f.hora === t.hora);
                      const bloqueada = !minha && (diasComFixo.has(d) || meusFixos.length >= 2);
                      return (
                        <button key={t.hora} className={`turma-btn ${minha ? "selected" : ""}`} disabled={bloqueada || minha} onClick={() => setEscolha(t)}>
                          <span><strong>{t.hora}</strong><br /><small>{t.alunos_fixos} aluno{t.alunos_fixos === 1 ? "" : "s"} fixo{t.alunos_fixos === 1 ? "" : "s"}</small></span>
                          <small>{minha ? "Sua turma" : t.menor_vaga < 1 ? "Alguma aula cheia" : `mín. ${t.menor_vaga} vaga${t.menor_vaga === 1 ? "" : "s"}`}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-side" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <h3 style={{ fontSize: 20, marginBottom: 12 }}>Minhas turmas</h3>
            {fixos.carregando && <Carregando />}
            {fixos.dados && meusFixos.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Você ainda não escolheu turmas.</p>}
            <div className="lista-simples">
              {meusFixos.map((f) => (
                <div key={f.id} className="list-row">
                  <div style={{ flex: 1 }}><strong>{DIA_SEMANA_API[f.dia_semana]} às {f.hora}</strong><br /><small className="muted">{f.aulas_reservadas} aulas reservadas</small></div>
                  <Button size="sm" variant="text" onClick={() => setRemover(f)}>Deixar</Button>
                </div>
              ))}
            </div>
          </div>
          <InfoBadge>Até 2 aulas por semana. Fora das suas turmas, você só marca aula usando uma remarcação. Se uma aula estiver cheia ou passar do limite da semana, ela é pulada.</InfoBadge>
        </div>
      </div>

      <ModalAcao open={!!escolha} onClose={(r, ok) => { setEscolha(null); if (ok) { fixos.recarregar(); turmas.recarregar(); recarregarMe(); } }}
        title="Fixar turma" textoBotao="Fixar esta turma"
        subtitle={escolha ? `${DIA_SEMANA_API[escolha.dia_semana]}-feira às ${escolha.hora}` : ""}
        acao={() => POST("/pilates/fixos", { dia_semana: escolha.dia_semana, hora: escolha.hora })}
        sucesso={(r) => `Turma fixada. ${r.aulas_reservadas} aula${r.aulas_reservadas === 1 ? "" : "s"} reservada${r.aulas_reservadas === 1 ? "" : "s"} para você.`}>
        <p style={{ fontSize: 14 }}>A vaga fica reservada toda semana nessa turma. Aulas avulsas de pilates que você já tinha marcado são substituídas pelas aulas da turma.</p>
      </ModalAcao>
      <ModalAcao open={!!remover} onClose={(r, ok) => { setRemover(null); if (ok) { fixos.recarregar(); turmas.recarregar(); } }}
        title="Deixar a turma" textoBotao="Deixar a turma" variante="danger-outline"
        subtitle={remover ? `${DIA_SEMANA_API[remover.dia_semana]} às ${remover.hora}` : ""}
        acao={() => DEL(`/pilates/fixos/${remover.id}`)}
        sucesso={(r) => `Você saiu da turma. ${r.aulas_canceladas} aula(s) futura(s) cancelada(s).`}>
        <p style={{ fontSize: 14 }}>As próximas aulas reservadas por esta turma serão canceladas.</p>
      </ModalAcao>
    </PacienteShell>
  );
}
