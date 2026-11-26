import { useState, useEffect, useMemo } from "react";
import { CalendarioMes, GradeHorarios } from "../../componentes/agendamento";
import { Button, Carregando, ErroBox } from "../../componentes/basicos";
import { useCarregar } from "../../hooks/useCarregar";
import { marcarFisio, useDiasDeFuncionamento, useOpcoesFisio } from "./FisioterapiaPage";
import { GET, POST, qs } from "../../servicos/api";
import { addDias, chaveDia, deChave, fmtDiaCurto, fmtDiaLongo, fmtHora, isoLocal } from "../../utils/datas";

export function SeletorRemarcacao({ a, onEscolher, enviando, erro, textoBotao, aviso }) {
  const fisio = a.modalidade === "FISIOTERAPIA";
  const diaOrig = chaveDia(new Date(a.inicio));
  const [modo, setModo] = useState("carregando"); // carregando | pergunta | lista
  const [dia, setDia] = useState(null);
  const [sel, setSel] = useState(null);

  const diasFisio = useDiasDeFuncionamento();
  const opFisio = useOpcoesFisio(fisio ? dia : null);
  const mesmoFisio = useOpcoesFisio(fisio ? diaOrig : null);
  const horarios = useCarregar(() => (fisio ? [] : GET(`/horarios${qs({ modalidade: a.modalidade, ate: isoLocal(addDias(new Date(), 45)) })}`)), [a.modalidade]);

  const livres = (horarios.dados || []).filter((h) => h.id !== a.horario_id);
  const diasOutros = useMemo(() => new Set(livres.map((h) => chaveDia(new Date(h.inicio)))), [horarios.dados]);
  const itensOutros = livres.filter((h) => dia && chaveDia(new Date(h.inicio)) === dia)
    .map((h) => ({ chave: h.id, tipo: "horario", horario_id: h.id, inicio: h.inicio, fim: h.fim, extra: h.capacidade > 1 ? `${h.vagas_restantes} vaga${h.vagas_restantes === 1 ? "" : "s"}` : null }));
  const itensFisio = (opFisio.dados?.itens || []).filter((x) => x.inicio !== a.inicio);
  const itens = fisio ? itensFisio : itensOutros;
  const diasDisp = fisio ? diasFisio.dados : diasOutros;

  const mesmoDia = fisio
    ? (mesmoFisio.dados?.itens || []).filter((x) => x.inicio !== a.inicio)
    : livres.filter((h) => chaveDia(new Date(h.inicio)) === diaOrig);
  const pronto = fisio ? Boolean(mesmoFisio.dados || mesmoFisio.erro) : Boolean(horarios.dados || horarios.erro);

  useEffect(() => {
    if (modo !== "carregando" || !pronto) return;
    if (mesmoDia.length > 0) setModo("pergunta"); else setModo("lista");
  }, [pronto]);

  const escolhido = itens.find((x) => x.chave === sel);
  const resumoDia = fmtDiaLongo(new Date(a.inicio));

  if (modo === "carregando") return <Carregando texto="Buscando horários livres..." />;

  if (modo === "pergunta") {
    return (
      <div className="queixa-box" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontWeight: 600 }}>Há horários livres no mesmo dia ({resumoDia}).</p>
        <p className="muted" style={{ fontSize: 14 }}>Quer remarcar para outro horário no mesmo dia?</p>
        <div className="ag-acoes">
          <Button size="sm" onClick={() => { setDia(diaOrig); setModo("lista"); }}>Sim, ver horários do mesmo dia</Button>
          <Button size="sm" variant="outline" onClick={() => setModo("lista")}>Não, escolher outro dia</Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {aviso}
      <p className="eyebrow">DIAS E HORÁRIOS DISPONÍVEIS</p>
      {!fisio && horarios.dados && livres.length === 0
        ? <div className="aviso-box">Não há horários livres nos próximos 45 dias. A clínica abre novos horários com frequência; volte mais tarde ou fale com ela.</div>
        : <CalendarioMes disponiveis={diasDisp} selecionado={dia} onSelecionar={(k) => { setDia(k); setSel(null); }} carregando={fisio ? diasFisio.carregando : horarios.carregando} />}
      {dia && fisio && opFisio.carregando && <Carregando texto="Buscando horários livres..." />}
      {dia && !(fisio && opFisio.carregando) && (
        itens.length === 0
          ? <p className="muted" style={{ fontSize: 14 }}>Sem horários livres neste dia. Tente outro dia.</p>
          : <GradeHorarios titulo={fmtDiaLongo(deChave(dia))} itens={itens} selecionado={sel} onSelecionar={setSel} />
      )}
      <ErroBox erro={erro} />
      <Button disabled={!escolhido} carregando={enviando} onClick={() => onEscolher(escolhido)}>
        {escolhido ? `${textoBotao} · ${fmtDiaCurto(escolhido.inicio)} às ${fmtHora(escolhido.inicio)}` : textoBotao}
      </Button>
    </div>
  );
}

/** Corpo do pedido de remarcação: início livre (fisioterapia) ou horário aberto. */

export const corpoRemarcar = (x) => (x.tipo === "inicio" ? { inicio: x.inicio } : { horario_id: x.horario_id });

/** Marca o novo horário depois de o atendimento já ter sido cancelado. */

export function marcarNovoDepoisDeCancelar(a, x) {
  if (a.modalidade === "FISIOTERAPIA") return marcarFisio(x, { remarcado_de: a.id });
  if (a.modalidade === "PILATES" && !a.experimental) return POST("/agendamentos", { horario_id: x.horario_id, reposicao_de: a.id });
  return POST("/agendamentos", {
    horario_id: x.horario_id, remarcado_de: a.id,
    ...(a.modalidade === "AVALIACAO" ? { avaliacao_para: a.avaliacao_para } : {}),
    ...(a.experimental ? { experimental: true } : {}),
  });
}

/** Cancelar (e, em seguida, remarcar). No pilates, "remarcar" também passa por aqui: cancela e usa a remarcação. */
