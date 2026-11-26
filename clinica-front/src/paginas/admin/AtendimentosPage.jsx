import { useState } from "react";
import { SeletorDia } from "../../componentes/agendamento";
import { Button, Carregando, Chip, ErroBox, ModChip, StatusChip, Vazio } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell, ChipPrazo, QueixaResumo } from "./AdminShell";
import { DecidirPedidoModal } from "./PedidosPage";
import { AgendarPeloAdminModal, RemarcarAdminModal } from "./modais/agendamento";
import { CancelarAtendimentoModal, CancelarDiaModal, ConcluirAvaliacaoModal, PagamentoModal, RegistroModal } from "./modais/atendimento";
import { GET, POST, qs } from "../../servicos/api";
import { PARA } from "../../utils/constantes";
import { chaveDia, deChave, ehHoje, fmtDiaLongo, fmtHora } from "../../utils/datas";
import { primeiroNome } from "../../utils/formatos";

export function AdminAtendimentosPage({ query }) {
  const dia = query.data || chaveDia(new Date());
  const lista = useCarregar(() => GET(`/agendamentos${qs({ data: dia })}`), [dia]);
  const [modal, setModal] = useState(null); // {tipo, a}
  const [ocultarCancelados, setOcultarCancelados] = useState(true);
  const { toast } = useApp();
  const mudarDia = (d) => ir(`#/admin/atendimentos?data=${chaveDia(d)}`);
  const fechar = (r, ok) => { setModal(null); if (ok) lista.recarregar(); };
  const itens = (lista.dados || []).filter((a) => !ocultarCancelados || a.status !== "CANCELADO");

  async function presenca(a, compareceu) {
    try { await POST(`/agendamentos/${a.id}/presenca`, { compareceu }); toast(compareceu ? `Presença de ${primeiroNome(a.nome_completo)} registrada.` : `Falta de ${primeiroNome(a.nome_completo)} registrada.`); lista.recarregar(); }
    catch (x) { toast(x.message, true); }
  }

  return (
    <AdminShell ativa="atendimentos">
      <div className="page-title">
        <div><h1>Atendimentos</h1><p>{fmtDiaLongo(deChave(dia))}{ehHoje(deChave(dia)) ? " · hoje" : ""}</p></div>
        <div className="actions">
          <Button variant="outline" size="sm" onClick={() => setModal({ tipo: "cancelarDia" })}>Cancelar o dia</Button>
          <Button size="sm" onClick={() => setModal({ tipo: "agendar" })}>Agendar paciente</Button>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <SeletorDia dia={dia} onMudar={mudarDia} />
        <label className="checkbox-row" style={{ alignItems: "center" }}><input type="checkbox" checked={ocultarCancelados} onChange={(e) => setOcultarCancelados(e.target.checked)} /><span>Ocultar cancelados</span></label>
      </div>
      <div className="card">
        <ErroBox erro={lista.erro} onTentar={lista.recarregar} />
        {lista.carregando && <Carregando />}
        {lista.dados && itens.length === 0 && <Vazio>Nenhum atendimento neste dia.</Vazio>}
        {itens.map((a) => {
          const comecou = new Date(a.inicio) <= new Date();
          const ativo = ["AGENDADO", "CANCELAMENTO_SOLICITADO"].includes(a.status);
          return (
            <div key={a.id} className="ag-item">
              <div className="ag-hora">{fmtHora(a.inicio)}<div className="muted" style={{ fontSize: 12, fontWeight: 500 }}>até {fmtHora(a.fim)}</div></div>
              <div className="ag-info">
                <div className="ag-tags">
                  <a href={`#/admin/pacientes/${a.paciente_id}`} style={{ fontWeight: 600, fontSize: 15 }}>{a.nome_completo}</a>
                  {a.avaliacao_para ? <Chip color="amarelo">Avaliação de {PARA[a.avaliacao_para]}</Chip> : <ModChip mod={a.modalidade} experimental={a.experimental} />}
                  {a.reposicao_de && <Chip color="roxo">Remarcação</Chip>}
                  {a.fixo_id && <Chip color="roxo">Fixo</Chip>}
                  {a.experimental && a.pago_em && <Chip color="verde">Pago ({a.forma_pagamento === "PIX" ? "Pix" : "app"})</Chip>}
                  {a.presenca_confirmada_em && a.status === "AGENDADO" && <Chip color="verde">Confirmou presença</Chip>}
                  <StatusChip status={a.status} /><ChipPrazo a={a} />
                </div>
                {a.motivo_cancelamento && <span className="muted" style={{ fontSize: 13 }}>Motivo: {a.motivo_cancelamento}</span>}
                {a.modalidade === "AVALIACAO" && <QueixaResumo compacto queixa={a.queixa_principal} inicio={a.queixa_inicio_sintomas} diagnostico={a.diagnostico_clinico} semDiagnostico={a.sem_diagnostico} />}
                <div className="ag-acoes">
                  {a.status === "AGENDADO" && a.modalidade === "AVALIACAO" && (comecou
                    ? <Button size="sm" onClick={() => setModal({ tipo: "avaliacao", a })}>Concluir avaliação</Button>
                    : <span className="muted" style={{ fontSize: 12 }}>Concluir avaliação depois do início</span>)}
                  {a.modalidade !== "AVALIACAO" && ["AGENDADO", "REALIZADO", "FALTA"].includes(a.status) && (comecou ? <>
                    {a.status !== "REALIZADO" && <Button size="sm" variant="outline" onClick={() => presenca(a, true)}>Presença</Button>}
                    {a.status !== "FALTA" && <Button size="sm" variant="danger-outline" onClick={() => presenca(a, false)}>Falta</Button>}
                  </> : <span className="muted" style={{ fontSize: 12 }}>Presença e falta depois do início</span>)}
                  {a.status === "CANCELAMENTO_SOLICITADO" && <Button size="sm" onClick={() => setModal({ tipo: "decidir", a })}>Responder pedido</Button>}
                  {a.experimental && !a.pago_em && a.status === "AGENDADO" && <Button size="sm" variant="outline" onClick={() => setModal({ tipo: "pagamento", a })}>Registrar pagamento</Button>}
                  {ativo && <Button size="sm" variant="text" onClick={() => setModal({ tipo: "remarcar", a })}>Remarcar</Button>}
                  {a.status === "AGENDADO" && <Button size="sm" variant="text" onClick={() => setModal({ tipo: "cancelar", a })}>Cancelar</Button>}
                  {a.status === "REALIZADO" && a.modalidade !== "AVALIACAO" && <Button size="sm" variant="text" onClick={() => setModal({ tipo: "registro", a })}>Registrar evolução</Button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal?.tipo === "avaliacao" && <ConcluirAvaliacaoModal a={modal.a} onClose={fechar} />}
      {modal?.tipo === "pagamento" && <PagamentoModal a={modal.a} onClose={fechar} />}
      {modal?.tipo === "cancelar" && <CancelarAtendimentoModal a={modal.a} onClose={fechar} />}
      {modal?.tipo === "remarcar" && <RemarcarAdminModal a={modal.a} onClose={fechar} />}
      {modal?.tipo === "registro" && <RegistroModal pacienteId={modal.a.paciente_id} agendamento={modal.a} onClose={fechar} />}
      {modal?.tipo === "decidir" && <DecidirPedidoModal pedido={modal.a} onClose={(ok) => fechar(null, ok)} />}
      {modal?.tipo === "cancelarDia" && <CancelarDiaModal dia={dia} onClose={fechar} />}
      {modal?.tipo === "agendar" && <AgendarPeloAdminModal diaInicial={dia} onClose={fechar} />}
    </AdminShell>
  );
}
