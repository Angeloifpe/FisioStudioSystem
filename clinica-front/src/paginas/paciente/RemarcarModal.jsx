import { Icon } from "../../componentes/Icon";
import { Modal } from "../../componentes/Modal";
import { useApp } from "../../componentes/contexto";
import { useEnviar } from "./EscolherHorario";
import { cap, descAtendimento, nomeAtendimento, prazoCurto, textoPrazo } from "./regras";
import { SeletorRemarcacao, corpoRemarcar } from "./remarcacao";
import { POST } from "../../servicos/api";
import { fmtQuando } from "../../utils/datas";

export function RemarcarModal({ a, open, onClose, antecedencia }) {
  const { toast } = useApp();
  const env = useEnviar();
  const nome = nomeAtendimento(a);
  const noPrazo = (new Date(a.inicio) - new Date()) / 60000 >= antecedencia;
  async function remarcar(x) {
    const r = await env.enviar(() => POST(`/agendamentos/${a.id}/remarcar-paciente`, corpoRemarcar(x)));
    if (r) {
      toast(noPrazo ? `${cap(nome)} remarcada para ${fmtQuando(r.inicio)}.` : `Remarcado para ${fmtQuando(r.inicio)}. Fora do prazo de ${prazoCurto(antecedencia)}: a ${nome} anterior será cobrada.`);
      onClose(true);
    }
  }
  return (
    <Modal open={open} onClose={() => onClose(false)} title={`Remarcar ${nome}`} subtitle={descAtendimento(a)} wide>
      <SeletorRemarcacao a={a} onEscolher={remarcar} enviando={env.enviando} erro={env.erro} textoBotao={`Remarcar ${nome}`}
        aviso={noPrazo
          ? <div className="ok-box">Você está remarcando com mais de {textoPrazo(antecedencia)} de antecedência: sem cobrança.</div>
          : <div className="aviso-vermelho"><Icon.Alert /> <span><strong>Remarcação fora do prazo de {prazoCurto(antecedencia)}: o valor da {nome} atual será cobrado.</strong></span></div>} />
    </Modal>
  );
}
