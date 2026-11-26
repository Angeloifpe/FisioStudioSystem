import { Icon } from "../../componentes/Icon";
import { Chip } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { AppBar, NavInferior } from "../../componentes/navegacao";
import { fmtDataBR } from "../../utils/datas";

// ===========================================================================
// Área da clínica (ADMIN)
// ===========================================================================
export const ABAS_ADMIN = [
  { key: "painel", label: "Painel", href: "#/admin", icon: <Icon.Home /> },
  { key: "atendimentos", label: "Atendimentos", href: "#/admin/atendimentos", icon: <Icon.Clock /> },
  { key: "pedidos", label: "Pedidos", href: "#/admin/pedidos", icon: <Icon.Inbox /> },
  { key: "pacientes", label: "Pacientes", href: "#/admin/pacientes", icon: <Icon.User /> },
  { key: "agenda", label: "Agenda", href: "#/admin/agenda", icon: <Icon.Calendar /> },
  { key: "evolucao", label: "Evolução", href: "#/admin/evolucao", icon: <Icon.Doc /> },
];

export function AdminShell({ ativa, children }) {
  const { me } = useApp();
  const nome = me?.nome_completo || "Clínica";
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar nome={nome} tabs={ABAS_ADMIN} ativa={ativa} />
      <div className="page-content container" style={{ flex: 1 }}>{children}</div>
      <NavInferior itens={ABAS_ADMIN.filter((a) => a.key !== "evolucao")} ativa={ativa} />
    </div>
  );
}

/** Marca de um cancelamento do paciente: dentro ou fora do prazo. */

export function ChipPrazo({ a }) {
  if (a.status !== "CANCELADO" || a.cancelado_fora_do_prazo == null) return null;
  return a.cancelado_fora_do_prazo ? <Chip color="vermelho">Fora do prazo · cobrar</Chip> : <Chip color="verde">No prazo</Chip>;
}

export function QueixaResumo({ queixa, inicio, diagnostico, semDiagnostico, compacto }) {
  if (!queixa) return <span className="muted" style={{ fontSize: 13 }}>Ainda não preencheu “Sobre a queixa”.</span>;
  return (
    <div className={`queixa-box ${compacto ? "compacto" : ""}`}>
      <p><strong>Queixa:</strong> {queixa}</p>
      <p><strong>Início dos sintomas:</strong> {fmtDataBR(inicio)}</p>
      <p><strong>Diagnóstico:</strong> {diagnostico ? diagnostico : semDiagnostico ? "Ainda não tem diagnóstico" : "Não informado"}</p>
    </div>
  );
}
