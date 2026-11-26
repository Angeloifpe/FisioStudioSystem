import { useState } from "react";
import { ModalAcao } from "../../../componentes/Modal";
import { Field } from "../../../componentes/basicos";
import { PATCH, POST } from "../../../servicos/api";
import { MOD, PARA } from "../../../utils/constantes";
import { chaveDia, deChave, fmtDiaLongo, fmtQuando } from "../../../utils/datas";
import { primeiroNome } from "../../../utils/formatos";

export function ConcluirAvaliacaoModal({ a, onClose }) {
  const [resultado, setResultado] = useState("LIBERADO");
  const [obs, setObs] = useState("");
  const [liberarPara, setLiberarPara] = useState("AMBAS");
  const ambas = a.avaliacao_para === "AMBAS" || !a.avaliacao_para;
  return (
    <ModalAcao open onClose={onClose} title="Concluir avaliação" subtitle={`${a.nome_completo} · avaliação de ${PARA[a.avaliacao_para] || "—"} · ${fmtQuando(a.inicio)}`}
      textoBotao="Concluir avaliação"
      acao={() => POST(`/agendamentos/${a.id}/avaliacao`, { resultado, observacoes: obs.trim() || undefined, liberar_para: ambas && resultado === "LIBERADO" && liberarPara !== "AMBAS" ? liberarPara : undefined })}
      sucesso={`Avaliação concluída. ${primeiroNome(a.nome_completo)} foi avisado(a).`}>
      <Field label="Resultado" required>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[["LIBERADO", `Liberar para ${PARA[a.avaliacao_para] || "a modalidade"}`], ["NAO_LIBERADO", "Não liberar"]].map(([v, t]) => (
            <label key={v} className={`radio-card ${resultado === v ? "selected" : ""}`} style={{ flex: 1, minWidth: 180 }}>
              <input type="radio" style={{ display: "none" }} checked={resultado === v} onChange={() => setResultado(v)} />
              <span className="radio-dot">{resultado === v && <span className="inner" />}</span>{t}
            </label>
          ))}
        </div>
      </Field>
      {ambas && resultado === "LIBERADO" && (
        <Field label="Liberar para">
          <select value={liberarPara} onChange={(e) => setLiberarPara(e.target.value)}>
            <option value="AMBAS">Pilates e fisioterapia</option><option value="PILATES">Só pilates</option><option value="FISIOTERAPIA">Só fisioterapia</option>
          </select>
        </Field>
      )}
      {resultado === "NAO_LIBERADO" && <div className="aviso-box">O paciente mantém o que já tinha e só faz outra avaliação depois que a clínica liberar.</div>}
      <Field label="Observações da avaliação" optional="opcional">
        <textarea maxLength={5000} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: dor lombar leve; indicado pilates 2x por semana" />
      </Field>
    </ModalAcao>
  );
}

export function PagamentoModal({ a, onClose }) {
  const [forma, setForma] = useState("PIX");
  return (
    <ModalAcao open onClose={onClose} title="Registrar pagamento da aula experimental" subtitle={`${a.nome_completo} · ${fmtQuando(a.inicio)}`} textoBotao="Registrar pagamento"
      acao={() => POST(`/agendamentos/${a.id}/pagamento`, { forma })} sucesso="Pagamento registrado.">
      <Field label="Forma de pagamento">
        <select value={forma} onChange={(e) => setForma(e.target.value)}><option value="PIX">Pix</option><option value="APLICATIVO">Aplicativo</option></select>
      </Field>
      <div className="aviso-box">Paga, a aula não pode ser desmarcada pelo paciente e, se ele faltar, conta como dada.</div>
    </ModalAcao>
  );
}

export function CancelarAtendimentoModal({ a, onClose }) {
  const [motivo, setMotivo] = useState("");
  const [liberar, setLiberar] = useState(true);
  return (
    <ModalAcao open onClose={onClose} title="Cancelar atendimento" subtitle={`${a.nome_completo} · ${a.experimental ? "aula experimental" : MOD[a.modalidade]} · ${fmtQuando(a.inicio)}`}
      textoBotao="Cancelar atendimento" variante="danger-outline"
      acao={() => POST(`/agendamentos/${a.id}/cancelar`, { motivo: motivo.trim() || undefined, liberar_remarcacao: liberar })}
      sucesso={`Atendimento cancelado. ${primeiroNome(a.nome_completo)} foi avisado(a).`}>
      <Field label="Motivo (vai na notificação)" optional="opcional">
        <textarea maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: profissional em curso neste dia" />
      </Field>
      <label className="checkbox-row"><input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} /><span>Liberar remarcação para o paciente</span></label>
    </ModalAcao>
  );
}

export function CancelarDiaModal({ dia, onClose }) {
  const [motivo, setMotivo] = useState("");
  const [liberar, setLiberar] = useState(true);
  const [bloquear, setBloquear] = useState(true);
  return (
    <ModalAcao open onClose={onClose} title="Cancelar todos os atendimentos do dia" subtitle={fmtDiaLongo(deChave(dia))}
      textoBotao="Cancelar o dia" variante="danger-outline" desabilitar={motivo.trim().length < 3}
      acao={() => POST("/agendamentos/cancelar-em-lote", { data: dia, motivo: motivo.trim(), liberar_remarcacao: liberar, bloquear_horarios: bloquear })}
      sucesso={(r) => `${r.agendamentos_cancelados.length} atendimento(s) cancelado(s); ${r.pacientes_avisados} paciente(s) avisado(s).`}>
      <Field label="Motivo (cada paciente recebe esta mensagem)" required>
        <textarea maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: Clínica fechada para manutenção elétrica." />
      </Field>
      <label className="checkbox-row"><input type="checkbox" checked={liberar} onChange={(e) => setLiberar(e.target.checked)} /><span>Liberar remarcação</span></label>
      <label className="checkbox-row"><input type="checkbox" checked={bloquear} onChange={(e) => setBloquear(e.target.checked)} /><span>Bloquear os horários do dia (ninguém agenda de novo)</span></label>
      <div className="aviso-box">Para feriado, use Agenda › Feriados (feriado não dá remarcação).</div>
    </ModalAcao>
  );
}

/** Escolhe um horário aberto (lista) ou, na fisioterapia, um início com a duração do paciente. */

export function RegistroModal({ pacienteId, agendamento, registro, onClose }) {
  const [data, setData] = useState(registro?.data_atendimento || (agendamento ? chaveDia(agendamento.inicio) : chaveDia(new Date())));
  const [obs, setObs] = useState(registro?.observacoes || "");
  return (
    <ModalAcao open onClose={onClose} title={registro ? "Editar evolução" : "Registrar evolução"} wide
      subtitle={agendamento ? `${agendamento.nome_completo || ""} · ${MOD[agendamento.modalidade]} de ${fmtQuando(agendamento.inicio)}` : "Registro de atendimento"}
      textoBotao="Salvar" desabilitar={!obs.trim()}
      acao={() => registro
        ? PATCH(`/registros/${registro.id}`, { data_atendimento: data, observacoes: obs.trim() })
        : POST("/registros", { paciente_id: pacienteId, data_atendimento: data, observacoes: obs.trim(), agendamento_id: agendamento?.id })}
      sucesso="Evolução salva.">
      <Field label="Data do atendimento" required><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
      <Field label="Evolução / observações" required>
        <textarea style={{ minHeight: 160 }} maxLength={10000} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: melhora da amplitude do ombro; mantido fortalecimento de manguito." />
      </Field>
    </ModalAcao>
  );
}
