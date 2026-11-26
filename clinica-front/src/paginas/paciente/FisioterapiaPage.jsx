import { useState } from "react";
import { CalendarioMes, GradeHorarios, Resumo } from "../../componentes/agendamento";
import { Button, Carregando, ErroBox } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { useEnviar } from "./EscolherHorario";
import { PacienteShell } from "./PacienteShell";
import { GET, POST, qs } from "../../servicos/api";
import { addDias, chaveDia, deChave, fmtDiaCurto, fmtDiaLongo, fmtHora, fmtQuando, hoje, isoLocal } from "../../utils/datas";

// ---------- Fisioterapia: o paciente escolhe só o início (duração cadastrada pela clínica) ----------
export function useDiasDeFuncionamento(dias = 45) {
  return useCarregar(async () => {
    const [func, feriados] = await Promise.all([GET("/horarios/funcionamento"), GET(`/feriados${qs({ ate: chaveDia(addDias(new Date(), dias)) })}`)]);
    const abertos = new Set(func.filter((d) => d.aberto).map((d) => d.dia_semana % 7)); // 1..7 → JS 1..6,0
    const fer = new Set(feriados.map((f) => f.data));
    const set = new Set();
    for (let i = 0; i <= dias; i++) { const d = addDias(hoje(), i); if (abertos.has(d.getDay()) && !fer.has(chaveDia(d))) set.add(chaveDia(d)); }
    return set;
  }, []);
}

/**
 * Fisioterapia: junta os inícios livres (com a duração do paciente) e os horários
 * de fisioterapia já abertos pela clínica no dia. Devolve {tipo, inicio, fim, horario_id}.
 */

export function useOpcoesFisio(dia, pacienteId) {
  return useCarregar(async () => {
    if (!dia) return null;
    const ini = deChave(dia);
    const [inic, abertos] = await Promise.all([
      GET(`/agendamentos/fisioterapia/inicios${qs({ data: dia, paciente_id: pacienteId })}`),
      GET(`/horarios${qs({ modalidade: "FISIOTERAPIA", de: isoLocal(ini), ate: isoLocal(addDias(ini, 1)) })}`),
    ]);
    const agora = new Date();
    const itens = [
      ...inic.inicios.map((x) => ({ chave: "i:" + x.inicio, tipo: "inicio", inicio: x.inicio, fim: x.fim })),
      ...abertos.filter((h) => !h.bloqueado && h.vagas_restantes > 0)
        .map((h) => ({ chave: "h:" + h.id, tipo: "horario", horario_id: h.id, inicio: h.inicio, fim: h.fim,
          extra: `${Math.round((new Date(h.fim) - new Date(h.inicio)) / 60000)} min` })),
    ].filter((x) => new Date(x.inicio) > agora)
      .filter((x, i, arr) => x.tipo === "horario" || !arr.some((y) => y.tipo === "horario" && y.inicio === x.inicio))
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    return { duracao: inic.duracao_min, itens };
  }, [dia, pacienteId]);
}

export function EscolherInicioFisio({ onConfirmar, textoBotao, resumo, enviando, erro, pacienteId }) {
  const dias = useDiasDeFuncionamento();
  const [dia, setDia] = useState(null);
  const op = useOpcoesFisio(dia, pacienteId);
  const [sel, setSel] = useState(null);
  const itens = op.dados?.itens || [];
  const escolhido = itens.find((x) => x.chave === sel);
  return (
    <div className="cols">
      <div className="col">
        <ErroBox erro={dias.erro} onTentar={dias.recarregar} />
        <CalendarioMes disponiveis={dias.dados} selecionado={dia} onSelecionar={(k) => { setDia(k); setSel(null); }} carregando={dias.carregando} />
      </div>
      <div className="col-side" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {dia && op.carregando ? <div className="card"><Carregando texto="Buscando horários livres..." /></div> :
          dia && op.dados && itens.length === 0 ? <div className="aviso-box">Sem horários livres de fisioterapia neste dia. Tente outro dia.</div> :
            <GradeHorarios titulo={dia ? fmtDiaLongo(deChave(dia)) : null} itens={itens} selecionado={sel} onSelecionar={setSel} />}
        <ErroBox erro={op.erro} />
        <Resumo linhas={[...resumo, ["Duração", escolhido ? `${Math.round((new Date(escolhido.fim) - new Date(escolhido.inicio)) / 60000)} min` : op.dados ? `${op.dados.duracao} min` : null], ["Data", escolhido ? fmtDiaCurto(escolhido.inicio) : null], ["Horário", escolhido ? `${fmtHora(escolhido.inicio)} às ${fmtHora(escolhido.fim)}` : null]]} />
        <ErroBox erro={erro} />
        <Button size="lg" disabled={!escolhido} carregando={enviando} onClick={() => onConfirmar(escolhido)}>{textoBotao}</Button>
      </div>
    </div>
  );
}

/** Marca a fisioterapia escolhida (início livre ou horário aberto pela clínica). */

export function marcarFisio(x, extra = {}) {
  return x.tipo === "horario"
    ? POST("/agendamentos", { horario_id: x.horario_id, ...extra })
    : POST("/agendamentos/fisioterapia", { inicio: x.inicio, ...extra });
}

export function FisioterapiaPage() {
  const { me, toast } = useApp();
  const env = useEnviar();
  async function confirmar(x) {
    const ok = await env.enviar(() => marcarFisio(x));
    if (ok) { toast(`Fisioterapia marcada para ${fmtQuando(x.inicio)}.`); ir("#/paciente"); }
  }
  if (me && !me.liberado_fisioterapia) {
    return <PacienteShell ativa="fisioterapia"><div className="card" style={{ maxWidth: 620 }}><h3>Você ainda não foi liberado(a) para fisioterapia</h3><p className="muted" style={{ margin: "8px 0 16px" }}>Faça a avaliação de fisioterapia primeiro.</p><Button variant="outline" onClick={() => ir("#/paciente")}>Voltar</Button></div></PacienteShell>;
  }
  return (
    <PacienteShell ativa="fisioterapia">
      <div className="page-title"><div><h1>Marcar <span style={{ color: "var(--primaria)" }}>fisioterapia</span></h1><p>Escolha o dia e o horário de início. A sessão tem {me?.duracao_fisioterapia_min || 30} minutos, conforme definido pela clínica.</p></div></div>
      <EscolherInicioFisio onConfirmar={confirmar} textoBotao="Confirmar sessão" resumo={[["Atendimento", "Fisioterapia"]]} enviando={env.enviando} erro={env.erro} />
    </PacienteShell>
  );
}
