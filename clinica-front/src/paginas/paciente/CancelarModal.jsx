import { useState } from "react";
import { Icon } from "../../componentes/Icon";
import { Modal, ModalAcoes } from "../../componentes/Modal";
import { Button, ErroBox, Field } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { useEnviar } from "./EscolherHorario";
import { cap, descAtendimento, nomeAtendimento, prazoCurto, textoPrazo } from "./regras";
import { SeletorRemarcacao, corpoRemarcar, marcarNovoDepoisDeCancelar } from "./remarcacao";
import { POST } from "../../servicos/api";
import { fmtQuando } from "../../utils/datas";

export function CancelarModal({ a, open, onClose, antecedencia, remarcar = false }) {
  const { toast } = useApp();
  const [etapa, setEtapa] = useState("confirmar"); // confirmar | cancelado
  const [motivo, setMotivo] = useState("");
  const [res, setRes] = useState(null);
  const env = useEnviar();
  const nome = nomeAtendimento(a);
  const pilatesRegular = a.modalidade === "PILATES" && !a.experimental;
  const minutosAte = (new Date(a.inicio) - new Date()) / 60000;
  const noPrazo = minutosAte >= antecedencia;

  const fechar = (mudou) => onClose(!!mudou);
  async function cancelar() {
    const r = await env.enviar(() => POST(`/agendamentos/${a.id}/solicitar-cancelamento`, { motivo: motivo.trim() || undefined }));
    if (r) { setRes(r); setEtapa("cancelado"); }
  }
  async function remarcarPara(x) {
    // Fora do prazo, a pessoa escolhe remarcar sem cancelar antes: troca de uma vez
    const r = await env.enviar(() => POST(`/agendamentos/${a.id}/remarcar-paciente`, corpoRemarcar(x)));
    if (r) { toast(`Remarcado para ${fmtQuando(r.inicio)}. Fora do prazo de ${prazoCurto(antecedencia)}: a ${nome} anterior será cobrada.`); fechar(true); }
  }
  async function marcarNovo(x) {
    const r = await env.enviar(() => marcarNovoDepoisDeCancelar(a, x));
    if (r) { toast(`${cap(nome)} remarcada para ${fmtQuando(r.inicio)}.`); fechar(true); }
  }

  const titulo = etapa === "cancelado" ? `${cap(nome)} cancelada` : remarcar ? `Remarcar ${nome}` : `Cancelar ${nome}`;
  const forPrazo = res ? res.no_prazo === false : !noPrazo;
  const podeRemarcarNova = !pilatesRegular || res?.remarcacao_liberada;

  return (
    <Modal open={open} onClose={() => fechar(etapa === "cancelado")} title={titulo} subtitle={descAtendimento(a)} wide>
      {etapa === "confirmar" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {noPrazo
            ? <div className="ok-box">Você está avisando com mais de {textoPrazo(antecedencia)} de antecedência: {remarcar ? "a aula é cancelada e você escolhe outro horário, " : ""}sem cobrança.{pilatesRegular ? " A vaga fica livre e você ganha uma remarcação." : ""}</div>
            : <div className="aviso-vermelho"><Icon.Alert /> <span><strong>{cap(nome)} cancelada fora do prazo de {prazoCurto(antecedencia)}: o valor da {nome} será cobrado.</strong>{pilatesRegular ? " No pilates, a aula conta como dada e não gera remarcação." : " Se preferir, escolha abaixo um novo horário (a cobrança da consulta cancelada continua)."}</span></div>}
          <Field label="Motivo" optional="opcional">
            <textarea maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: consulta médica no mesmo horário" />
          </Field>
          <ErroBox erro={env.erro} />
          <ModalAcoes>
            <Button type="button" variant="outline" onClick={() => fechar(false)}>Voltar</Button>
            <Button type="button" variant={noPrazo ? "primary" : "danger-outline"} carregando={env.enviando} onClick={cancelar}>
              {noPrazo ? (remarcar ? `Cancelar e escolher novo horário` : `Cancelar ${nome}`) : `Confirmar cancelamento`}
            </Button>
          </ModalAcoes>
          {!noPrazo && !pilatesRegular && (
            <>
              <hr className="divisor" />
              <p style={{ fontWeight: 600 }}>Ou remarque para outro horário</p>
              <SeletorRemarcacao a={a} onEscolher={remarcarPara} enviando={env.enviando} erro={null} textoBotao={`Remarcar ${nome}`}
                aviso={<div className="aviso-vermelho"><Icon.Alert /> <span>Remarcar fora do prazo não elimina a cobrança da {nome} atual.</span></div>} />
            </>
          )}
        </div>
      )}

      {etapa === "cancelado" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {forPrazo
            ? <div className="aviso-vermelho"><Icon.Alert /> <span><strong>{cap(nome)} cancelada fora do prazo de {prazoCurto(antecedencia)}, o valor da {nome} será cobrado.</strong></span></div>
            : <div className="ok-box"><strong>{cap(nome)} cancelada.</strong> Sem cobrança.{pilatesRegular ? " Você ganhou uma remarcação para usar em outra turma." : ""}</div>}
          {podeRemarcarNova
            ? <>
                <p style={{ fontWeight: 600 }}>{forPrazo ? "Quer marcar um novo horário?" : `Quer remarcar a ${nome}?`}</p>
                <SeletorRemarcacao a={a} onEscolher={marcarNovo} enviando={env.enviando} erro={env.erro} textoBotao={`Remarcar ${nome}`} />
              </>
            : <p className="muted" style={{ fontSize: 14 }}>No pilates, a remarcação só vale quando o aviso é feito com {textoPrazo(antecedencia)} de antecedência.</p>}
          <ModalAcoes><Button type="button" variant="outline" onClick={() => fechar(true)}>{podeRemarcarNova ? "Remarcar depois" : "Fechar"}</Button></ModalAcoes>
        </div>
      )}
    </Modal>
  );
}

/** Remarcar sem cancelar antes (fisioterapia, avaliação, experimental): troca de uma vez. */
