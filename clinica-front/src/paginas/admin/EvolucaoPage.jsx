import { useState } from "react";
import { Button, Carregando, ErroBox, Field, Vazio } from "../../componentes/basicos";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell } from "./AdminShell";
import { ListaRegistros } from "./PacienteDetalhePage";
import { RegistroModal } from "./modais/atendimento";
import { GET } from "../../servicos/api";

// ---------- Evolução (registros de atendimento) ----------
export function AdminEvolucaoPage({ query }) {
  const pacientes = useCarregar(() => GET("/pacientes"), []);
  const [pid, setPid] = useState(query.paciente || "");
  const registros = useCarregar(() => (pid ? GET(`/registros?paciente_id=${pid}`) : null), [pid]);
  const [modal, setModal] = useState(null);
  const p = (pacientes.dados || []).find((x) => x.id === pid);
  return (
    <AdminShell ativa="evolucao">
      <div className="page-title"><div><h1>Evolução</h1><p>Registros de atendimento de cada paciente.</p></div>{p && <div className="actions"><Button size="sm" onClick={() => setModal("novo")}>Novo registro</Button></div>}</div>
      <div className="card card-sm" style={{ marginBottom: 18, maxWidth: 480 }}>
        <Field label="Paciente">
          <select value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Escolha um paciente…</option>
            {(pacientes.dados || []).map((x) => <option key={x.id} value={x.id}>{x.nome_completo}</option>)}
          </select>
        </Field>
      </div>
      {pid && (
        <div className="card">
          <div className="secao-titulo"><h3>{p?.nome_completo}</h3><a className="btn-text" href={`#/admin/pacientes/${pid}`}>Abrir ficha</a></div>
          <ErroBox erro={registros.erro} onTentar={registros.recarregar} />
          {registros.carregando && <Carregando />}
          {registros.dados && registros.dados.length === 0 && <Vazio>Nenhum registro ainda.</Vazio>}
          {registros.dados && <ListaRegistros registros={registros.dados} onEditar={(r) => setModal({ editar: r })} />}
        </div>
      )}
      {modal === "novo" && <RegistroModal pacienteId={pid} onClose={(r, ok) => { setModal(null); if (ok) registros.recarregar(); }} />}
      {modal?.editar && <RegistroModal pacienteId={pid} registro={modal.editar} onClose={(r, ok) => { setModal(null); if (ok) registros.recarregar(); }} />}
    </AdminShell>
  );
}
