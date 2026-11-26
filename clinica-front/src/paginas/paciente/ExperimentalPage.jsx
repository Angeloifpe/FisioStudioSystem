import { ir, useApp } from "../../componentes/contexto";
import { EscolherHorario, useEnviar } from "./EscolherHorario";
import { PacienteShell } from "./PacienteShell";
import { POST } from "../../servicos/api";
import { fmtQuando } from "../../utils/datas";

export function ExperimentalPage() {
  const { recarregarMe, toast } = useApp();
  const env = useEnviar();
  async function confirmar(h) {
    const ok = await env.enviar(() => POST("/agendamentos", { horario_id: h.id, experimental: true }));
    if (ok) { toast(`Aula experimental marcada para ${fmtQuando(h.inicio)}.`); recarregarMe(); ir("#/paciente"); }
  }
  return (
    <PacienteShell ativa="inicio">
      <div className="page-title">
        <div>
          <h1>Aula experimental de <span style={{ color: "var(--primaria)" }}>pilates</span></h1>
          <p>Conheça o pilates antes da avaliação. É uma aula por pessoa.</p>
        </div>
      </div>
      <div className="aviso-box" style={{ marginBottom: 20 }}>Se a aula for paga antes (Pix ou aplicativo), ela não pode ser desmarcada e, em caso de falta, conta como dada.</div>
      <EscolherHorario modalidade="PILATES" diasAFrente={30} onConfirmar={confirmar} textoBotao="Marcar aula experimental"
        resumo={[["Atendimento", "Aula experimental de pilates"]]} enviando={env.enviando} erro={env.erro} />
    </PacienteShell>
  );
}
