// ===========================================================================
// Rótulos das regras do back
// ===========================================================================
export const MOD = { AVALIACAO: "Avaliação", FISIOTERAPIA: "Fisioterapia", PILATES: "Pilates" };

export const MOD_COR = { AVALIACAO: "amarelo", FISIOTERAPIA: "azul", PILATES: "roxo" };

export const PARA = { PILATES: "pilates", FISIOTERAPIA: "fisioterapia", AMBAS: "pilates e fisioterapia" };

export const STATUS = {
  AGENDADO: ["Agendado", "cinza"],
  CANCELAMENTO_SOLICITADO: ["Cancelamento pedido", "amarelo"],
  CANCELADO: ["Cancelado", "vermelho"],
  REALIZADO: ["Realizado", "verde"],
  FALTA: ["Falta", "vermelho"],
};

export const SITUACAO = {
  AGUARDANDO_AVALIACAO: ["Aguardando avaliação", "lilas"],
  LIBERADO: ["Liberado(a)", "verde"],
  NAO_LIBERADO: ["Não liberado(a)", "vermelho"],
  ALTA: ["Alta", "cinza"],
  INTERROMPIDO: ["Interrompido", "vermelho"],
};
