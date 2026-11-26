import { useState } from "react";
import { Icon } from "../../componentes/Icon";
import { Button, Decor, ErroBox, Field } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { POST } from "../../servicos/api";
import { chaveDia, deChave, hoje } from "../../utils/datas";

// ---------- Cadastro (POST /auth/cadastro) ----------
export function CadastroPage() {
  const { entrar, abrirLogin } = useApp();
  const [f, setF] = useState({ nome_completo: "", data_nascimento: "", telefone: "", cpf: "", email: "", endereco: "", senha: "", confirma: "" });
  const [aceite, setAceite] = useState(false);
  const [ver, setVer] = useState(false);
  const [verConf, setVerConf] = useState(false);
  const [erros, setErros] = useState({});
  const [erroApi, setErroApi] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const up = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  function validar() {
    const e = {};
    if (f.nome_completo.trim().length < 3) e.nome_completo = "Informe seu nome completo.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data_nascimento)) e.data_nascimento = "Informe sua data de nascimento.";
    else if (deChave(f.data_nascimento) >= hoje()) e.data_nascimento = "A data precisa ser no passado.";
    const tel = f.telefone.replace(/\D/g, "");
    if (tel.length < 10 || tel.length > 11) e.telefone = "Informe o telefone com DDD.";
    if (f.cpf.replace(/\D/g, "").length !== 11) e.cpf = "O CPF precisa ter 11 dígitos.";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Informe um e-mail válido.";
    if (f.senha.length < 8 || !/[a-zA-Z]/.test(f.senha) || !/\d/.test(f.senha)) e.senha = "Mínimo de 8 caracteres, com letras e números.";
    if (f.confirma !== f.senha) e.confirma = "As senhas não coincidem.";
    if (!aceite) e.aceite = "É preciso aceitar a Política de Privacidade para continuar.";
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function enviar(ev) {
    ev.preventDefault();
    setErroApi(null);
    if (!validar()) return;
    setEnviando(true);
    try {
      const r = await POST("/auth/cadastro", {
        nome_completo: f.nome_completo.trim(),
        data_nascimento: f.data_nascimento,
        telefone: f.telefone.replace(/\D/g, ""),
        cpf: f.cpf.replace(/\D/g, ""),
        email: f.email.trim(),
        endereco: f.endereco.trim() || undefined,
        senha: f.senha,
      });
      await entrar(r.token, "#/paciente/queixa?proximo=avaliacao");
    } catch (x) { setErroApi(x); } finally { setEnviando(false); }
  }

  return (
    <div className="split-screen">
      <div className="split-side">
        <Decor variant="side" />
        <div className="split-logo" style={{ position: "relative", zIndex: 2 }}><a href="#/"><Icon.Logo size={180} color="#fff" /></a></div>
        <div style={{ position: "relative", zIndex: 2 }}>
          <h2 className="split-title" style={{ color: "#fff" }}>Bem-vinda(o) ao FisioStudio</h2>
          <p className="split-sub">Crie sua conta e acompanhe seu cuidado em poucos passos.</p>
        </div>
        <div className="split-steps">
          {[["Crie sua conta", "Leva menos de 2 minutos."], ["Faça uma avaliação inicial ou já agende uma consulta", "pilates e/ou fisioterapia"], ["Agende suas sessões", "A clínica libera a modalidade avaliada."]].map(([t, d], i) => (
            <div className="step-row" key={t}><div className="step-num">{i + 1}</div><div className="step-text"><strong>{t}</strong><span>{d}</span></div></div>
          ))}
        </div>
      </div>
      <div className="split-main">
        <form className="card form-auth" style={{ maxWidth: 640, width: "100%" }} onSubmit={enviar} noValidate>
          <div>
            <h2 style={{ fontSize: 30 }}>Criar minha conta</h2>
            <p className="muted" style={{ marginTop: 4 }}>Preencha seus dados para começar.</p>
          </div>
          <Field label="Nome completo" required error={erros.nome_completo}>
            <input autoComplete="name" placeholder="Maria da Silva" value={f.nome_completo} onChange={up("nome_completo")} />
          </Field>
          <div className="field-row">
            <Field label="Data de nascimento" required error={erros.data_nascimento}>
              <input type="date" max={chaveDia(new Date())} value={f.data_nascimento} onChange={up("data_nascimento")} />
            </Field>
            <Field label="Telefone / WhatsApp" required error={erros.telefone}>
              <input type="tel" autoComplete="tel" placeholder="(81) 90000-0000" value={f.telefone} onChange={up("telefone")} />
            </Field>
          </div>
          <div className="field-row">
            <Field label="CPF" required error={erros.cpf}>
              <input inputMode="numeric" placeholder="000.000.000-00" value={f.cpf} onChange={up("cpf")} />
            </Field>
            <Field label="E-mail" required error={erros.email}>
              <input type="email" autoComplete="email" placeholder="voce@email.com" value={f.email} onChange={up("email")} />
            </Field>
          </div>
          <Field label="Endereço" optional="opcional">
            <input autoComplete="street-address" placeholder="Rua, número - bairro" value={f.endereco} onChange={up("endereco")} />
          </Field>
          <div className="field-row">
            <Field label="Senha" required error={erros.senha} hint="Mínimo de 8 caracteres, com letras e números.">
              <div className="input-wrap">
                <input style={{ border: "none", outline: "none", flex: 1, fontSize: 15, padding: 0 }} type={ver ? "text" : "password"} autoComplete="new-password" placeholder="Crie uma senha" value={f.senha} onChange={up("senha")} />
                <button type="button" className="btn-text" onClick={() => setVer((v) => !v)}>{ver ? "Ocultar" : "Mostrar"}</button>
              </div>
            </Field>
            <Field label="Confirmar senha" required error={erros.confirma}>
              <div className="input-wrap">
                <input style={{ border: "none", outline: "none", flex: 1, fontSize: 15, padding: 0 }} type={verConf ? "text" : "password"} autoComplete="new-password" placeholder="Repita a senha" value={f.confirma} onChange={up("confirma")} />
                <button type="button" className="btn-text" onClick={() => setVerConf((v) => !v)}>{verConf ? "Ocultar" : "Mostrar"}</button>
              </div>
            </Field>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
            <span>Li e aceito a <a href="#" onClick={(e) => e.preventDefault()}>Política de Privacidade</a> e o tratamento dos meus dados (LGPD).</span>
          </label>
          {erros.aceite && <span className="error-msg">{erros.aceite}</span>}
          <ErroBox erro={erroApi} />
          <div className="form-actions">
            <Button type="submit" size="lg" carregando={enviando}>Criar minha conta</Button>
            <button type="button" className="btn-text" style={{ alignSelf: "center" }} onClick={abrirLogin}>Já tenho conta · Entrar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
