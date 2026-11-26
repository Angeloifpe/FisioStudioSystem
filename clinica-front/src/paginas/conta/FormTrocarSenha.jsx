import { useState } from "react";
import { Button, ErroBox, Field } from "../../componentes/basicos";
import { useApp } from "../../componentes/contexto";
import { POST } from "../../servicos/api";

// ---------- Troca de senha (obrigatória com senha temporária, ou pela conta) ----------
export function FormTrocarSenha({ obrigatoria, onPronto }) {
  const { trocarToken, toast } = useApp();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);
  async function enviar(e) {
    e.preventDefault(); setErro(null);
    if (nova.length < 8 || !/[a-zA-Z]/.test(nova) || !/\d/.test(nova)) return setErro(new Error("A nova senha precisa ter 8 caracteres ou mais, com letras e números."));
    if (nova !== conf) return setErro(new Error("A confirmação não confere com a nova senha."));
    setEnviando(true);
    try {
      const r = await POST("/auth/trocar-senha", { senha_atual: atual, nova_senha: nova });
      await trocarToken(r.token);
      toast("Senha alterada.");
      setAtual(""); setNova(""); setConf("");
      onPronto && onPronto();
    } catch (x) { setErro(x); } finally { setEnviando(false); }
  }
  return (
    <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Field label={obrigatoria ? "Senha temporária (a que a clínica passou)" : "Senha atual"} required>
        <input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required />
      </Field>
      <div className="field-row">
        <Field label="Nova senha" required hint="8 ou mais caracteres, com letras e números.">
          <input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required />
        </Field>
        <Field label="Confirmar nova senha" required>
          <input type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} required />
        </Field>
      </div>
      <ErroBox erro={erro} />
      <Button type="submit" carregando={enviando}>Salvar nova senha</Button>
    </form>
  );
}
