import { useState } from "react";
import { SeletorDia } from "../../componentes/agendamento";
import { Button, Carregando, Chip, ErroBox, ModChip } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell } from "./AdminShell";
import { AbrirGradeModal, FeriadosModal, FuncionamentoModal, NovoHorarioModal, VagasModal } from "./modais/agenda";
import { GET, PATCH, qs } from "../../servicos/api";
import { DOW_LONGO, addDias, chaveDia, deChave, ehHoje, fmtDataBR, fmtHora, isoLocal, segundaDaSemana, semanaPadrao } from "../../utils/datas";

// ---------- Agenda ----------
export function AdminAgendaPage({ query }) {
  const seg = query.semana ? segundaDaSemana(deChave(query.semana)) : semanaPadrao();
  const semanaK = chaveDia(seg);
  const dados = useCarregar(async () => {
    const [horarios, feriados] = await Promise.all([
      GET(`/horarios${qs({ de: isoLocal(seg), ate: isoLocal(addDias(seg, 6)) })}`),
      GET(`/feriados${qs({ de: semanaK, ate: chaveDia(addDias(seg, 6)) })}`),
    ]);
    return { horarios, feriados };
  }, [semanaK]);
  const [modal, setModal] = useState(null);
  const { toast } = useApp();
  const fechar = (r, ok) => { setModal(null); if (ok) dados.recarregar(); };
  const mudar = (d) => ir(`#/admin/agenda?semana=${chaveDia(segundaDaSemana(d))}`);
  const filtro = query.mod || "";

  async function bloquear(h) {
    try { await PATCH(`/horarios/${h.id}`, { bloqueado: !h.bloqueado }); toast(h.bloqueado ? "Horário desbloqueado." : "Horário bloqueado: ninguém agenda nele."); dados.recarregar(); }
    catch (x) { toast(x.message, true); }
  }

  const dias = [0, 1, 2, 3, 4].map((i) => addDias(seg, i));
  return (
    <AdminShell ativa="agenda">
      <div className="page-title">
        <div><h1>Agenda</h1><p>Semana de {fmtDataBR(semanaK)} a {fmtDataBR(chaveDia(addDias(seg, 4)))}</p></div>
        <div className="actions">
          <Button variant="outline" size="sm" onClick={() => setModal("funcionamento")}>Funcionamento</Button>
          <Button variant="outline" size="sm" onClick={() => setModal("feriados")}>Feriados</Button>
          <Button variant="outline" size="sm" onClick={() => setModal("grade")}>Abrir aulas de pilates</Button>
          <Button size="sm" onClick={() => setModal("novo")}>Novo horário</Button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", marginBottom: 16 }}>
        <SeletorDia dia={semanaK} onMudar={mudar} passo={7} />
        <select className="select-inline" value={filtro} onChange={(e) => ir(`#/admin/agenda?semana=${semanaK}${e.target.value ? `&mod=${e.target.value}` : ""}`)}>
          <option value="">Todas as modalidades</option><option value="AVALIACAO">Avaliação</option><option value="FISIOTERAPIA">Fisioterapia</option><option value="PILATES">Pilates</option>
        </select>
      </div>
      <ErroBox erro={dados.erro} onTentar={dados.recarregar} />
      {!dados.dados && dados.carregando && <Carregando />}
      {dados.dados && (
        <div className="card agenda-card">
          <div className="table-wrap">
            <table className="agenda-tabela">
              <thead>
                <tr><th>Horário</th><th>Atendimento</th><th>Ocupação</th><th>Situação</th><th className="col-acoes">Ações</th></tr>
              </thead>
              {dias.map((d) => {
                const k = chaveDia(d);
                const fer = dados.dados.feriados.find((f) => f.data === k);
                const hs = dados.dados.horarios.filter((h) => chaveDia(h.inicio) === k && (!filtro || h.modalidade === filtro)).sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
                return (
                  <tbody key={k} className={ehHoje(d) ? "dia-hoje" : ""}>
                    <tr className="dia-linha">
                      <td colSpan={5}>
                        <span className="dia-nome">{DOW_LONGO[d.getDay()]}</span>
                        <span className="dia-data">{fmtDataBR(k)}</span>
                        {ehHoje(d) && <Chip color="roxo">hoje</Chip>}
                        {fer && <Chip color="amarelo">Feriado: {fer.nome}</Chip>}
                        <span className="dia-total">{hs.length} horário{hs.length === 1 ? "" : "s"}</span>
                        <button className="btn-text dia-ver" onClick={() => ir(`#/admin/atendimentos?data=${k}`)}>Ver atendimentos</button>
                      </td>
                    </tr>
                    {hs.length === 0 && <tr className="vazio-linha"><td colSpan={5}>{fer ? "Clínica fechada neste dia." : "Nenhum horário aberto."}</td></tr>}
                    {hs.map((h) => {
                      const ocup = h.capacidade - h.vagas_restantes;
                      const lotado = h.vagas_restantes <= 0;
                      const pct = h.capacidade ? Math.round((ocup / h.capacidade) * 100) : 0;
                      return (
                        <tr key={h.id} className={`horario-tr ${h.bloqueado ? "bloqueado" : ""}`}>
                          <td data-label="Horário" className="td-hora"><strong>{fmtHora(h.inicio)}</strong><span className="muted"> – {fmtHora(h.fim)}</span></td>
                          <td data-label="Atendimento"><ModChip mod={h.modalidade} /></td>
                          <td data-label="Ocupação">
                            {h.capacidade > 1
                              ? <div className="ocup"><div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, background: lotado ? "#b44a4a" : undefined }} /></div><span>{ocup}/{h.capacidade}</span></div>
                              : <span>{ocup ? "1/1" : "0/1"}</span>}
                          </td>
                          <td data-label="Situação">
                            {h.bloqueado ? <Chip color="cinza">Bloqueado</Chip> : lotado ? <Chip color="vermelho">{h.capacidade > 1 ? "Lotado" : "Ocupado"}</Chip> : <Chip color="verde">{h.capacidade > 1 ? `${h.vagas_restantes} vaga${h.vagas_restantes === 1 ? "" : "s"}` : "Livre"}</Chip>}
                          </td>
                          <td data-label="Ações" className="col-acoes">
                            <div className="acoes-linha">
                              {h.modalidade === "PILATES" && <button className="btn-text" onClick={() => setModal({ vagas: h })}>Vagas</button>}
                              <button className="btn-text" onClick={() => bloquear(h)}>{h.bloqueado ? "Desbloquear" : "Bloquear"}</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
          </div>
        </div>
      )}
      {modal === "novo" && <NovoHorarioModal open onClose={fechar} diaInicial={semanaK} />}
      {modal === "grade" && <AbrirGradeModal seg={seg} onClose={fechar} />}
      {modal === "feriados" && <FeriadosModal onClose={(r, ok) => { setModal(null); dados.recarregar(); }} />}
      {modal === "funcionamento" && <FuncionamentoModal onClose={() => setModal(null)} />}
      {modal?.vagas && <VagasModal h={modal.vagas} onClose={fechar} />}
    </AdminShell>
  );
}
