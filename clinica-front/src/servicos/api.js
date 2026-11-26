// ===========================================================================
// Endereço da API
// Ordem: valor salvo pelo usuário > window.FISIO_API_URL (js/config.js) >
// mesma origem quando a página é servida pela própria API (/teste/...) > localhost:3333
// ===========================================================================
export function lerArmazenado(chave) { try { return localStorage.getItem(chave); } catch { return null; } }

export function gravarArmazenado(chave, valor) { try { valor == null ? localStorage.removeItem(chave) : localStorage.setItem(chave, valor); } catch {} }

export function apiBasePadrao() {
  if (window.FISIO_API_URL) return String(window.FISIO_API_URL).replace(/\/$/, "");
  if (location.protocol.startsWith("http") && location.pathname.startsWith("/teste")) return location.origin;
  return "http://localhost:3333";
}

export let API_BASE = (lerArmazenado("fisio_api_url") || apiBasePadrao()).replace(/\/$/, "");

export function definirApiBase(url) {
  API_BASE = (url || apiBasePadrao()).replace(/\/$/, "");
  gravarArmazenado("fisio_api_url", url ? API_BASE : null);
}

// ===========================================================================
// Cliente HTTP
// ===========================================================================
export class ApiErro extends Error {
  constructor(status, mensagem, campos) { super(mensagem); this.status = status; this.campos = campos || []; }
}

export let TOKEN = lerArmazenado("fisio_token");

export let aoExpirarSessao = () => {};
export function definirAoExpirarSessao(fn) { aoExpirarSessao = fn; }
export function definirToken(t) { TOKEN = t; }
export function lerToken() { return TOKEN; }

export async function api(metodo, caminho, corpo) {
  let resp;
  try {
    resp = await fetch(API_BASE + caminho, {
      method: metodo,
      headers: {
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
  } catch {
    throw new ApiErro(0, `Não consegui falar com a API em ${API_BASE}. Confira se ela está rodando.`);
  }
  let dados = null;
  const texto = await resp.text();
  if (texto) { try { dados = JSON.parse(texto); } catch { dados = { erro: texto }; } }
  if (!resp.ok) {
    if (resp.status === 401 && TOKEN && !caminho.startsWith("/auth/login")) aoExpirarSessao(dados?.erro);
    const campos = dados?.campos || [];
    const detalhe = campos.length ? ": " + campos.map((c) => c.mensagem).join("; ") : "";
    throw new ApiErro(resp.status, (dados?.erro || `Erro ${resp.status}`) + detalhe, campos);
  }
  return dados;
}

export const GET = (c) => api("GET", c);

export const POST = (c, b) => api("POST", c, b ?? {});

export const PATCH = (c, b) => api("PATCH", c, b ?? {});

export const PUT = (c, b) => api("PUT", c, b ?? {});

export const DEL = (c) => api("DELETE", c);

export function qs(obj) {
  const p = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&") : "";
}
