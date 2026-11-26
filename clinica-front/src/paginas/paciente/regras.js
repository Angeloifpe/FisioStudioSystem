import { MOD, PARA } from "../../utils/constantes";
import { fmtDiaLongo, fmtHora } from "../../utils/datas";

export function regrasPaciente(me, meus) {
  const agora = Date.now();
  const ativos = (meus || []).filter((a) => ["AGENDADO", "CANCELAMENTO_SOLICITADO"].includes(a.status) && new Date(a.fim).getTime() > agora)
    .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
  const encerrado = ["ALTA", "INTERROMPIDO"].includes(me?.situacao);
  const avaliacaoPendente = (mod) => ativos.some((a) => a.modalidade === "AVALIACAO" && (a.avaliacao_para === mod || a.avaliacao_para === "AMBAS"));
  const liberado = (mod) => (mod === "PILATES" ? me?.liberado_pilates : me?.liberado_fisioterapia);
  const podeAvaliar = (mod) => !encerrado && !liberado(mod) && !avaliacaoPendente(mod) && !me?.nova_avaliacao_bloqueada;
  const experimentalUsada = (meus || []).some((a) => a.experimental && (["AGENDADO", "CANCELAMENTO_SOLICITADO", "REALIZADO"].includes(a.status) || a.conta_como_dada));
  const podeExperimental = !encerrado && !me?.liberado_pilates && !experimentalUsada;
  return { ativos, encerrado, avaliacaoPendente, liberado, podeAvaliar, podeExperimental, avaliacoesAtivas: ativos.filter((a) => a.modalidade === "AVALIACAO") };
}

// ---------- Cancelar e remarcar um atendimento ----------
/** 1440 → "1 dia"; 60 → "1 hora"; 30 → "30 min". */

export function textoPrazo(min) {
  if (min >= 1440 && min % 1440 === 0) { const d = min / 1440; return `${d} ${d === 1 ? "dia" : "dias"}`; }
  if (min >= 60 && min % 60 === 0) { const h = min / 60; return `${h} ${h === 1 ? "hora" : "horas"}`; }
  return `${min} min`;
}
/** 1440 → "24h". */

export const prazoCurto = (min) => (min % 60 === 0 ? `${min / 60}h` : `${min} min`);

export function nomeAtendimento(a) {
  if (a.modalidade === "AVALIACAO") return "avaliação";
  if (a.modalidade === "PILATES" && !a.experimental) return "aula";
  return "consulta";
}

export const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export const descAtendimento = (a) => `${a.avaliacao_para ? `Avaliação de ${PARA[a.avaliacao_para]}` : a.experimental ? "Aula experimental" : MOD[a.modalidade]} · ${fmtDiaLongo(a.inicio)} às ${fmtHora(a.inicio)}`;

/**
 * Lista de dias e horários livres para remarcar. Se houver horário livre no mesmo
 * dia do atendimento, pergunta antes se a pessoa quer ficar no mesmo dia.
 * onEscolher(item) recebe {horario_id} ou {inicio} (fisioterapia).
 */
