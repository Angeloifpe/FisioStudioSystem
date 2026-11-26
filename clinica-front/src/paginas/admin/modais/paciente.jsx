import { useState } from "react";
import { ModalAcao } from "../../../componentes/Modal";
import { Carregando, Field } from "../../../componentes/basicos";
import { useCarregar } from "../../../hooks/useCarregar";
import { GET, PATCH, POST } from "../../../servicos/api";
import { SITUACAO } from "../../../utils/constantes";
import { DIA_SEMANA_API } from "../../../utils/datas";

export function EditarPacienteModal({ p, onClose }) {
  const [f, setF] = useState({ nome_completo: p.nome_completo, telefone: p.telefone, endereco: p.endereco || "", data_nascimento: p.data_nascimento, duracao_fisioterapia_min: p.duracao_fisioterapia_min });
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <ModalAcao open onClose={onClose} title="Editar dados do paciente" wide textoBotao="Salvar"
      acao={() => PATCH(`/pacientes/${p.id}`, { nome_completo: f.nome_completo.trim(), telefone: f.telefone.replace(/\D/g, "") || f.telefone, endereco: f.endereco.trim() || null, data_nascimento: f.data_nascimento, duracao_fisioterapia_min: Number(f.duracao_fisioterapia_min) })}
      sucesso="Dados atualizados.">
      <Field label="Nome completo" required><input value={f.nome_completo} onChange={up("nome_completo")} /></Field>
      <div className="field-row">
        <Field label="Telefone" required><input value={f.telefone} onChange={up("telefone")} /></Field>
        <Field label="Nascimento" required><input type="date" value={f.data_nascimento} onChange={up("data_nascimento")} /></Field>
      </div>
      <Field label="Endereço" optional="opcional"><input value={f.endereco} onChange={up("endereco")} /></Field>
      <Field label="Duração da sessão de fisioterapia" hint="De 30 a 60 minutos. O paciente escolhe só o início.">
        <select value={f.duracao_fisioterapia_min} onChange={up("duracao_fisioterapia_min")}>{[30, 35, 40, 45, 50, 55, 60].map((m) => <option key={m} value={m}>{m} min</option>)}</select>
      </Field>
    </ModalAcao>
  );
}

export function SituacaoModal({ p, onClose }) {
  const [situacao, setSituacao] = useState(p.situacao === "ALTA" || p.situacao === "INTERROMPIDO" ? "AGUARDANDO_AVALIACAO" : "ALTA");
  const [motivo, setMotivo] = useState("");
  const avisos = {
    AGUARDANDO_AVALIACAO: "Reabre o cadastro: zera as liberações e o paciente volta a aguardar avaliação.",
    ALTA: "Dá alta: cancela os agendamentos futuros e encerra os horários fixos de pilates.",
    INTERROMPIDO: "Interrompe o tratamento: cancela os agendamentos futuros e encerra os horários fixos.",
  };
  return (
    <ModalAcao open onClose={onClose} title="Mudar situação" subtitle={`${p.nome_completo} · hoje: ${SITUACAO[p.situacao]?.[0]}`} textoBotao="Confirmar" variante={situacao === "AGUARDANDO_AVALIACAO" ? "primary" : "danger-outline"}
      acao={() => POST(`/pacientes/${p.id}/situacao`, { situacao, motivo: motivo.trim() || undefined })} sucesso="Situação atualizada. O paciente foi avisado.">
      <Field label="Nova situação">
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="AGUARDANDO_AVALIACAO">Reabrir (aguardando avaliação)</option><option value="ALTA">Alta</option><option value="INTERROMPIDO">Interrompido</option>
        </select>
      </Field>
      <div className="aviso-box">{avisos[situacao]}</div>
      <Field label="Motivo" optional="opcional"><textarea maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </ModalAcao>
  );
}

export function LiberarAvaliacaoModal({ p, onClose }) {
  const [motivo, setMotivo] = useState("");
  return (
    <ModalAcao open onClose={onClose} title="Liberar nova avaliação" subtitle={p.nome_completo} textoBotao="Liberar"
      acao={() => POST(`/pacientes/${p.id}/liberar-nova-avaliacao`, { motivo: motivo.trim() || undefined })} sucesso="Nova avaliação liberada. O paciente foi avisado.">
      <p style={{ fontSize: 14 }}>O paciente poderá marcar uma nova avaliação (de qualquer modalidade) pelo app.</p>
      <Field label="Mensagem para o paciente" optional="opcional"><textarea maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Field>
    </ModalAcao>
  );
}

export function FixarTurmaAdminModal({ p, onClose }) {
  const turmas = useCarregar(() => GET("/pilates/turmas"), []);
  const [sel, setSel] = useState("");
  const t = (turmas.dados || []).find((x) => `${x.dia_semana}|${x.hora}` === sel);
  return (
    <ModalAcao open onClose={onClose} title="Fixar turma de pilates" subtitle={p.nome_completo} textoBotao="Fixar turma" desabilitar={!t}
      acao={() => POST("/pilates/fixos", { paciente_id: p.id, dia_semana: t.dia_semana, hora: t.hora })} sucesso={(r) => `Turma fixada; ${r.aulas_reservadas} aula(s) reservada(s).`}>
      {turmas.carregando ? <Carregando /> : (
        <Field label="Turma" hint="Até 2 turmas por aluno, em dias diferentes.">
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="">Escolha…</option>
            {(turmas.dados || []).map((x) => <option key={`${x.dia_semana}|${x.hora}`} value={`${x.dia_semana}|${x.hora}`}>{DIA_SEMANA_API[x.dia_semana]} às {x.hora} · {x.alunos_fixos} fixo(s){x.menor_vaga < 1 ? " · alguma aula cheia" : ""}</option>)}
          </select>
        </Field>
      )}
    </ModalAcao>
  );
}
