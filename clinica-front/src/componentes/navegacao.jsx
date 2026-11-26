import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "./Icon";
import { Avatar, Carregando } from "./basicos";
import { useApp } from "./contexto";
import { GET, POST } from "../servicos/api";
import { fmtRelativo } from "../utils/datas";

// ---------- Notificações (sininho) ----------
export function Sininho() {
  const { sessao } = useApp();
  const [n, setN] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState(null);
  const ref = useRef(null);

  const contar = useCallback(() => { GET("/notificacoes/contagem").then((r) => setN(r?.nao_lidas || 0)).catch(() => {}); }, []);
  useEffect(() => { contar(); const t = setInterval(contar, 30000); return () => clearInterval(t); }, [sessao?.token]);
  useEffect(() => {
    if (!aberto) return;
    GET("/notificacoes?limite=30").then(setLista).catch(() => setLista([]));
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  async function ler(item) {
    if (!item.lida_em) {
      await POST(`/notificacoes/${item.id}/lida`).catch(() => {});
      setLista((l) => l.map((x) => (x.id === item.id ? { ...x, lida_em: new Date().toISOString() } : x)));
      contar();
    }
  }
  async function lerTodas() {
    await POST("/notificacoes/ler-todas").catch(() => {});
    setLista((l) => (l || []).map((x) => ({ ...x, lida_em: x.lida_em || new Date().toISOString() })));
    setN(0);
  }

  return (
    <div className="sininho" ref={ref}>
      <button className="sininho-btn" onClick={() => setAberto((v) => !v)} aria-label={`Notificações (${n} não lidas)`}>
        <Icon.Bell />{n > 0 && <span className="sininho-badge">{n > 99 ? "99+" : n}</span>}
      </button>
      {aberto && (
        <div className="sininho-painel">
          <div className="sininho-topo">
            <strong>Notificações</strong>
            {n > 0 && <button className="btn-text" style={{ fontSize: 13 }} onClick={lerTodas}>Marcar todas como lidas</button>}
          </div>
          <div className="sininho-lista">
            {!lista && <Carregando />}
            {lista && lista.length === 0 && <p className="muted" style={{ padding: 18, fontSize: 14 }}>Nenhuma notificação por enquanto.</p>}
            {lista && lista.map((x) => (
              <button key={x.id} className={`sininho-item ${x.lida_em ? "" : "nao-lida"}`} onClick={() => ler(x)}>
                <span>{x.mensagem}</span>
                <small>{sessao?.papel === "ADMIN" && x.nome_completo ? `${x.nome_completo} · ` : ""}{fmtRelativo(x.criada_em)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Barra superior das áreas logadas ----------
export function AppBar({ nome, tabs, ativa, chip }) {
  const { sair, me } = useApp();
  const [menu, setMenu] = useState(false);
  return (
    <div className="appbar">
      <div className="container">
        <div className="appbar-inner">
          <a href="#/" className="logo-mark" style={{ marginRight: 8 }}><Icon.Logo size={130} color="#fff" /></a>
          {tabs && (
            <nav className="appbar-tabs">
              {tabs.map((t) => <a key={t.key} href={t.href} className={ativa === t.key ? "active" : ""}>{t.label}</a>)}
            </nav>
          )}
          <div className="appbar-user">
            {chip}
            <span className="user-name">{nome}</span>
            <Sininho />
            <a href="#/conta" title="Minha conta"><Avatar name={nome} foto={me?.foto_perfil} /></a>
            {tabs && <button className="hamburger" onClick={() => setMenu((v) => !v)} aria-label="Menu"><Icon.Menu /></button>}
            <button className="btn-icone-claro" onClick={sair} title="Sair" aria-label="Sair"><Icon.Logout /></button>
          </div>
        </div>
      </div>
      {tabs && menu && (
        <div className="menu-mobile">
          {tabs.map((t) => <a key={t.key} href={t.href} onClick={() => setMenu(false)}>{t.label}</a>)}
          <a href="#/conta" onClick={() => setMenu(false)}>Minha conta</a>
        </div>
      )}
    </div>
  );
}

export function NavInferior({ itens, ativa }) {
  return (
    <div className="mobile-admin-nav">
      {itens.map((it) => <a key={it.key} href={it.href} className={ativa === it.key ? "active" : ""}>{it.icon}<span>{it.label}</span></a>)}
    </div>
  );
}
