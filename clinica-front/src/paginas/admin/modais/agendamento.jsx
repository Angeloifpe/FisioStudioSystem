import { useState, useEffect } from "react";
import { ModalAcao } from "../../../componentes/Modal";
import { Carregando, Chip, ErroBox, Field, SituacaoChip } from "../../../componentes/basicos";
import { useCarregar } from "../../../hooks/useCarregar";
import { useOpcoesFisio } from "../../paciente/FisioterapiaPage";
import { GET, POST, qs } from "../../../servicos/api";
import { MOD } from "../../../utils/constantes";
import { addDias, chaveDia, deChave, fmtHora, fmtQuando, hoje, isoLocal } from "../../../utils/datas";
import { primeiroNome } from "../../../utils/formatos";

export function SeletorHorarioAdmin({ modalidade, pacienteId, excluirId, diaInicial, valor, onChange }) {
  const [dia, setDia] = useState(diaInicial && deChave(diaInicial) >= hoje() ? diaInicial : chaveDia(new Date()));
  const fisio = modalidade === "FISIOTERAPIA";
  const op = useOpcoesFisio(fisio && pacienteId ? dia : null, pacienteId);
  const dados = useCarregar(() => (!modalidade || fisio ? null : GET(`/horarios${qs({ modalidade, de: isoLocal(new Date()), ate: isoLocal(addDias(new Date(), 45)) })}`)), [modalidade]);
  useEffect(() => { onChange(null); }, [modalidade, dia]);
  if (!modalidade) return null;
  if (fisio) {
    const lista = (op.dados?.itens || []).filter((x) => x.horario_id !== excluirId);
    return (
      <>
        <Field label="Dia"><input type="date" min={chaveDia(new Date())} value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} /></Field>
        {!pacienteId && <p className="muted" style={{ fontSize: 13 }}>Escolha o paciente para ver os horários livres.</p>}
        {pacienteId && op.carregando && <Carregando />}
        <ErroBox erro={op.erro} />
        {pacienteId && op.dados && (lista.length ? (
          <Field label={`Horário (sessão do paciente: ${op.dados.duracao} min)`} required>
            <div className="slot-grid">{lista.map((x) => (
              <button type="button" key={x.chave} className={`slot-btn ${valor?.chave === x.chave ? "selected" : ""}`}
                onClick={() => onChange(x.tipo === "horario" ? { chave: x.chave, horario_id: x.horario_id, rotulo: fmtQuando(x.inicio) } : { chave: x.chave, inicio: x.inicio, rotulo: fmtQuando(x.inicio) })}>
                {fmtHora(x.inicio)}{x.extra && <small className="slot-extra">{x.extra}</small>}
              </button>))}
            </div>
          </Field>
        ) : <div className="aviso-box">Sem horários livres de fisioterapia neste dia.</div>)}
      </>
    );
  }
  const livres = (dados.dados || []).filter((h) => !h.bloqueado && h.vagas_restantes > 0 && h.id !== excluirId && new Date(h.inicio) > new Date());
  return (
    <Field label="Horário" required hint={dados.dados && !livres.length ? "Nenhum horário livre nos próximos 45 dias. Abra horários na Agenda." : null}>
      {dados.carregando ? <Carregando /> : (
        <select value={valor?.horario_id || ""} onChange={(e) => { const h = livres.find((x) => x.id === e.target.value); onChange(h ? { horario_id: h.id, rotulo: fmtQuando(h.inicio) } : null); }}>
          <option value="">Escolha…</option>
          {livres.map((h) => <option key={h.id} value={h.id}>{fmtQuando(h.inicio)}{h.capacidade > 1 ? ` · ${h.vagas_restantes} vaga(s)` : ""}</option>)}
        </select>
      )}
      <ErroBox erro={dados.erro} />
    </Field>
  );
}

export function RemarcarAdminModal({ a, onClose }) {
  const [escolha, setEscolha] = useState(null);
  return (
    <ModalAcao open onClose={onClose} title="Remarcar atendimento" subtitle={`${a.nome_completo} · ${MOD[a.modalidade]} de ${fmtQuando(a.inicio)} (mesma modalidade)`}
      textoBotao="Remarcar" desabilitar={!escolha}
      acao={() => POST(`/agendamentos/${a.id}/remarcar`, escolha.inicio ? { inicio: escolha.inicio } : { horario_id: escolha.horario_id })}
      sucesso={() => `Remarcado para ${escolha.rotulo}. ${primeiroNome(a.nome_completo)} foi avisado(a).`}>
      <SeletorHorarioAdmin modalidade={a.modalidade} pacienteId={a.paciente_id} excluirId={a.horario_id} diaInicial={chaveDia(a.inicio)} valor={escolha} onChange={setEscolha} />
    </ModalAcao>
  );
}

export function AgendarPeloAdminModal({ diaInicial, pacienteInicial, onClose }) {
  const pacientes = useCarregar(() => GET("/pacientes"), []);
  const [pacienteId, setPacienteId] = useState(pacienteInicial?.id || "");
  const [modalidade, setModalidade] = useState("");
  const [para, setPara] = useState("PILATES");
  const [experimental, setExperimental] = useState(false);
  const [escolha, setEscolha] = useState(null);
  const p = (pacientes.dados || []).find((x) => x.id === pacienteId) || pacienteInicial;
  function acao() {
    if (modalidade === "FISIOTERAPIA" && escolha.inicio) return POST("/agendamentos/fisioterapia/pela-clinica", { paciente_id: pacienteId, inicio: escolha.inicio });
    return POST("/agendamentos/pela-clinica", { paciente_id: pacienteId, horario_id: escolha.horario_id, experimental: modalidade === "PILATES" && experimental, avaliacao_para: modalidade === "AVALIACAO" ? para : undefined });
  }
  return (
    <ModalAcao open onClose={onClose} title="Agendar pelo paciente" subtitle="As regras de vagas e liberação valem igual; o paciente é avisado." wide
      textoBotao="Agendar" desabilitar={!pacienteId || !modalidade || !escolha} acao={acao}
      sucesso={() => `Agendado para ${escolha.rotulo}.`}>
      <div className="field-row">
        <Field label="Paciente" required>
          {pacienteInicial ? <input value={pacienteInicial.nome_completo} disabled /> : (
            <select value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
              <option value="">Escolha…</option>
              {(pacientes.dados || []).filter((x) => !["ALTA", "INTERROMPIDO"].includes(x.situacao)).map((x) => <option key={x.id} value={x.id}>{x.nome_completo}</option>)}
            </select>
          )}
        </Field>
        <Field label="Atendimento" required>
          <select value={modalidade} onChange={(e) => { setModalidade(e.target.value); setEscolha(null); }}>
            <option value="">Escolha…</option>
            <option value="AVALIACAO">Avaliação</option>
            <option value="PILATES">Pilates</option>
            <option value="FISIOTERAPIA">Fisioterapia</option>
          </select>
        </Field>
      </div>
      {p && <div className="ag-tags"><SituacaoChip situacao={p.situacao} />{p.liberado_pilates && <Chip color="verde">Liberado pilates</Chip>}{p.liberado_fisioterapia && <Chip color="verde">Liberado fisioterapia</Chip>}</div>}
      {modalidade === "AVALIACAO" && (
        <Field label="Avaliação para"><select value={para} onChange={(e) => setPara(e.target.value)}><option value="PILATES">Pilates</option><option value="FISIOTERAPIA">Fisioterapia</option></select></Field>
      )}
      {modalidade === "PILATES" && <label className="checkbox-row"><input type="checkbox" checked={experimental} onChange={(e) => setExperimental(e.target.checked)} /><span>Aula experimental (paciente ainda não liberado para o pilates)</span></label>}
      <SeletorHorarioAdmin modalidade={modalidade} pacienteId={pacienteId} diaInicial={diaInicial} valor={escolha} onChange={setEscolha} />
    </ModalAcao>
  );
}
