import { useState, useMemo } from "react";
import { CalendarioMes, GradeHorarios, Resumo } from "../../componentes/agendamento";
import { Button, ErroBox } from "../../componentes/basicos";
import { ir } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { GET, qs } from "../../servicos/api";
import { addDias, chaveDia, deChave, fmtDiaCurto, fmtDiaLongo, fmtHora, isoLocal } from "../../utils/datas";

// ---------- Escolher um horário aberto (avaliação, experimental, remarcação de pilates) ----------
export function EscolherHorario({ modalidade, diasAFrente = 60, onConfirmar, textoBotao, resumo, enviando, erro }) {
  const horarios = useCarregar(() => GET(`/horarios${qs({ modalidade, ate: isoLocal(addDias(new Date(), diasAFrente)) })}`), [modalidade]);
  const [dia, setDia] = useState(null);
  const [sel, setSel] = useState(null);
  const lista = horarios.dados || [];
  const dias = useMemo(() => new Set(lista.map((h) => chaveDia(h.inicio))), [horarios.dados]);
  const doDia = lista.filter((h) => dia && chaveDia(h.inicio) === dia)
    .map((h) => ({ chave: h.id, inicio: h.inicio, extra: h.capacidade > 1 ? `${h.vagas_restantes} vaga${h.vagas_restantes === 1 ? "" : "s"}` : null }));
  const escolhido = lista.find((h) => h.id === sel);
  return (
    <div className="cols">
      <div className="col">
        <ErroBox erro={horarios.erro} onTentar={horarios.recarregar} />
        <CalendarioMes disponiveis={dias} selecionado={dia} onSelecionar={(k) => { setDia(k); setSel(null); }} carregando={horarios.carregando} />
        {horarios.dados && lista.length === 0 && <div className="aviso-box" style={{ marginTop: 14 }}>Não há horários livres nos próximos {diasAFrente} dias. A clínica abre novos horários com frequência; volte mais tarde ou fale com ela.</div>}
      </div>
      <div className="col-side col-side-escolha" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <GradeHorarios titulo={dia ? fmtDiaLongo(deChave(dia)) : null} itens={doDia} selecionado={sel} onSelecionar={setSel} />
        <div className="confirma-fixa">
          <p className="confirma-linha">{[resumo[0] && resumo[0][1], escolhido ? fmtDiaCurto(escolhido.inicio) : null, escolhido ? `${fmtHora(escolhido.inicio)} às ${fmtHora(escolhido.fim)}` : null].filter(Boolean).join(" · ") || "Escolha um dia e um horário"}</p>
          <Resumo linhas={[...resumo, ["Data", escolhido ? fmtDiaCurto(escolhido.inicio) : null], ["Horário", escolhido ? `${fmtHora(escolhido.inicio)} às ${fmtHora(escolhido.fim)}` : null]]} />
          <ErroBox erro={erro} />
          <Button size="lg" disabled={!escolhido} carregando={enviando} onClick={() => onConfirmar(escolhido)}>{textoBotao}</Button>
          <button className="btn-text" style={{ alignSelf: "center" }} onClick={() => ir("#/paciente")}>Agora não · Voltar ao início</button>
        </div>
      </div>
    </div>
  );
}

export function useEnviar() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const enviar = async (fn) => { setEnviando(true); setErro(null); try { return await fn(); } catch (x) { setErro(x); return undefined; } finally { setEnviando(false); } };
  return { enviando, erro, enviar };
}
