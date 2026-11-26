import { useState, useEffect } from "react";
import { Redirecionar } from "../../componentes/Redirecionar";
import { Button, Carregando, Field } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { EscolherHorario, useEnviar } from "./EscolherHorario";
import { PacienteShell } from "./PacienteShell";
import { regrasPaciente } from "./regras";
import { GET, POST } from "../../servicos/api";
import { MOD, PARA } from "../../utils/constantes";
import { fmtQuando } from "../../utils/datas";

export function AvaliacaoPage({ query }) {
  const { me, recarregarMe, toast } = useApp();
  const meus = useCarregar(() => GET("/agendamentos/meus"), []);
  const r = regrasPaciente(me, meus.dados);
  const opcoes = ["PILATES", "FISIOTERAPIA"].filter(r.podeAvaliar);
  const [para, setPara] = useState(query.para || null);
  const env = useEnviar();
  useEffect(() => { if (meus.dados && (!para || !opcoes.includes(para)) && opcoes.length) setPara(opcoes[0]); }, [meus.dados]);
  // Antes da primeira avaliação, o paciente conta sobre a queixa
  if (me && me.queixa_registrada === false) return <Redirecionar para={`#/paciente/queixa?proximo=avaliacao${query.para ? `&para=${query.para}` : ""}`} />;

  async function confirmar(h) {
    const ok = await env.enviar(() => POST("/agendamentos", { horario_id: h.id, avaliacao_para: para }));
    if (ok) { toast(`Avaliação de ${PARA[para]} marcada para ${fmtQuando(h.inicio)}.`); recarregarMe(); ir("#/paciente"); }
  }

  return (
    <PacienteShell ativa="inicio">
      <div className="page-title">
        <div>
          <h1>Marque sua avaliação inicial{para ? <> de <span style={{ color: "var(--primaria)" }}>{PARA[para]}</span></> : ""}</h1>
          <p>Escolha o melhor dia e horário. Depois da avaliação, a clínica libera a modalidade avaliada.</p>
        </div>
      </div>
      {meus.carregando && <Carregando />}
      {meus.dados && opcoes.length === 0 && (
        <div className="card" style={{ maxWidth: 620 }}>
          <h3 style={{ fontSize: 22, marginBottom: 8 }}>Nenhuma avaliação disponível para marcar</h3>
          <p className="muted">{me?.nova_avaliacao_bloqueada ? "Depois de não ser liberado(a), uma nova avaliação só pode ser marcada quando a clínica liberar." : "Você já tem avaliação marcada ou já foi liberado(a) nas duas modalidades."}</p>
          <Button style={{ marginTop: 16 }} variant="outline" onClick={() => ir("#/paciente")}>Voltar ao início</Button>
        </div>
      )}
      {meus.dados && opcoes.length > 0 && (
        <>
          <div className="card card-sm bloco-modalidade" style={{ marginBottom: 20 }}>
            <Field label="Avaliação para qual modalidade?" required>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {["PILATES", "FISIOTERAPIA"].map((m) => {
                  const pode = opcoes.includes(m);
                  return (
                    <label key={m} className={`radio-card ${para === m ? "selected" : ""}`} style={{ flex: 1, minWidth: 200, opacity: pode ? 1 : 0.5, cursor: pode ? "pointer" : "not-allowed" }}>
                      <input type="radio" style={{ display: "none" }} disabled={!pode} checked={para === m} onChange={() => setPara(m)} />
                      <span className="radio-dot">{para === m && <span className="inner" />}</span>
                      <span>{MOD[m]}<br /><small className="muted">{pode ? "Disponível" : r.liberado(m) ? "Você já está liberado(a)" : "Já marcada"}</small></span>
                    </label>
                  );
                })}
              </div>
            </Field>
          </div>
          <EscolherHorario modalidade="AVALIACAO" onConfirmar={confirmar} textoBotao="Confirmar avaliação"
            resumo={[["Atendimento", para ? `Avaliação de ${PARA[para]}` : null]]} enviando={env.enviando} erro={env.erro} />
        </>
      )}
    </PacienteShell>
  );
}
