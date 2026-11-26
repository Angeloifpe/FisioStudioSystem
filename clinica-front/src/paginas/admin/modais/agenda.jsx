import { useState, useEffect } from "react";
import { Modal, ModalAcao } from "../../../componentes/Modal";
import { Button, Carregando, ErroBox, Field, InfoBadge } from "../../../componentes/basicos";
import { useApp } from "../../../componentes/contexto";
import { useCarregar } from "../../../hooks/useCarregar";

import { DEL, GET, PATCH, POST } from "../../../servicos/api";
import { MOD } from "../../../utils/constantes";
import { addDias, chaveDia, deChave, fmtDataBR, fmtQuando, hoje, isoLocal } from "../../../utils/datas";

export function NovoHorarioModal({ open, onClose, diaInicial }) {
  const [modalidade, setModalidade] = useState("AVALIACAO");
  const [dia, setDia] = useState(diaInicial && deChave(diaInicial) > hoje() ? diaInicial : chaveDia(addDias(new Date(), 1)));
  const [ini, setIni] = useState("08:00");
  const [dur, setDur] = useState(60);
  const grade = useCarregar(() => (open ? GET("/pilates/grade") : null), [open]);
  useEffect(() => { setDur(modalidade === "FISIOTERAPIA" ? 30 : 60); }, [modalidade]);
  if (!open) return null;
  const [h, m] = ini.split(":").map(Number);
  const inicio = deChave(dia); inicio.setHours(h || 0, m || 0, 0, 0);
  const fim = new Date(inicio.getTime() + dur * 60000);
  const diaSemana = ((deChave(dia).getDay() + 6) % 7) + 1;
  const aulasDoDia = (grade.dados || []).find((g) => g.dia_semana === diaSemana)?.aulas || [];
  return (
    <ModalAcao open onClose={onClose} title="Novo horário" subtitle="Abra um horário na agenda. Ele precisa caber no horário de funcionamento do dia."
      textoBotao="Abrir horário" acao={() => POST("/horarios", { modalidade, inicio: isoLocal(inicio), fim: isoLocal(fim) })}
      sucesso={`Horário aberto: ${MOD[modalidade]} em ${fmtQuando(inicio)}.`}>
      <Field label="Atendimento" required>
        <select value={modalidade} onChange={(e) => setModalidade(e.target.value)}><option value="AVALIACAO">Avaliação</option><option value="FISIOTERAPIA">Fisioterapia</option><option value="PILATES">Pilates</option></select>
      </Field>
      <div className="field-row">
        <Field label="Dia" required><input type="date" min={chaveDia(new Date())} value={dia} onChange={(e) => setDia(e.target.value)} /></Field>
        <Field label="Início" required><input type="time" value={ini} step="300" onChange={(e) => setIni(e.target.value)} /></Field>
        <Field label="Duração" required>
          <select value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[30, 40, 45, 50, 60, 90].map((x) => <option key={x} value={x}>{x} min</option>)}</select>
        </Field>
      </div>
      {modalidade === "PILATES" && <InfoBadge>Aula de pilates só nos horários da grade.{aulasDoDia.length ? ` Neste dia: ${aulasDoDia.map((a) => a.inicio).join(", ")}.` : " Não há aulas na grade neste dia."} Para abrir várias de uma vez, use “Abrir aulas de pilates”.</InfoBadge>}
      {modalidade === "FISIOTERAPIA" && <InfoBadge>Fisioterapia não pode cair nas aulas da grade de pilates. O paciente também pode marcar sozinho só pelo início, sem a clínica abrir horário.</InfoBadge>}
    </ModalAcao>
  );
}

export function AbrirGradeModal({ seg, onClose }) {
  const [de, setDe] = useState(chaveDia(new Date() > seg ? new Date() : seg));
  const [ate, setAte] = useState(chaveDia(addDias(seg, 34)));
  return (
    <ModalAcao open onClose={onClose} title="Abrir aulas de pilates da grade" subtitle="Abre todas as aulas da grade no período (até 120 dias). Pula feriados e o que já existe."
      textoBotao="Abrir aulas" acao={() => POST("/pilates/grade/abrir", { de, ate })} sucesso={(r) => `${r.aulas_abertas} aula(s) aberta(s).`}>
      <div className="field-row">
        <Field label="De" required><input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Field>
        <Field label="Até" required><input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Field>
      </div>
      <InfoBadge>Os alunos com horário fixo entram automaticamente nas aulas novas das suas turmas.</InfoBadge>
    </ModalAcao>
  );
}

export function VagasModal({ h, onClose }) {
  const [cap, setCap] = useState(h.capacidade);
  const ocup = h.capacidade - h.vagas_restantes;
  return (
    <ModalAcao open onClose={onClose} title="Vagas desta aula" subtitle={`Pilates · ${fmtQuando(h.inicio)} · ${ocup} aluno(s) agendado(s)`} textoBotao="Salvar"
      acao={() => PATCH(`/horarios/${h.id}`, { capacidade: Number(cap) })} sucesso="Vagas atualizadas.">
      <Field label="Vagas (1 a 8)" hint={`Não dá para ficar abaixo dos ${ocup} já agendados.`}>
        <select value={cap} onChange={(e) => setCap(e.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n} disabled={n < ocup}>{n}</option>)}</select>
      </Field>
    </ModalAcao>
  );
}

export function FeriadosModal({ onClose }) {
  const lista = useCarregar(() => GET("/feriados"), []);
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("MUNICIPAL");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const { toast } = useApp();
  async function adicionar(e) {
    e.preventDefault(); setErro(null); setEnviando(true);
    try { const r = await POST("/feriados", { data, nome, tipo }); toast(`Feriado cadastrado. ${r.atendimentos_cancelados} atendimento(s) cancelado(s) e avisado(s).`); setData(""); setNome(""); lista.recarregar(); }
    catch (x) { setErro(x); } finally { setEnviando(false); }
  }
  async function remover(f) {
    try { await DEL(`/feriados/${f.data}`); toast("Feriado removido."); lista.recarregar(); } catch (x) { setErro(x); }
  }
  return (
    <Modal open onClose={() => onClose()} title="Feriados" subtitle="Sem atendimento em feriado. Cadastrar um feriado cancela os atendimentos do dia e avisa os pacientes, sem remarcação." wide>
      <form onSubmit={adicionar} style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 18 }}>
        <div className="field-row">
          <Field label="Data" required><input type="date" value={data} onChange={(e) => setData(e.target.value)} required /></Field>
          <Field label="Nome" required><input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: São João" required /></Field>
          <Field label="Tipo"><select value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="MUNICIPAL">Municipal</option><option value="FACULTATIVO">Ponto facultativo</option><option value="ESTADUAL">Estadual</option><option value="NACIONAL">Nacional</option><option value="OUTRO">Outro</option></select></Field>
        </div>
        <ErroBox erro={erro} />
        <div><Button type="submit" size="sm" carregando={enviando}>Cadastrar feriado</Button></div>
      </form>
      {lista.carregando && <Carregando />}
      <div className="lista-simples" style={{ maxHeight: 320, overflowY: "auto" }}>
        {(lista.dados || []).map((f) => (
          <div key={f.data} className="list-row">
            <span style={{ width: 96, fontWeight: 600 }}>{fmtDataBR(f.data)}</span>
            <span style={{ flex: 1 }}>{f.nome} <small className="muted">· {f.tipo.toLowerCase()}</small></span>
            <button className="btn-text" style={{ fontSize: 13 }} onClick={() => remover(f)}>Remover</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function FuncionamentoModal({ onClose }) {
  const d = useCarregar(async () => { const [func, grade, cfg] = await Promise.all([GET("/horarios/funcionamento"), GET("/pilates/grade"), GET("/pilates/config")]); return { func, grade, cfg }; }, []);
  return (
    <Modal open onClose={onClose} title="Funcionamento e grade do pilates" wide>
      {d.carregando && <Carregando />}
      <ErroBox erro={d.erro} />
      {d.dados && <div className="cols" style={{ gap: 20 }}>
        <div className="col">
          <p className="eyebrow" style={{ marginBottom: 8 }}>HORÁRIO DE FUNCIONAMENTO</p>
          {d.dados.func.filter((x) => x.dia_semana <= 5).map((x) => (
            <div key={x.dia_semana} className="summary-row"><span style={{ textTransform: "capitalize" }}>{x.dia}</span><span>{x.aberto ? x.faixas.map((f) => `${f.abre}–${f.fecha}`).join(" · ") : "Fechado"}</span></div>
          ))}
        </div>
        <div className="col">
          <p className="eyebrow" style={{ marginBottom: 8 }}>GRADE DO PILATES</p>
          {d.dados.grade.map((g) => (
            <div key={g.dia_semana} className="summary-row"><span style={{ textTransform: "capitalize" }}>{g.dia}</span><span style={{ textAlign: "right" }}>{g.aulas.length ? g.aulas.map((a) => a.inicio).join(", ") : "—"}</span></div>
          ))}
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Capacidade padrão: {d.dados.cfg.capacidade_padrao_pilates} alunos · aviso de falta: {d.dados.cfg.antecedencia_aviso_falta_min} min</p>
        </div>
      </div>}
    </Modal>
  );
}
