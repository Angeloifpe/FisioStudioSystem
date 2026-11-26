import { useState } from "react";
import { Carregando, ErroBox, Vazio } from "../../componentes/basicos";
import { useCarregar } from "../../hooks/useCarregar";
import { AcoesAtendimentoPaciente, ItemAtendimento } from "./ItemAtendimento";
import { PacienteShell } from "./PacienteShell";
import { GET } from "../../servicos/api";

// ---------- Histórico ----------
export function HistoricoPacientePage() {
  const meus = useCarregar(() => GET("/agendamentos/meus"), []);
  const cfg = useCarregar(() => GET("/pilates/config").catch(() => null), []);
  const [aba, setAba] = useState("proximos");
  const agora = new Date();
  const lista = (meus.dados || []);
  const proximos = lista.filter((a) => new Date(a.fim) > agora).sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const anteriores = lista.filter((a) => new Date(a.fim) <= agora);
  const mostrar = aba === "proximos" ? proximos : anteriores;
  return (
    <PacienteShell ativa="historico">
      <div className="page-title"><div><h1>Meus horários</h1><p>Todos os seus agendamentos, com presença, faltas e cancelamentos.</p></div></div>
      <div className="tabs-sub">
        <button className={aba === "proximos" ? "ativo" : ""} onClick={() => setAba("proximos")}>Próximos ({proximos.length})</button>
        <button className={aba === "anteriores" ? "ativo" : ""} onClick={() => setAba("anteriores")}>Anteriores ({anteriores.length})</button>
      </div>
      <div className="card">
        <ErroBox erro={meus.erro} onTentar={meus.recarregar} />
        {meus.carregando && <Carregando />}
        {meus.dados && mostrar.length === 0 && <Vazio>Nada por aqui.</Vazio>}
        {mostrar.map((a) => <ItemAtendimento key={a.id} a={a} acoes={aba === "proximos" ? <AcoesAtendimentoPaciente a={a} onMudou={meus.recarregar} antecedencia={cfg.dados?.antecedencia_aviso_falta_min ?? 1440} /> : null} />)}
      </div>
    </PacienteShell>
  );
}
