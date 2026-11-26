import { useState } from "react";
import { Button, Chip, ModChip, StatusChip } from "../../componentes/basicos";
import { CancelarModal } from "./CancelarModal";
import { RemarcarModal } from "./RemarcarModal";
import { nomeAtendimento } from "./regras";
import { PARA } from "../../utils/constantes";
import { fmtDiaCurto, fmtDiaLongo, fmtHora } from "../../utils/datas";

// ---------- Ações de um atendimento do paciente ----------
export function AcoesAtendimentoPaciente({ a, onMudou, antecedencia = 1440 }) {
  const [modal, setModal] = useState(null);
  const futuro = new Date(a.inicio) > new Date();
  const emAndamento = new Date(a.fim) > new Date();
  const pilatesRegular = a.modalidade === "PILATES" && !a.experimental;
  const nome = nomeAtendimento(a);
  const pago = a.experimental && a.pago_em;
  const noPrazo = (new Date(a.inicio) - new Date()) / 60000 >= antecedencia;
  const fechar = (mudou) => { setModal(null); if (mudou && onMudou) onMudou(); };
  const podeRemarcar = futuro && !pago && (!pilatesRegular || noPrazo);

  return (
    <div className="ag-acoes">
      {a.status === "AGENDADO" && podeRemarcar && (
        <Button size="sm" variant="outline" onClick={() => setModal(pilatesRegular ? "remarcar-pilates" : "remarcar")}>Remarcar {nome}</Button>
      )}
      {a.status === "AGENDADO" && emAndamento && !pago && (
        <Button size="sm" variant="text" onClick={() => setModal("cancelar")}>Cancelar {nome}</Button>
      )}
      {pago && a.status === "AGENDADO" && <span className="muted" style={{ fontSize: 12 }}>Aula paga: não pode ser desmarcada</span>}
      {modal === "cancelar" && <CancelarModal a={a} open onClose={fechar} antecedencia={antecedencia} />}
      {modal === "remarcar-pilates" && <CancelarModal a={a} open onClose={fechar} antecedencia={antecedencia} remarcar />}
      {modal === "remarcar" && <RemarcarModal a={a} open onClose={fechar} antecedencia={antecedencia} />}
    </div>
  );
}

export function ItemAtendimento({ a, acoes }) {
  return (
    <div className="ag-item">
      <div className="ag-hora">{fmtHora(a.inicio)}<div className="muted" style={{ fontSize: 12, fontWeight: 500 }}>{fmtDiaCurto(a.inicio)}</div></div>
      <div className="ag-info">
        <div className="ag-tags">
          {a.avaliacao_para ? <Chip color="amarelo">Avaliação de {PARA[a.avaliacao_para]}</Chip> : <ModChip mod={a.modalidade} experimental={a.experimental} />}
          {a.reposicao_de && <Chip color="roxo">Remarcação</Chip>}
          {a.fixo_id && <Chip color="roxo">Turma fixa</Chip>}
          <StatusChip status={a.status} />
          {a.presenca_confirmada_em && a.status === "AGENDADO" && <Chip color="verde">Presença confirmada</Chip>}
          {a.conta_como_dada && <Chip color="vermelho">Conta como dada</Chip>}
          {a.status === "CANCELADO" && a.cancelado_fora_do_prazo === true && <Chip color="vermelho">Cancelado fora do prazo · cobrado</Chip>}
          {a.status === "CANCELADO" && a.cancelado_fora_do_prazo === false && <Chip color="verde">Cancelado no prazo</Chip>}
        </div>
        <span className="muted" style={{ fontSize: 13 }}>{fmtDiaLongo(a.inicio)} · {fmtHora(a.inicio)} às {fmtHora(a.fim)}{a.motivo_cancelamento ? ` · ${a.motivo_cancelamento}` : ""}</span>
        {acoes}
      </div>
    </div>
  );
}
