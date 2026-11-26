import { useState } from "react";
import { Modal, ModalAcao, ModalAcoes } from "../../componentes/Modal";
import { Button, Carregando, Chip, ErroBox, ModChip, SituacaoChip, StatusChip, Vazio } from "../../componentes/basicos";
import { ir } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell, ChipPrazo, QueixaResumo } from "./AdminShell";
import { AgendarPeloAdminModal } from "./modais/agendamento";
import { RegistroModal } from "./modais/atendimento";
import { EditarPacienteModal, FixarTurmaAdminModal, LiberarAvaliacaoModal, SituacaoModal } from "./modais/paciente";
import { DEL, GET, POST } from "../../servicos/api";
import { PARA } from "../../utils/constantes";
import { DIA_SEMANA_API, chaveDia, fmtDataBR, fmtDiaCurto, fmtHora, fmtQuando } from "../../utils/datas";
import { fmtCPF, fmtTel } from "../../utils/formatos";

export function AdminPacienteDetalhePage({ id }) {
  const det = useCarregar(async () => {
    const [p, hist, fixos] = await Promise.all([GET(`/pacientes/${id}`), GET(`/pacientes/${id}/historico`), GET(`/pilates/fixos?paciente_id=${id}`)]);
    return { p, hist, fixos };
  }, [id]);
  const [modal, setModal] = useState(null);
  const [senha, setSenha] = useState(null);
  const [aba, setAba] = useState("agenda");
  const fechar = (r, ok) => { setModal(null); if (ok) det.recarregar(); };
  const d = det.dados;
  const p = d?.p;
  const agora = new Date();

  return (
    <AdminShell ativa="pacientes">
      <button className="btn-text" style={{ marginBottom: 14 }} onClick={() => ir("#/admin/pacientes")}>‹ Voltar para pacientes</button>
      <ErroBox erro={det.erro} onTentar={det.recarregar} />
      {!d && det.carregando && <Carregando />}
      {p && <>
        <div className="page-title">
          <div>
            <h1 style={{ fontSize: 34 }}>{p.nome_completo}</h1>
            <div className="ag-tags" style={{ marginTop: 8 }}>
              <SituacaoChip situacao={p.situacao} />
              {p.liberado_pilates && <Chip color="roxo">Liberado pilates</Chip>}
              {p.liberado_fisioterapia && <Chip color="azul">Liberado fisioterapia</Chip>}
              {p.nova_avaliacao_bloqueada && <Chip color="amarelo">{p.nova_avaliacao_pedida_em ? "Pediu nova avaliação" : "Nova avaliação bloqueada"}</Chip>}
            </div>
          </div>
          <div className="actions">
            <Button size="sm" onClick={() => setModal("agendar")}>Agendar</Button>
            <Button size="sm" variant="outline" onClick={() => setModal("registro")}>Registrar evolução</Button>
          </div>
        </div>
        <div className="cols">
          <div className="col" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="tabs-sub" style={{ marginBottom: 0 }}>
              {[["agenda", "Agendamentos"], ["evolucao", `Evolução (${d.hist.registros.length})`], ["queixa", "Queixa"], ["avaliacoes", `Avaliações (${p.avaliacoes.length})`], ["situacao", "Situação"]].map(([k, t]) => (
                <button key={k} className={aba === k ? "ativo" : ""} onClick={() => setAba(k)}>{t}</button>
              ))}
            </div>
            {aba === "agenda" && (
              <div className="card">
                {d.hist.agendamentos.length === 0 && <Vazio>Nenhum agendamento.</Vazio>}
                {d.hist.agendamentos.slice(0, 40).map((a) => (
                  <div key={a.id} className="ag-item">
                    <div className="ag-hora">{fmtHora(a.inicio)}<div className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{fmtDataBR(chaveDia(a.inicio))}</div></div>
                    <div className="ag-info">
                      <div className="ag-tags"><ModChip mod={a.modalidade} experimental={a.experimental} />{a.reposicao_de && <Chip color="roxo">Remarcação</Chip>}{a.reposicao_liberada && <Chip color="verde">Remarcação liberada</Chip>}<StatusChip status={a.status} /><ChipPrazo a={a} />{new Date(a.inicio) > agora && <Chip color="lilas">Futuro</Chip>}</div>
                      {a.motivo_cancelamento && <span className="muted" style={{ fontSize: 13 }}>{a.motivo_cancelamento}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {aba === "evolucao" && (
              <div className="card">
                <div className="secao-titulo"><h3>Evolução</h3><Button size="sm" variant="outline" onClick={() => setModal("registro")}>Novo registro</Button></div>
                {d.hist.registros.length === 0 && <Vazio>Nenhum registro ainda.</Vazio>}
                <ListaRegistros registros={d.hist.registros} onEditar={(r) => setModal({ editar: r })} />
              </div>
            )}
            {aba === "queixa" && (
              <div className="card">
                <QueixaResumo queixa={p.queixa?.queixa_principal} inicio={p.queixa?.inicio_sintomas} diagnostico={p.queixa?.diagnostico_clinico} semDiagnostico={p.queixa?.sem_diagnostico} />
                {p.queixa && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Atualizado em {fmtDiaCurto(p.queixa.atualizado_em)}.</p>}
              </div>
            )}
            {aba === "avaliacoes" && (
              <div className="card">
                {p.avaliacoes.length === 0 && <Vazio>Nenhuma avaliação concluída.</Vazio>}
                <div className="lista-simples">
                  {p.avaliacoes.map((av) => (
                    <div key={av.id} style={{ padding: "12px 0" }}>
                      <div className="ag-tags"><Chip color={av.resultado === "LIBERADO" ? "verde" : "vermelho"}>{av.resultado === "LIBERADO" ? "Liberado" : "Não liberado"}</Chip><span style={{ fontWeight: 600 }}>Avaliação de {PARA[av.avaliacao_para] || "—"}</span><span className="muted" style={{ fontSize: 13 }}>{fmtDataBR(chaveDia(av.data_avaliacao))}</span></div>
                      {av.observacoes && <p style={{ fontSize: 14, marginTop: 6 }}>{av.observacoes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {aba === "situacao" && (
              <div className="card">
                {p.mudancas_situacao.length === 0 && <Vazio>Nenhuma mudança de situação.</Vazio>}
                <div className="lista-simples">
                  {p.mudancas_situacao.map((m, i) => (
                    <div key={i} style={{ padding: "12px 0", fontSize: 14 }}>
                      <div className="ag-tags"><SituacaoChip situacao={m.situacao_anterior} /> → <SituacaoChip situacao={m.situacao_nova} /><span className="muted">{fmtDataBR(chaveDia(m.alterado_em))}</span></div>
                      {m.motivo && <p style={{ marginTop: 6 }}>{m.motivo}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="col-side" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card card-sm">
              <div className="secao-titulo" style={{ marginBottom: 10 }}><h3 style={{ fontSize: 20 }}>Dados</h3><Button size="sm" variant="text" onClick={() => setModal("editar")}>Editar</Button></div>
              <dl className="kv">
                <dt>E-mail</dt><dd style={{ wordBreak: "break-all" }}>{p.email}</dd>
                <dt>Telefone</dt><dd>{fmtTel(p.telefone)}</dd>
                <dt>CPF</dt><dd>{fmtCPF(p.cpf)}</dd>
                <dt>Nascimento</dt><dd>{fmtDataBR(p.data_nascimento)}</dd>
                <dt>Endereço</dt><dd>{p.endereco || "—"}</dd>
                <dt>Sessão de fisio</dt><dd>{p.duracao_fisioterapia_min} min</dd>
              </dl>
            </div>
            <div className="card card-sm">
              <div className="secao-titulo" style={{ marginBottom: 10 }}><h3 style={{ fontSize: 20 }}>Pilates fixo</h3>{p.liberado_pilates && d.fixos.length < 2 && <Button size="sm" variant="text" onClick={() => setModal("fixar")}>Fixar turma</Button>}</div>
              {!p.liberado_pilates && <p className="muted" style={{ fontSize: 14 }}>Não liberado para o pilates.</p>}
              {p.liberado_pilates && d.fixos.length === 0 && <p className="muted" style={{ fontSize: 14 }}>Nenhuma turma fixa.</p>}
              <div className="lista-simples">
                {d.fixos.map((f) => (
                  <div key={f.id} className="list-row"><span style={{ flex: 1, fontSize: 14 }}><strong>{DIA_SEMANA_API[f.dia_semana]} às {f.hora}</strong> · {f.aulas_reservadas} aulas</span><Button size="sm" variant="text" onClick={() => setModal({ desfazer: f })}>Remover</Button></div>
                ))}
              </div>
            </div>
            <div className="card card-sm" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 style={{ fontSize: 20, marginBottom: 4 }}>Ações</h3>
              {p.nova_avaliacao_bloqueada && <Button variant="outline" onClick={() => setModal("liberarAvaliacao")}>Liberar nova avaliação</Button>}
              <Button variant="outline" onClick={() => setModal("situacao")}>Mudar situação</Button>
              <Button variant="outline" onClick={() => setModal("senha")}>Criar senha temporária</Button>
            </div>
          </div>
        </div>

        {modal === "agendar" && <AgendarPeloAdminModal pacienteInicial={p} onClose={fechar} />}
        {modal === "registro" && <RegistroModal pacienteId={p.id} onClose={fechar} />}
        {modal?.editar && <RegistroModal pacienteId={p.id} registro={modal.editar} onClose={fechar} />}
        {modal === "editar" && <EditarPacienteModal p={p} onClose={fechar} />}
        {modal === "situacao" && <SituacaoModal p={p} onClose={fechar} />}
        {modal === "liberarAvaliacao" && <LiberarAvaliacaoModal p={p} onClose={fechar} />}
        {modal === "fixar" && <FixarTurmaAdminModal p={p} onClose={fechar} />}
        {modal?.desfazer && (
          <ModalAcao open onClose={fechar} title="Remover turma fixa" subtitle={`${DIA_SEMANA_API[modal.desfazer.dia_semana]} às ${modal.desfazer.hora}`} textoBotao="Remover" variante="danger-outline"
            acao={() => DEL(`/pilates/fixos/${modal.desfazer.id}`)} sucesso={(r) => `Turma removida; ${r.aulas_canceladas} aula(s) futura(s) cancelada(s).`}>
            <p style={{ fontSize: 14 }}>As aulas futuras reservadas por esta turma serão canceladas e o paciente é avisado.</p>
          </ModalAcao>
        )}
        {modal === "senha" && (
          <ModalAcao open onClose={(r, ok) => { setModal(null); if (ok) setSenha(r); }} title="Criar senha temporária" subtitle={p.email} textoBotao="Gerar senha"
            acao={() => POST(`/pacientes/${p.id}/senha-temporaria`, {})}>
            <p style={{ fontSize: 14 }}>A senha atual deixa de valer. O paciente entra com a temporária e cria uma nova no primeiro acesso (validade: 72 h).</p>
          </ModalAcao>
        )}
        <Modal open={!!senha} onClose={() => setSenha(null)} title="Senha temporária criada" subtitle="Ela aparece só agora. Repasse ao paciente.">
          {senha && <>
            <div className="senha-gerada">{senha.senha_temporaria}</div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Login: {senha.email} · válida até {fmtQuando(senha.expira_em)}</p>
            <ModalAcoes><Button onClick={() => { navigator.clipboard && navigator.clipboard.writeText(senha.senha_temporaria); }}>Copiar senha</Button></ModalAcoes>
          </>}
        </Modal>
      </>}
    </AdminShell>
  );
}

export function ListaRegistros({ registros, onEditar }) {
  return (
    <div className="lista-simples">
      {registros.map((r) => (
        <div key={r.id} style={{ padding: "12px 0", display: "flex", gap: 12 }}>
          <div style={{ minWidth: 90, fontWeight: 600, fontSize: 14 }}>{fmtDataBR(r.data_atendimento)}</div>
          <p style={{ flex: 1, fontSize: 14, whiteSpace: "pre-wrap" }}>{r.observacoes || <span className="muted">Sem observações</span>}</p>
          {onEditar && <Button size="sm" variant="text" onClick={() => onEditar(r)}>Editar</Button>}
        </div>
      ))}
    </div>
  );
}
