export const primeiroNome = (n) => (n || "").trim().split(/\s+/)[0] || "";

export const fmtCPF = (c) => (c && c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c || "—");

export const fmtTel = (t) => {
  const d = String(t || "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || "—";
};

export const duracaoTexto = (min) => (min === 60 ? "1 hora" : `${min} min`);

/** Reduz a foto escolhida para um quadrado de 256 px (JPEG) antes de enviar. */

// ---------- Sobre sua queixa ----------
export const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
