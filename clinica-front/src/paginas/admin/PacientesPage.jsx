import { useState, useEffect } from "react";
import { Icon } from "../../componentes/Icon";
import { Carregando, Chip, ErroBox, SituacaoChip, Vazio } from "../../componentes/basicos";
import { ir } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AdminShell } from "./AdminShell";
import { GET, qs } from "../../servicos/api";
import { SITUACAO } from "../../utils/constantes";
import { chaveDia, fmtDataBR } from "../../utils/datas";
import { fmtTel } from "../../utils/formatos";

// ---------- Pacientes ----------
export function AdminPacientesPage({ query }) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState(query.situacao || "");
  const [termo, setTermo] = useState("");
  useEffect(() => { const t = setTimeout(() => setTermo(busca.trim().replace(/[.\-]/g, (c) => (/^\d/.test(busca.trim()) ? "" : c))), 300); return () => clearTimeout(t); }, [busca]);
  const lista = useCarregar(() => GET(`/pacientes${qs({ busca: termo, situacao })}`), [termo, situacao]);
  return (
    <AdminShell ativa="pacientes">
      <div className="page-title"><div><h1>Pacientes</h1><p>{lista.dados ? `${lista.dados.length} paciente${lista.dados.length === 1 ? "" : "s"}` : " "}</p></div></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div className="input-wrap" style={{ flex: 1, minWidth: 240, maxWidth: 420 }}><Icon.Search /><input style={{ border: "none", outline: "none", flex: 1, marginLeft: 8, fontSize: 14 }} placeholder="Buscar por nome ou CPF..." value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <select className="select-inline" value={situacao} onChange={(e) => setSituacao(e.target.value)}>
          <option value="">Todas as situações</option>
          {Object.entries(SITUACAO).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </div>
      <div className="card table-wrap">
        <ErroBox erro={lista.erro} onTentar={lista.recarregar} />
        {lista.carregando && !lista.dados && <Carregando />}
        {lista.dados && lista.dados.length === 0 && <Vazio>Nenhum paciente encontrado.</Vazio>}
        {lista.dados && lista.dados.length > 0 && (
          <table className="table">
            <thead><tr><th>Nome</th><th>Situação</th><th>Liberado para</th><th>Telefone</th><th>Cadastro</th></tr></thead>
            <tbody>
              {lista.dados.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => ir(`#/admin/pacientes/${p.id}`)}>
                  <td data-label="Nome" style={{ fontWeight: 600 }}>{p.nome_completo}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{p.email}</div></td>
                  <td data-label="Situação"><SituacaoChip situacao={p.situacao} />{p.nova_avaliacao_pedida_em && <div style={{ marginTop: 4 }}><Chip color="amarelo">Pediu nova avaliação</Chip></div>}</td>
                  <td data-label="Liberado para"><div className="ag-tags">{p.liberado_pilates && <Chip color="roxo">Pilates</Chip>}{p.liberado_fisioterapia && <Chip color="azul">Fisioterapia</Chip>}{!p.liberado_pilates && !p.liberado_fisioterapia && <span className="muted">—</span>}</div></td>
                  <td data-label="Telefone">{fmtTel(p.telefone)}</td>
                  <td data-label="Cadastro">{fmtDataBR(chaveDia(p.criado_em))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminShell>
  );
}
