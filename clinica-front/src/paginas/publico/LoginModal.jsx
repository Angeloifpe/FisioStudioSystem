import { useState, useEffect } from "react";
import { Icon } from "../../componentes/Icon";
import { Modal } from "../../componentes/Modal";
import { Button, ErroBox, Field } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { API_BASE, POST, definirApiBase } from "../../servicos/api";

// ---------- Login ----------
export function LoginModal({ open, onClose }) {
  const { entrar } = useApp();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [configAberta, setConfigAberta] = useState(false);
  const [url, setUrl] = useState(API_BASE);
  useEffect(() => { if (open) { setErro(null); setUrl(API_BASE); } }, [open]);

  async function enviar(e) {
    e.preventDefault();
    setEnviando(true); setErro(null);
    try {
      const r = await POST("/auth/login", { email, senha });
      onClose();
      setSenha("");
      await entrar(r.token);
    } catch (x) { setErro(x); } finally { setEnviando(false); }
  }
  function salvarUrl() { definirApiBase(url.trim() || null); setUrl(API_BASE); setConfigAberta(false); }

  return (
    <Modal open={open} onClose={onClose} title="Entrar no FisioStudio" subtitle="Pacientes e equipe da clínica usam o mesmo acesso.">
      <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="E-mail" required>
          <input type="email" autoComplete="email" placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Senha" required>
          <div className="input-wrap">
            <input style={{ border: "none", outline: "none", flex: 1, fontSize: 15, padding: 0 }} type={mostrar ? "text" : "password"} autoComplete="current-password" placeholder="Sua senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            <button type="button" className="btn-text" onClick={() => setMostrar((v) => !v)}>{mostrar ? "Ocultar" : "Mostrar"}</button>
          </div>
        </Field>
        <ErroBox erro={erro} />
        <Button type="submit" size="lg" carregando={enviando}>Entrar</Button>
        <p className="muted text-center" style={{ fontSize: 13 }}>Esqueceu a senha? Peça à clínica uma senha temporária.</p>
        <button type="button" className="btn-text" style={{ alignSelf: "center", fontSize: 13 }} onClick={() => { onClose(); ir("#/cadastro"); }}>Ainda não tenho conta · Criar conta</button>
        <div className="config-api">
          <Icon.Settings /> API: <code>{API_BASE}</code>
          <button type="button" className="btn-text" style={{ fontSize: 12 }} onClick={() => setConfigAberta((v) => !v)}>alterar</button>
        </div>
        {configAberta && (
          <div style={{ display: "flex", gap: 8 }}>
            <input className="select-inline" style={{ flex: 1 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3333" />
            <Button type="button" variant="outline" size="sm" onClick={salvarUrl}>Salvar</Button>
          </div>
        )}
      </form>
    </Modal>
  );
}
