import { Button, Carregando, ErroBox } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { EscolherHorario, useEnviar } from "./EscolherHorario";
import { EscolherInicioFisio, marcarFisio } from "./FisioterapiaPage";
import { PacienteShell } from "./PacienteShell";
import { GET, POST } from "../../servicos/api";
import { MOD } from "../../utils/constantes";
import { fmtQuando } from "../../utils/datas";

export function RemarcarPage({ id }) {
  const { toast } = useApp();
  const repos = useCarregar(() => GET("/agendamentos/reposicoes-disponiveis"), []);
  const env = useEnviar();
  const credito = (repos.dados || []).find((x) => x.id === id);
  const ok = (msg) => { toast(msg); ir("#/paciente"); };
  async function confirmarHorario(h) {
    if (await env.enviar(() => POST("/agendamentos", { horario_id: h.id, reposicao_de: id }))) ok(`Remarcação feita para ${fmtQuando(h.inicio)}.`);
  }
  async function confirmarFisio(x) {
    if (await env.enviar(() => marcarFisio(x, { reposicao_de: id }))) ok(`Remarcação feita para ${fmtQuando(x.inicio)}.`);
  }
  return (
    <PacienteShell ativa="inicio">
      <div className="page-title"><div><h1>Usar remarcação</h1><p>{credito ? `${MOD[credito.modalidade]} cancelada de ${fmtQuando(credito.cancelado_em_horario_de)}` : "Escolha um novo horário"}</p></div></div>
      {repos.carregando && <Carregando />}
      <ErroBox erro={repos.erro} onTentar={repos.recarregar} />
      {repos.dados && !credito && <div className="card" style={{ maxWidth: 620 }}><p>Esta remarcação não está mais disponível (já foi usada ou expirou).</p><Button style={{ marginTop: 14 }} variant="outline" onClick={() => ir("#/paciente")}>Voltar</Button></div>}
      {credito && credito.modalidade === "FISIOTERAPIA" && <EscolherInicioFisio onConfirmar={confirmarFisio} textoBotao="Confirmar remarcação" resumo={[["Atendimento", "Fisioterapia (remarcação)"]]} enviando={env.enviando} erro={env.erro} />}
      {credito && credito.modalidade === "PILATES" && <EscolherHorario modalidade="PILATES" diasAFrente={45} onConfirmar={confirmarHorario} textoBotao="Confirmar remarcação" resumo={[["Atendimento", "Pilates (remarcação)"]]} enviando={env.enviando} erro={env.erro} />}
      {credito && credito.modalidade === "AVALIACAO" && <div className="aviso-box">Para remarcar a avaliação, fale com a clínica.</div>}
    </PacienteShell>
  );
}
