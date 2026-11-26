import { useState } from "react";
import { Button, Carregando, Chip, ErroBox, ModChip, StatusChip, Vazio } from "../../componentes/basicos";
import { ir } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell, ChipPrazo } from "./AdminShell";
import { NovoHorarioModal } from "./modais/agenda";
import { GET, qs } from "../../servicos/api";
import { PARA } from "../../utils/constantes";
import { chaveDia, fmtDiaLongo, fmtHora } from "../../utils/datas";

// ---------- Painel ----------
export function AdminPainelPage() {
  const hojeK = chaveDia(new Date());
  const dados = useCarregar(async () => {
    const [atend, alertas, aguardando, cancelados] = await Promise.all([
      GET(`/agendamentos${qs({ data: hojeK })}`),
      GET("/alertas/faltas-experimental"),
      GET("/pacientes?situacao=AGUARDANDO_AVALIACAO"),
      GET("/agendamentos/cancelamentos-recentes?dias=7"),
    ]);
    return { atend, alertas, aguardando, cancelados };
  }, []);
  const [novoHorario, setNovoHorario] = useState(false);
  const d = dados.dados;
  const atendAtivos = d ? d.atend.filter((a) => a.status !== "CANCELADO") : [];
  const realizados = atendAtivos.filter((a) => a.status === "REALIZADO").length;
  const remarcados = d ? d.cancelados.filter((c) => c.remarcado).length : 0;
  // Agrupa por horário: cada horário lista os pacientes, o tipo de atendimento e o status
  const porHorario = [];
  for (const a of [...atendAtivos].sort((x, y) => new Date(x.inicio) - new Date(y.inicio))) {
    const k = fmtHora(a.inicio);
    let g = porHorario[porHorario.length - 1];
    if (!g || g.hora !== k) { g = { hora: k, fim: fmtHora(a.fim), itens: [] }; porHorario.push(g); }
    g.itens.push(a);
  }

  return (
    <AdminShell ativa="painel">
      <div className="page-title">
        <div><h1>Painel</h1><p>{fmtDiaLongo(new Date())} · {atendAtivos.length} atendimento{atendAtivos.length === 1 ? "" : "s"} hoje</p></div>
        <div className="actions">
          <Button variant="outline" size="sm" onClick={() => ir("#/admin/agenda")}>Ver agenda</Button>
          <Button size="sm" onClick={() => setNovoHorario(true)}>Novo horário</Button>
        </div>
      </div>
      <ErroBox erro={dados.erro} onTentar={dados.recarregar} />
      {!d && dados.carregando && <Carregando />}
      {d && <>
        <div className="metrics-row" style={{ marginBottom: 24 }}>
          <Metrica cor="var(--primaria)" rotulo="Atendimentos hoje" valor={atendAtivos.length} extra={`${realizados} já realizado${realizados === 1 ? "" : "s"}`} href="#/admin/atendimentos" />
          <Metrica cor="#c98a2f" rotulo="Aguardando avaliação" valor={d.aguardando.length} extra="pacientes" href="#/admin/pacientes?situacao=AGUARDANDO_AVALIACAO" />
          <Metrica cor="#c98a2f" rotulo="Cancelamentos (7 dias)" valor={d.cancelados.length} extra={`${d.cancelados.filter((c) => c.cancelado_fora_do_prazo).length} fora do prazo`} href="#/admin/pedidos" />
          <Metrica cor="#6b3a5c" rotulo="Remarcações (7 dias)" valor={remarcados} extra={remarcados === 1 ? "remarcada" : "remarcadas"} href="#/admin/pedidos" />
          <Metrica cor="#8a2a2a" rotulo="Alertas de faltas" valor={d.alertas.length} extra="Aula experimental" />
        </div>
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="secao-titulo"><h3>Atendimentos de hoje</h3><a className="btn-text" href="#/admin/atendimentos">Abrir atendimentos</a></div>
          {porHorario.length === 0 && <Vazio>Nenhum atendimento hoje.</Vazio>}
          <div className="tabela-horarios">
            {porHorario.map((g) => (
              <div key={g.hora} className="hora-grupo">
                <div className="hora-rotulo">{g.hora}<span className="muted">até {g.fim}</span></div>
                <div className="hora-pacientes">
                  {g.itens.map((a) => (
                    <div key={a.id} className="hora-linha">
                      <a className="hora-nome" href={`#/admin/pacientes/${a.paciente_id}`}>{a.nome_completo}</a>
                      <span className="hora-tipo">{a.avaliacao_para ? <Chip color="amarelo">Avaliação de {PARA[a.avaliacao_para]}</Chip> : <ModChip mod={a.modalidade} experimental={a.experimental} />}</span>
                      <span className="hora-status"><StatusChip status={a.status} /><ChipPrazo a={a} /></span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>}
      <NovoHorarioModal open={novoHorario} onClose={(r, ok) => { setNovoHorario(false); if (ok) dados.recarregar(); }} />
    </AdminShell>
  );
}

export function Metrica({ cor, rotulo, valor, extra, href }) {
  const conteudo = <>
    <div className="metric-label"><span style={{ background: cor, width: 8, height: 8, borderRadius: 4, display: "inline-block" }} />{rotulo}</div>
    <div className="metric-value"><strong>{valor}</strong><span>{extra}</span></div>
  </>;
  return href ? <a href={href} className="metric-card metric-link">{conteudo}</a> : <div className="metric-card">{conteudo}</div>;
}
