import { useState, useEffect } from "react";
import { Modal, ModalAcoes } from "../../componentes/Modal";
import { Button, Carregando, Chip, ErroBox, ModChip, Vazio } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell, ChipPrazo } from "./AdminShell";
import { GET, POST } from "../../servicos/api";
import { MOD, PARA } from "../../utils/constantes";
import { fmtDiaLongo, fmtHora, fmtQuando, fmtRelativo } from "../../utils/datas";
import { primeiroNome } from "../../utils/formatos";

// ---------- Pedidos de cancelamento ----------
export function DecidirPedidoModal({ pedido, onClose }) {
  const { toast } = useApp();
  const [liberar, setLiberar] = useState(true);
  const [enviando, setEnviando] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => { setErro(null); setLiberar(true); }, [pedido?.id]);
  if (!pedido) return null;
  // A API só libera reposição ao aprovar cancelamento de aula de pilates regular
  const podeLiberar = pedido.modalidade === "PILATES" && !pedido.experimental;
  async function decidir(aprovar) {
    setEnviando(aprovar ? "s" : "n"); setErro(null);
    try {
      await POST(`/agendamentos/${pedido.id}/decidir-cancelamento`, { aprovar, liberar_reposicao: aprovar && podeLiberar && liberar });
      toast(aprovar ? `Cancelamento aprovado${podeLiberar && liberar ? " com remarcação liberada" : ""}. ${primeiroNome(pedido.nome_completo)} foi avisado(a).` : `Pedido recusado. ${primeiroNome(pedido.nome_completo)} foi avisado(a).`);
      onClose(true);
    } catch (x) { setErro(x); } finally { setEnviando(null); }
  }
  return (
    <Modal open onClose={() => onClose(false)} title="Pedido de cancelamento" subtitle={`${pedido.nome_completo} · pedido em ${fmtQuando(pedido.cancelamento_solicitado_em)}`}>
      <dl className="kv" style={{ marginBottom: 16 }}>
        <dt>Atendimento</dt><dd>{pedido.experimental ? "Aula experimental" : MOD[pedido.modalidade]}{pedido.avaliacao_para ? ` de ${PARA[pedido.avaliacao_para]}` : ""}</dd>
        <dt>Horário</dt><dd>{fmtDiaLongo(pedido.inicio)} · {fmtHora(pedido.inicio)}</dd>
        <dt>Motivo</dt><dd>{pedido.motivo_cancelamento || "Não informado"}</dd>
      </dl>
      {podeLiberar ? (
        <label className="checkbox-row" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} />
          <span>Ao aprovar, liberar reposição (o aluno escolhe outra aula de pilates)</span>
        </label>
      ) : (
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>Para o paciente remarcar depois, use “Remarcar” em Atendimentos ou cancele pela clínica liberando a remarcação.</p>
      )}
      <ErroBox erro={erro} />
      <ModalAcoes>
        <Button variant="danger-outline" carregando={enviando === "n"} disabled={!!enviando} onClick={() => decidir(false)}>Recusar</Button>
        <Button carregando={enviando === "s"} disabled={!!enviando} onClick={() => decidir(true)}>Aprovar cancelamento</Button>
      </ModalAcoes>
    </Modal>
  );
}

export function AdminPedidosPage() {
  const pedidos = useCarregar(() => GET("/agendamentos/cancelamentos-pendentes"), []);
  const recentes = useCarregar(() => GET("/agendamentos/cancelamentos-recentes?dias=30"), []);
  const [sel, setSel] = useState(null);
  const [filtro, setFiltro] = useState("todos");
  const lista = (recentes.dados || []).filter((c) => filtro === "todos" || (filtro === "fora" ? c.cancelado_fora_do_prazo : !c.cancelado_fora_do_prazo));
  return (
    <AdminShell ativa="pedidos">
      <div className="page-title"><div><h1>Pedidos</h1><p>Cancelamentos e remarcações feitos pelos pacientes nos últimos 30 dias, com a marca de dentro ou fora do prazo. Fora do prazo, a consulta é cobrada.</p></div></div>

      {pedidos.dados && pedidos.dados.length > 0 && (
        <div className="card table-wrap" style={{ marginBottom: 20 }}>
          <div className="secao-titulo"><h3 style={{ fontSize: 20 }}>Pedidos esperando a sua decisão</h3><Chip color="amarelo">{pedidos.dados.length}</Chip></div>
          <table className="table">
            <thead><tr><th>Paciente</th><th>Atendimento</th><th>Horário</th><th>Motivo</th><th>Pedido em</th><th></th></tr></thead>
            <tbody>
              {pedidos.dados.map((p) => (
                <tr key={p.id}>
                  <td data-label="Paciente" style={{ fontWeight: 600 }}>{p.nome_completo}</td>
                  <td data-label="Atendimento"><ModChip mod={p.modalidade} experimental={p.experimental} /></td>
                  <td data-label="Horário">{fmtQuando(p.inicio)}</td>
                  <td data-label="Motivo">{p.motivo_cancelamento || "—"}</td>
                  <td data-label="Pedido em">{fmtRelativo(p.cancelamento_solicitado_em)}</td>
                  <td data-label="Ação"><Button variant="outline" size="sm" onClick={() => setSel(p)}>Analisar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tabs-sub">
        {[["todos", "Todos"], ["fora", "Fora do prazo"], ["no", "Dentro do prazo"]].map(([k, t]) => (
          <button key={k} className={filtro === k ? "ativo" : ""} onClick={() => setFiltro(k)}>{t}</button>
        ))}
      </div>
      <div className="card table-wrap">
        <ErroBox erro={recentes.erro} onTentar={recentes.recarregar} />
        {recentes.carregando && <Carregando />}
        {recentes.dados && lista.length === 0 && <Vazio>Nenhum cancelamento neste filtro.</Vazio>}
        {lista.length > 0 && (
          <table className="table">
            <thead><tr><th>Paciente</th><th>Atendimento</th><th>Horário cancelado</th><th>Prazo</th><th>Remarcação</th><th>Motivo</th><th>Quando</th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td data-label="Paciente" style={{ fontWeight: 600 }}>{c.nome_completo}</td>
                  <td data-label="Atendimento">{c.avaliacao_para ? <Chip color="amarelo">Avaliação de {PARA[c.avaliacao_para]}</Chip> : <ModChip mod={c.modalidade} experimental={c.experimental} />}</td>
                  <td data-label="Horário cancelado">{fmtQuando(c.inicio)}</td>
                  <td data-label="Prazo"><ChipPrazo a={c} /></td>
                  <td data-label="Remarcação">{c.remarcado && c.novo_inicio ? <Chip color="roxo">{fmtQuando(c.novo_inicio)}</Chip> : <span className="muted">Não remarcou</span>}</td>
                  <td data-label="Motivo">{c.motivo_cancelamento || "—"}</td>
                  <td data-label="Quando">{fmtRelativo(c.cancelamento_solicitado_em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <DecidirPedidoModal pedido={sel} onClose={(ok) => { setSel(null); if (ok) pedidos.recarregar(); }} />
    </AdminShell>
  );
}

// ---------- Atendimentos do dia ----------
/** Resumo da queixa que o paciente contou (para a profissional se preparar). */
