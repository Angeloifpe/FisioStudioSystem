import { useState, useEffect } from "react";
import { Toast } from "./componentes/Modal";
import { Redirecionar } from "./componentes/Redirecionar";

import { AppCtx, ir, useApp } from "./componentes/contexto";
import { AdminAgendaPage } from "./paginas/admin/AgendaPage";
import { AdminAtendimentosPage } from "./paginas/admin/AtendimentosPage";
import { AdminEvolucaoPage } from "./paginas/admin/EvolucaoPage";
import { AdminPacienteDetalhePage } from "./paginas/admin/PacienteDetalhePage";
import { AdminPacientesPage } from "./paginas/admin/PacientesPage";
import { AdminPainelPage } from "./paginas/admin/PainelPage";
import { AdminPedidosPage } from "./paginas/admin/PedidosPage";
import { ContaPage } from "./paginas/conta/ContaPage";
import { TrocarSenhaObrigatoriaPage } from "./paginas/conta/TrocarSenhaObrigatoriaPage";
import { AvaliacaoPage } from "./paginas/paciente/AvaliacaoPage";
import { ExperimentalPage } from "./paginas/paciente/ExperimentalPage";
import { FisioterapiaPage } from "./paginas/paciente/FisioterapiaPage";
import { HistoricoPacientePage } from "./paginas/paciente/HistoricoPage";
import { PacienteInicioPage } from "./paginas/paciente/InicioPage";
import { PilatesPage } from "./paginas/paciente/PilatesPage";
import { QueixaPage } from "./paginas/paciente/QueixaPage";
import { RemarcarPage } from "./paginas/paciente/RemarcarPage";
import { CadastroPage } from "./paginas/publico/CadastroPage";
import { HomePage } from "./paginas/publico/HomePage";
import { LoginModal } from "./paginas/publico/LoginModal";
import { GET, TOKEN, definirAoExpirarSessao, definirToken, gravarArmazenado, lerArmazenado, lerToken } from "./servicos/api";

// ===========================================================================
// Sessão + rotas
// ===========================================================================
export function lerRota() {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [caminho, busca = ""] = h.split("?");
  const query = Object.fromEntries(new URLSearchParams(busca));
  return { partes: caminho.split("/").filter(Boolean), query, hash: h };
}

export function useRota() {
  const [rota, setRota] = useState(lerRota);
  useEffect(() => { const f = () => setRota(lerRota()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return rota;
}

export function App() {
  const rota = useRota();
  const [sessao, setSessao] = useState(() => (TOKEN ? { token: lerToken(), papel: lerArmazenado("fisio_papel") } : null));
  const [me, setMe] = useState(null);
  const [carregandoMe, setCarregandoMe] = useState(!!lerToken());
  const [loginAberto, setLoginAberto] = useState(false);
  const [toastInfo, setToastInfo] = useState(null);

  const toast = (msg, erro = false) => setToastInfo({ msg, erro, t: Date.now() });

  function limparSessao() {
    definirToken(null); gravarArmazenado("fisio_token", null); gravarArmazenado("fisio_papel", null);
    setSessao(null); setMe(null);
  }
  definirAoExpirarSessao((msg) => { limparSessao(); toast(msg || "Sua sessão expirou. Entre de novo.", true); ir("#/"); });

  async function carregarMe() {
    const dados = await GET("/auth/me");
    setMe(dados);
    setSessao((s) => ({ ...(s || {}), token: lerToken(), papel: dados.papel }));
    gravarArmazenado("fisio_papel", dados.papel);
    return dados;
  }
  async function entrar(token, destino) {
    definirToken(token); gravarArmazenado("fisio_token", token);
    setCarregandoMe(true);
    try {
      const dados = await carregarMe();
      if (dados.trocar_senha) ir("#/trocar-senha");
      else ir(dados.papel === "ADMIN" ? "#/admin" : destino || "#/paciente");
    } catch (x) { limparSessao(); toast(x.message, true); } finally { setCarregandoMe(false); }
  }
  async function trocarToken(token) { definirToken(token); gravarArmazenado("fisio_token", token); await carregarMe(); }
  const recarregarMe = () => carregarMe().catch(() => {});
  const sair = () => { limparSessao(); ir("#/"); };
  const irParaInicio = () => ir(me?.papel === "ADMIN" ? "#/admin" : "#/paciente");

  useEffect(() => {
    if (!lerToken()) return;
    carregarMe().catch((x) => { if (x.status !== 401) toast(x.message, true); limparSessao(); }).finally(() => setCarregandoMe(false));
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [rota.hash.split("?")[0]]);

  const ctx = { sessao, me, entrar, sair, trocarToken, recarregarMe, irParaInicio, toast, abrirLogin: () => setLoginAberto(true) };

  let pagina;
  const [p0, p1, p2] = rota.partes;
  const logado = !!(sessao && me);
  if (carregandoMe) pagina = <div className="loading-screen"><span className="spinner" style={{ marginRight: 12 }} />Carregando…</div>;
  else if (logado && me.trocar_senha) pagina = <TrocarSenhaObrigatoriaPage />;
  else if (!p0) pagina = logado ? <Redirecionar para={me.papel === "ADMIN" ? "#/admin" : "#/paciente"} /> : <HomePage />;
  else if (p0 === "cadastro") pagina = logado ? <Redirecionar para={me.papel === "PACIENTE" && me.queixa_registrada === false ? "#/paciente/queixa?proximo=avaliacao" : me.papel === "ADMIN" ? "#/admin" : "#/paciente"} /> : <CadastroPage />;
  else if (!logado) pagina = <ExigeLogin />;
  else if (p0 === "conta") pagina = <ContaPage />;
  else if (p0 === "paciente") {
    if (me.papel !== "PACIENTE") pagina = <Redirecionar para="#/admin" />;
    else if (!p1) pagina = <PacienteInicioPage query={rota.query} />;
    else if (p1 === "queixa") pagina = <QueixaPage query={rota.query} />;
    else if (p1 === "avaliacao") pagina = <AvaliacaoPage query={rota.query} />;
    else if (p1 === "experimental") pagina = <ExperimentalPage />;
    else if (p1 === "fisioterapia") pagina = <FisioterapiaPage />;
    else if (p1 === "pilates") pagina = <PilatesPage />;
    else if (p1 === "remarcar" && p2) pagina = <RemarcarPage id={p2} />;
    else if (p1 === "historico") pagina = <HistoricoPacientePage />;
    else pagina = <NaoEncontrada />;
  } else if (p0 === "admin") {
    if (me.papel !== "ADMIN") pagina = <Redirecionar para="#/paciente" />;
    else if (!p1) pagina = <AdminPainelPage />;
    else if (p1 === "atendimentos") pagina = <AdminAtendimentosPage query={rota.query} />;
    else if (p1 === "pedidos") pagina = <AdminPedidosPage />;
    else if (p1 === "pacientes" && p2) pagina = <AdminPacienteDetalhePage id={p2} />;
    else if (p1 === "pacientes") pagina = <AdminPacientesPage query={rota.query} />;
    else if (p1 === "agenda") pagina = <AdminAgendaPage query={rota.query} />;
    else if (p1 === "evolucao") pagina = <AdminEvolucaoPage query={rota.query} />;
    else pagina = <NaoEncontrada />;
  } else pagina = <NaoEncontrada />;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app-root">{pagina}</div>
      <LoginModal open={loginAberto} onClose={() => setLoginAberto(false)} />
      <Toast toast={toastInfo} onDone={() => setToastInfo(null)} />
    </AppCtx.Provider>
  );
}

export function ExigeLogin() {
  const { abrirLogin } = useApp();
  useEffect(() => { ir("#/"); abrirLogin(); }, []);
  return null;
}

export function NaoEncontrada() {
  return <div className="empty-state" style={{ paddingTop: 80 }}><h2>Página não encontrada</h2><a className="btn-text" href="#/">Voltar ao início</a></div>;
}
