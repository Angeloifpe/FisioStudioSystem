import { useState, useEffect } from "react";
import { Button, ErroBox, Field, InfoBadge } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { useCarregar } from "../../hooks/useCarregar";
import { useEnviar } from "./EscolherHorario";
import { PacienteShell } from "./PacienteShell";
import { GET, PUT } from "../../servicos/api";
import { hojeISO, primeiroNome } from "../../utils/formatos";

export const MAX_QUEIXA = 500;

export function QueixaPage({ query }) {
  const { me, recarregarMe, toast } = useApp();
  const atual = useCarregar(() => GET("/queixa/minha"), []);
  const env = useEnviar();
  const [f, setF] = useState({ queixa: "", data: "", diag: "", semDiag: false });
  const [erros, setErros] = useState({});
  const [preenchido, setPreenchido] = useState(false);
  const fluxo = query.proximo === "avaliacao";

  useEffect(() => {
    if (atual.carregando || preenchido) return;
    if (atual.dados) setF({ queixa: atual.dados.queixa_principal || "", data: atual.dados.inicio_sintomas || "", diag: atual.dados.diagnostico_clinico || "", semDiag: !!atual.dados.sem_diagnostico });
    setPreenchido(true);
  }, [atual.carregando]);

  const muda = (campo, valor) => { setF((x) => ({ ...x, [campo]: valor })); setErros((e) => ({ ...e, [campo]: undefined })); };

  function validar() {
    const e = {};
    if (f.queixa.trim().length < 5) e.queixa = "Conte com suas palavras o que está te incomodando.";
    if (!f.data) e.data = "Informe a data (ou uma data aproximada).";
    else if (f.data > hojeISO()) e.data = "A data não pode ser no futuro.";
    else if (f.data < "1900-01-01") e.data = "Data inválida.";
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function salvar(ev) {
    ev.preventDefault();
    if (!validar()) return;
    const ok = await env.enviar(async () => {
      await PUT("/queixa/minha", {
        queixa_principal: f.queixa.trim(),
        inicio_sintomas: f.data,
        diagnostico_clinico: f.semDiag ? null : (f.diag.trim() || null),
        sem_diagnostico: f.semDiag,
      });
      return true;
    });
    if (!ok) return;
    toast(fluxo ? "Obrigado! Agora escolha o horário da avaliação." : "Informações salvas.");
    await recarregarMe();
    ir(fluxo ? `#/paciente/avaliacao${query.para ? `?para=${query.para}` : ""}` : "#/paciente");
  }

  const jaTinha = !!atual.dados;
  return (
    <PacienteShell ativa="inicio">
      <div className="page-title">
        <div>
          <h1>Olá, {primeiroNome(me?.nome_completo)}</h1>
          <h2 className="font-serif queixa-h2">{fluxo ? "Antes de agendar, conte sobre a sua queixa" : "Sobre a sua queixa"}</h2>
          <p>Essas informações ajudam a profissional a se preparar para a sua avaliação inicial.</p>
        </div>
      </div>
      <div className="cols">
        <form className="card col form-fixa" onSubmit={salvar} noValidate>
          <ErroBox erro={atual.erro} onTentar={atual.recarregar} />
          <Field label="Queixa principal" required error={erros.queixa}>
            <textarea className="ta-queixa" maxLength={MAX_QUEIXA} value={f.queixa} onChange={(e) => muda("queixa", e.target.value)}
              placeholder="Conte com suas palavras o que está te incomodando. Ex.: dor na lombar ao ficar sentada por muito tempo." />
            <div className="queixa-ajuda"><span>Descreva onde dói e o que piora ou melhora.</span><span>{f.queixa.length}/{MAX_QUEIXA}</span></div>
          </Field>
          <div className="queixa-linha">
            <Field label="Data do início dos sintomas" required error={erros.data} hint="Se não lembra o dia exato, informe uma data aproximada.">
              <input type="date" max={hojeISO()} min="1900-01-01" value={f.data} onChange={(e) => muda("data", e.target.value)} />
            </Field>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Field label="Diagnóstico clínico" optional="se houver">
                <textarea className="ta-diag" maxLength={MAX_QUEIXA} disabled={f.semDiag} value={f.semDiag ? "" : f.diag} onChange={(e) => muda("diag", e.target.value)}
                  placeholder="Ex.: hérnia de disco L4-L5, tendinite no ombro direito" />
              </Field>
              <label className="checkbox-row" style={{ alignItems: "center" }}>
                <input type="checkbox" checked={f.semDiag} onChange={(e) => setF((x) => ({ ...x, semDiag: e.target.checked, diag: e.target.checked ? "" : x.diag }))} />
                <span>Ainda não tenho diagnóstico</span>
              </label>
            </div>
          </div>
          <ErroBox erro={env.erro} />
          <div className="form-actions linha">
            <button type="button" className="btn-text" onClick={() => ir("#/paciente")}>‹ Voltar</button>
            <Button type="submit" size="lg" carregando={env.enviando} disabled={atual.carregando}>
              {fluxo ? "Continuar e escolher horário" : jaTinha ? "Salvar alterações" : "Salvar"}
            </Button>
          </div>
        </form>
        <div className="card col-side lateral-info" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <h3 style={{ fontSize: 22 }}>Como funciona</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {[["Sobre você", "Conte a queixa, quando começou e o diagnóstico, se houver."], ["Escolha o horário", "Veja os dias e horários livres para a avaliação inicial."], ["Avaliação na clínica", "Depois dela, a clínica libera seus agendamentos de fisioterapia e pilates."]].map(([t, d], i) => (
              <div key={t} style={{ display: "flex", gap: 14 }}>
                <div className="passo-num" style={{ background: i === 0 ? "var(--primaria)" : "var(--lilas-claro)", color: i === 0 ? "#fff" : "var(--primaria)" }}>{i + 1}</div>
                <div><p style={{ fontWeight: 600, fontSize: 15 }}>{t}</p><p className="muted" style={{ fontSize: 13 }}>{d}</p></div>
              </div>
            ))}
          </div>
          <InfoBadge>Seus dados de saúde são usados apenas para a sua avaliação, conforme a Política de Privacidade (LGPD).</InfoBadge>
        </div>
      </div>
    </PacienteShell>
  );
}
