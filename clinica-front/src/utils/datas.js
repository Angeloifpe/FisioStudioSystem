// ===========================================================================
// Datas (horário local do navegador; a API recebe ISO com fuso)
// ===========================================================================
export const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];

export const MESES_TIT = MESES.map((m) => m[0].toUpperCase() + m.slice(1));

export const DOW = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

export const DOW_LONGO = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];

export const DIA_SEMANA_API = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]; // 1 = segunda

export const pad2 = (n) => String(n).padStart(2, "0");

export function chaveDia(d) { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

export function deChave(k) { const [a, m, d] = k.split("-").map(Number); return new Date(a, m - 1, d); }

export function isoLocal(d) {
  d = new Date(d);
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? "+" : "-";
  return `${chaveDia(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00${s}${pad2(Math.floor(Math.abs(off) / 60))}:${pad2(Math.abs(off) % 60)}`;
}

export function addDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function inicioDoDia(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export function segundaDaSemana(d) { const x = inicioDoDia(d); const dow = x.getDay(); return addDias(x, dow === 0 ? -6 : 1 - dow); }

export const hoje = () => inicioDoDia(new Date());
/** Semana "atual" da clínica: no sábado e no domingo, já mostra a próxima semana. */

export function semanaPadrao() { const d = new Date(); return [0, 6].includes(d.getDay()) ? segundaDaSemana(addDias(d, 2)) : segundaDaSemana(d); }

export const fmtHora = (d) => { d = new Date(d); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

export const fmtDiaLongo = (d) => { d = new Date(d); return `${DOW_LONGO[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };

export const fmtDiaCurto = (d) => { d = new Date(d); return `${DOW[d.getDay()]}, ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };

export const fmtQuando = (d) => `${fmtDiaCurto(d)} · ${fmtHora(d)}`;

export const fmtDataBR = (k) => { if (!k) return "—"; const [a, m, d] = String(k).slice(0, 10).split("-"); return `${d}/${m}/${a}`; };

export const ehHoje = (d) => chaveDia(d) === chaveDia(new Date());

export function fmtRelativo(d) {
  const seg = (Date.now() - new Date(d).getTime()) / 1000;
  if (seg < 60) return "agora";
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  return fmtDiaCurto(d);
}
