import { useState, useEffect, useMemo } from "react";
import { Carregando } from "./basicos";
import { DOW, MESES_TIT, addDias, chaveDia, deChave, fmtHora } from "../utils/datas";

// ---------- Calendário mensal: só os dias de `disponiveis` (Set de "AAAA-MM-DD") podem ser escolhidos ----------
export function CalendarioMes({ disponiveis, selecionado, onSelecionar, carregando }) {
  const base = selecionado ? deChave(selecionado) : (disponiveis && disponiveis.size ? deChave([...disponiveis].sort()[0]) : new Date());
  const [cursor, setCursor] = useState(new Date(base.getFullYear(), base.getMonth(), 1));
  useEffect(() => {
    if (!selecionado && disponiveis && disponiveis.size) {
      const p = deChave([...disponiveis].sort()[0]);
      setCursor(new Date(p.getFullYear(), p.getMonth(), 1));
    }
  }, [disponiveis && disponiveis.size]);
  const celulas = useMemo(() => {
    const ini = cursor.getDay(); const n = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return [...Array(ini).fill(null), ...Array.from({ length: n }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth(), i + 1))];
  }, [cursor]);
  return (
    <div className="card" style={{ width: "100%" }}>
      <div className="cal-head">
        <h3 style={{ fontSize: 22 }}>{MESES_TIT[cursor.getMonth()]} {cursor.getFullYear()}</h3>
        <div>
          <button type="button" className="cal-nav-btn" aria-label="Mês anterior" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>‹</button>
          <button type="button" className="cal-nav-btn" aria-label="Próximo mês" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      <div className="cal-grid" style={{ marginBottom: 4 }}>{DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}</div>
      {carregando ? <Carregando texto="Buscando dias livres..." /> : (
        <div className="cal-grid">
          {celulas.map((d, i) => {
            if (!d) return <div key={i} className="cal-day empty" />;
            const k = chaveDia(d); const ok = disponiveis && disponiveis.has(k);
            return <button type="button" key={i} disabled={!ok} className={`cal-day ${ok ? (selecionado === k ? "selected" : "available") : "unavailable"}`} onClick={() => onSelecionar(k)}>{d.getDate()}</button>;
          })}
        </div>
      )}
      <div className="cal-legend">
        <div className="cal-legend-item"><span className="legend-dot sel" />Selecionado</div>
        <div className="cal-legend-item"><span className="legend-dot avail" />Com horário livre</div>
        <div className="cal-legend-item"><span className="legend-dot unavail" />Sem horário</div>
      </div>
    </div>
  );
}

/** Grade de horários de um dia, separada em manhã e tarde. itens: [{chave, inicio, rotulo?, extra?}] */

export function GradeHorarios({ titulo, itens, selecionado, onSelecionar }) {
  const manha = itens.filter((i) => new Date(i.inicio).getHours() < 12);
  const tarde = itens.filter((i) => new Date(i.inicio).getHours() >= 12);
  const bloco = (rot, lista) => lista.length > 0 && (
    <div>
      <p className="slot-section-label">{rot}</p>
      <div className="slot-grid">
        {lista.map((i) => (
          <button type="button" key={i.chave} className={`slot-btn ${selecionado === i.chave ? "selected" : ""}`} onClick={() => onSelecionar(i.chave)}>
            {i.rotulo || fmtHora(i.inicio)}{i.extra && <small className="slot-extra">{i.extra}</small>}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className="eyebrow">HORÁRIOS DISPONÍVEIS</p>
      {titulo && <h3 style={{ fontSize: 22 }}>{titulo}</h3>}
      {itens.length === 0 ? <p className="muted" style={{ fontSize: 14 }}>Escolha um dia no calendário.</p> : <>{bloco("Manhã", manha)}{bloco("Tarde", tarde)}</>}
    </div>
  );
}

export function Resumo({ linhas }) {
  return (
    <div className="card card-sm">
      <p className="eyebrow" style={{ marginBottom: 8 }}>RESUMO</p>
      {linhas.map(([a, b]) => <div key={a} className="summary-row"><span>{a}</span><span>{b || "—"}</span></div>)}
    </div>
  );
}

/** Seletor de dia (anterior/próximo/hoje) usado na agenda e nos atendimentos */

export function SeletorDia({ dia, onMudar, passo = 1, rotulo }) {
  return (
    <div className="seletor-dia">
      <button className="cal-nav-btn" onClick={() => onMudar(addDias(deChave(dia), -passo))} aria-label="Anterior">‹</button>
      <input type="date" value={dia} onChange={(e) => e.target.value && onMudar(deChave(e.target.value))} />
      <button className="cal-nav-btn" onClick={() => onMudar(addDias(deChave(dia), passo))} aria-label="Próximo">›</button>
      <button className="btn btn-outline btn-sm" onClick={() => onMudar(new Date())}>Hoje</button>
      {rotulo && <span className="muted" style={{ fontSize: 14 }}>{rotulo}</span>}
    </div>
  );
}
