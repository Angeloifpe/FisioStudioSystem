import { Icon } from "../../componentes/Icon";
import { SituacaoChip } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { AppBar, NavInferior } from "../../componentes/navegacao";

// ===========================================================================
// Área do paciente
// ===========================================================================
export function abasPaciente(me) {
  const t = [
    { key: "inicio", label: "Início", href: "#/paciente", icon: <Icon.Home /> },
    { key: "historico", label: "Meus horários", href: "#/paciente/historico", icon: <Icon.Calendar /> },
  ];
  if (me?.liberado_pilates) t.push({ key: "pilates", label: "Pilates", href: "#/paciente/pilates", icon: <Icon.User /> });
  if (me?.liberado_fisioterapia) t.push({ key: "fisioterapia", label: "Fisioterapia", href: "#/paciente/fisioterapia", icon: <Icon.Clock /> });
  return t;
}

export function chipPaciente(me) {
  // Só aparece o status "Aguardando avaliação"; quem já foi liberado(a) fica sem chip
  if (me?.situacao === "AGUARDANDO_AVALIACAO") return <SituacaoChip situacao={me.situacao} />;
  return null;
}

export function PacienteShell({ ativa, children }) {
  const { me } = useApp();
  const abas = abasPaciente(me);
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <AppBar nome={me?.nome_completo} tabs={abas} ativa={ativa} chip={chipPaciente(me)} />
      <div className="page-content container" style={{ flex: 1 }}>{children}</div>
      <NavInferior itens={abas} ativa={ativa} />
    </div>
  );
}

/** Regras do back aplicadas no front para mostrar só o que é possível. */

export function PassosPaciente({ atual }) {
  const passos = [["Conta criada", "Seus dados já estão com a clínica."], ["Avaliação inicial", "Uma por modalidade: pilates e/ou fisioterapia."], ["Liberação", "Depois dela, você agenda a modalidade avaliada."]];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {passos.map(([t, d], i) => (
        <div key={t} style={{ display: "flex", gap: 14 }}>
          <div className="passo-num" style={{ background: i + 1 <= atual ? "var(--primaria)" : "var(--lilas-claro)", color: i + 1 <= atual ? "#fff" : "var(--primaria)" }}>{i + 1 < atual ? <Icon.Check /> : i + 1}</div>
          <div><p style={{ fontWeight: 600, fontSize: 15 }}>{t}</p><p className="muted" style={{ fontSize: 13 }}>{d}</p></div>
        </div>
      ))}
    </div>
  );
}
