import { useState } from "react";
import { Icon } from "../../componentes/Icon";
import { Button, Carregando, Chip, ErroBox, ModChip, Vazio } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { AcoesAtendimentoPaciente, ItemAtendimento } from "./ItemAtendimento";
import { PacienteShell, PassosPaciente, chipPaciente } from "./PacienteShell";
import { regrasPaciente, textoPrazo } from "./regras";
import { GET, POST } from "../../servicos/api";
import { PARA } from "../../utils/constantes";
import { DIA_SEMANA_API, fmtDiaCurto, fmtQuando } from "../../utils/datas";
import { primeiroNome } from "../../utils/formatos";

// ---------- Início ----------
export function PacienteInicioPage({ query }) {
  const { me, recarregarMe, toast } = useApp();
  const meus = useCarregar(() => GET("/agendamentos/meus"), []);
  const repos = useCarregar(() => GET("/agendamentos/reposicoes-disponiveis"), []);
  const fixos = useCarregar(() => (me?.liberado_pilates ? GET("/pilates/fixos") : []), [me?.liberado_pilates]);
  const cfg = useCarregar(() => GET("/pilates/config").catch(() => null), []);
  const [pedindo, setPedindo] = useState(false);
  const r = regrasPaciente(me, meus.dados);
  const recarregar = () => { meus.recarregar(); repos.recarregar(); fixos.recarregar(); recarregarMe(); };

  async function pedirNovaAvaliacao() {
    setPedindo(true);
    try { await POST("/auth/pedir-nova-avaliacao"); toast("Pedido enviado. A clínica vai liberar a nova avaliação."); recarregarMe(); }
    catch (x) { toast(x.message, true); } finally { setPedindo(false); }
  }

  // "Próximo passo" conforme a situação e as liberações
  let passo = null;
  if (me && meus.dados) {
    const mods = ["PILATES", "FISIOTERAPIA"];
    const avaliaveis = mods.filter(r.podeAvaliar);
    const irAvaliar = (m) => ir(me.queixa_registrada ? `#/paciente/avaliacao?para=${m}` : `#/paciente/queixa?proximo=avaliacao&para=${m}`);
    if (me.situacao === "ALTA") passo = { cor: "cinza", titulo: "Você recebeu alta", texto: "Se precisar voltar, fale com a clínica para reabrir seu cadastro." };
    else if (me.situacao === "INTERROMPIDO") passo = { cor: "vermelho", titulo: "Tratamento interrompido", texto: "Fale com a clínica para voltar." };
    else if (me.nova_avaliacao_bloqueada) passo = {
      cor: "vermelho", titulo: "Não liberado(a) na última avaliação",
      texto: me.nova_avaliacao_pedida_em
        ? `Você pediu uma nova avaliação em ${fmtDiaCurto(me.nova_avaliacao_pedida_em)}. Quando a clínica liberar, você recebe um aviso.`
        : "Para fazer uma nova avaliação, peça à clínica. Ela libera e você marca pelo app.",
      botoes: me.nova_avaliacao_pedida_em ? [] : [<Button key="n" carregando={pedindo} onClick={pedirNovaAvaliacao}>Pedir nova avaliação</Button>],
    };
    else if (r.avaliacoesAtivas.length && !me.liberado_pilates && !me.liberado_fisioterapia) passo = {
      cor: "verde", titulo: "Sua avaliação está marcada",
      texto: "Compareça no horário. Depois dela, a clínica libera a modalidade avaliada e você passa a agendar por aqui.",
      botoes: [
        ...avaliaveis.map((m) => <Button key={m} variant="outline" size="sm" onClick={() => irAvaliar(m)}>Marcar também avaliação de {PARA[m]}</Button>),
        r.podeExperimental && <Button key="e" size="sm" variant="outline" onClick={() => ir("#/paciente/experimental")}>Aula experimental de pilates</Button>,
      ].filter(Boolean),
    };
    else if (!me.liberado_pilates && !me.liberado_fisioterapia) passo = {
      cor: "amarelo", titulo: "Próximo passo: marcar sua avaliação inicial",
      texto: (me.queixa_registrada ? "" : "Antes, conte à profissional sobre a sua queixa. ") + "Cada avaliação é de uma modalidade. Você só agenda a modalidade em que for liberado(a); para as duas, marque uma avaliação de cada.",
      botoes: [
        ...avaliaveis.map((m) => <Button key={m} size="sm" onClick={() => irAvaliar(m)}>Avaliação de {PARA[m]}</Button>),
        r.podeExperimental && <Button key="e" size="sm" variant="outline" onClick={() => ir("#/paciente/experimental")}>Aula experimental de pilates</Button>,
      ].filter(Boolean),
    };
    else {
      const botoes = [];
      if (me.liberado_pilates) botoes.push(<Button key="p" size="sm" onClick={() => ir("#/paciente/pilates")}>{(fixos.dados || []).length ? "Meus horários fixos de pilates" : "Escolher horários fixos de pilates"}</Button>);
      if (me.liberado_fisioterapia) botoes.push(<Button key="f" size="sm" onClick={() => ir("#/paciente/fisioterapia")}>Marcar fisioterapia</Button>);
      avaliaveis.forEach((m) => botoes.push(<Button key={m} size="sm" variant="outline" onClick={() => irAvaliar(m)}>Avaliação de {PARA[m]}</Button>));
      passo = {
        cor: "verde", titulo: "Agende suas sessões",
        texto: me.liberado_pilates && !(fixos.dados || []).length
          ? "No pilates, primeiro escolha seus dias e horários fixos (até 2 turmas, em dias diferentes). As aulas da turma ficam reservadas para você."
          : "Agende suas sessões quando quiser. Avisos e respostas da clínica chegam no sininho.",
        botoes,
      };
    }
  }

  const passoAtual = me?.liberado_pilates || me?.liberado_fisioterapia ? 3 : r.avaliacoesAtivas.length ? 2 : 1;

  return (
    <PacienteShell ativa="inicio">
      <div className="page-title">
        <div>
          <h1>Olá, {primeiroNome(me?.nome_completo)}</h1>
          <div className="so-mobile" style={{ marginTop: 8 }}>{chipPaciente(me)}</div>
          <p>{query.bemvindo ? "Sua conta foi criada. Vamos começar pela avaliação inicial." : "Acompanhe seus atendimentos e avisos da clínica."}</p>
        </div>
      </div>
      <ErroBox erro={meus.erro} onTentar={meus.recarregar} />
      <div className="cols">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {!meus.dados && meus.carregando && <div className="card"><Carregando /></div>}
          {passo && (
            <div className={`card passo-card passo-${passo.cor}`}>
              <p className="eyebrow">PRÓXIMO PASSO</p>
              <h2 style={{ fontSize: 26, margin: "4px 0 8px" }}>{passo.titulo}</h2>
              <p className="muted">{passo.texto}</p>
              {passo.botoes && passo.botoes.length > 0 && <div className="ag-acoes" style={{ marginTop: 16 }}>{passo.botoes}</div>}
            </div>
          )}

          {meus.dados && (
            <div className="card">
              <div className="secao-titulo">
                <h3>Próximos atendimentos</h3>
                <a className="btn-text" href="#/paciente/historico">{r.ativos.length > 5 ? `Ver todos (${r.ativos.length})` : "Ver todos"}</a>
              </div>
              {r.ativos.length === 0 && <Vazio>Nenhum atendimento marcado.</Vazio>}
              <div>
                {r.ativos.slice(0, 5).map((a) => (
                  <ItemAtendimento key={a.id} a={a} acoes={<AcoesAtendimentoPaciente a={a} onMudou={recarregar} antecedencia={cfg.dados?.antecedencia_aviso_falta_min ?? 1440} />} />
                ))}
              </div>
            </div>
          )}

          {repos.dados && repos.dados.length > 0 && (
            <div className="card">
              <div className="secao-titulo"><h3>Remarcações disponíveis</h3><Chip color="verde">{repos.dados.length}</Chip></div>
              <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>Atendimentos cancelados com remarcação liberada. Escolha um novo horário da mesma modalidade.</p>
              <div className="lista-simples">
                {repos.dados.map((x) => (
                  <div key={x.id} className="list-row" style={{ flexWrap: "wrap" }}>
                    <ModChip mod={x.modalidade} />
                    <span style={{ flex: 1, fontSize: 14 }}>Cancelado: {fmtQuando(x.cancelado_em_horario_de)}{x.motivo_cancelamento ? ` · ${x.motivo_cancelamento}` : ""}</span>
                    <Button size="sm" variant="outline" onClick={() => ir(`#/paciente/remarcar/${x.id}`)}>Escolher horário</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="card col-side lateral-info" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h3 style={{ fontSize: 22 }}>Como funciona</h3>
          <PassosPaciente atual={passoAtual} />
          {me?.queixa_registrada && !r.encerrado && <a className="btn-text" href="#/paciente/queixa" style={{ alignSelf: "flex-start" }}>Ver ou editar minha queixa</a>}
          {me?.liberado_pilates && (
            <div>
              <p className="eyebrow" style={{ marginBottom: 8 }}>SEUS HORÁRIOS FIXOS DE PILATES</p>
              {(fixos.dados || []).length === 0 ? <p className="muted" style={{ fontSize: 14 }}>Nenhum ainda.</p> :
                fixos.dados.map((f) => <p key={f.id} style={{ fontSize: 14, fontWeight: 600 }}>{DIA_SEMANA_API[f.dia_semana]} às {f.hora} <span className="muted" style={{ fontWeight: 400 }}>· {f.aulas_reservadas} aulas reservadas</span></p>)}
            </div>
          )}
          <div className="aviso-vermelho"><Icon.Alert /> <span>Avisando a falta com {textoPrazo(cfg.dados?.antecedencia_aviso_falta_min ?? 1440)} de antecedência, você ganha direito de remarcar e não paga pela consulta perdida.</span></div>
        </div>
      </div>
    </PacienteShell>
  );
}
