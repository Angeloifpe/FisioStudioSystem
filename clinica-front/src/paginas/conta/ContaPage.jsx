import { useState } from "react";
import { FotoPerfil } from "../../componentes/FotoPerfil";
import { Button, ErroBox, Field, SituacaoChip } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { AdminShell } from "../admin/AdminShell";
import { FormTrocarSenha } from "./FormTrocarSenha";
import { PacienteShell } from "../paciente/PacienteShell";
import { PATCH } from "../../servicos/api";
import { chaveDia, deChave, fmtDataBR, hoje } from "../../utils/datas";
import { duracaoTexto, fmtCPF, fmtTel } from "../../utils/formatos";

export function EditarDados({ me, onPronto }) {
  const { recarregarMe, toast } = useApp();
  const [f, setF] = useState({
    nome_completo: me.nome_completo || "", data_nascimento: String(me.data_nascimento || "").slice(0, 10),
    telefone: me.telefone || "", cpf: me.cpf || "", email: me.email || "", endereco: me.endereco || "",
  });
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
    setErros(e);
    return Object.keys(e).length === 0;
  }
  async function salvar(ev) {
    ev.preventDefault(); setErroApi(null);
    if (!validar()) return;
    setEnviando(true);
    try {
      await PATCH("/auth/me", {
        nome_completo: f.nome_completo.trim(), data_nascimento: f.data_nascimento,
        telefone: f.telefone.replace(/\D/g, ""), cpf: f.cpf.replace(/\D/g, ""),
        email: f.email.trim(), endereco: f.endereco.trim() || null,
      });
      await recarregarMe();
      toast("Dados atualizados.");
      onPronto();
    } catch (x) { setErroApi(x); } finally { setEnviando(false); }
  }
  return (
    <form onSubmit={salvar} noValidate style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label="Nome completo" required error={erros.nome_completo}><input autoComplete="name" value={f.nome_completo} onChange={up("nome_completo")} /></Field>
      <div className="field-row">
        <Field label="Data de nascimento" required error={erros.data_nascimento}><input type="date" max={chaveDia(new Date())} value={f.data_nascimento} onChange={up("data_nascimento")} /></Field>
        <Field label="Telefone / WhatsApp" required error={erros.telefone}><input type="tel" autoComplete="tel" value={f.telefone} onChange={up("telefone")} /></Field>
      </div>
      <div className="field-row">
        <Field label="CPF" required error={erros.cpf}><input inputMode="numeric" value={f.cpf} onChange={up("cpf")} /></Field>
        <Field label="E-mail" required error={erros.email}><input type="email" autoComplete="email" value={f.email} onChange={up("email")} /></Field>
      </div>
      <Field label="Endereço" optional="opcional"><input autoComplete="street-address" value={f.endereco} onChange={up("endereco")} /></Field>
      <ErroBox erro={erroApi} />
      <div className="ag-acoes">
        <Button type="submit" carregando={enviando}>Salvar alterações</Button>
        <Button type="button" variant="outline" onClick={onPronto}>Cancelar</Button>
      </div>
    </form>
  );
}

export function ContaPage() {
  const { me, sessao } = useApp();
  const [editando, setEditando] = useState(false);
  const Shell = sessao?.papel === "ADMIN" ? AdminShell : PacienteShell;
  return (
    <Shell ativa="conta">
      <div className="page-title"><div><h1>Minha conta</h1><p>{me?.email}</p></div></div>
      <div className="cols">
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card"><FotoPerfil /></div>
          {me?.paciente_id && (
            <div className="card">
              <div className="secao-titulo">
                <h3 style={{ fontSize: 22 }}>Meus dados</h3>
                {!editando && <Button size="sm" variant="outline" onClick={() => setEditando(true)}>Alterar dados</Button>}
              </div>
              {editando ? <EditarDados me={me} onPronto={() => setEditando(false)} /> : (
                <dl className="kv">
                  <dt>Nome</dt><dd>{me.nome_completo}</dd>
                  <dt>CPF</dt><dd>{fmtCPF(me.cpf)}</dd>
                  <dt>Nascimento</dt><dd>{fmtDataBR(me.data_nascimento)}</dd>
                  <dt>Telefone</dt><dd>{fmtTel(me.telefone)}</dd>
                  <dt>E-mail</dt><dd>{me.email}</dd>
                  <dt>Endereço</dt><dd>{me.endereco || "—"}</dd>
                  <dt>Situação</dt><dd><SituacaoChip situacao={me.situacao} /></dd>
                  <dt>Sessão de fisioterapia</dt><dd>{duracaoTexto(me.duracao_fisioterapia_min)}</dd>
                </dl>
              )}
            </div>
          )}
        </div>
        <div className="card col-side" style={{ alignSelf: "flex-start" }}>
          <h3 style={{ fontSize: 22, marginBottom: 14 }}>Trocar senha</h3>
          <FormTrocarSenha />
        </div>
      </div>
    </Shell>
  );
}
