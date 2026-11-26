import { useApp } from "../../componentes/contexto";
import { FormTrocarSenha } from "./FormTrocarSenha";

export function TrocarSenhaObrigatoriaPage() {
  const { me, sair, irParaInicio } = useApp();
  return (
    <div className="split-screen">
      <div className="split-main" style={{ width: "100%" }}>
        <div className="card" style={{ maxWidth: 560, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          <h2 style={{ fontSize: 28 }}>Crie uma senha nova</h2>
          <p className="muted">Você entrou com uma senha temporária{me?.email ? ` (${me.email})` : ""}. Para continuar, escolha uma senha só sua.</p>
          <FormTrocarSenha obrigatoria onPronto={irParaInicio} />
          <button className="btn-text" style={{ alignSelf: "center" }} onClick={sair}>Sair</button>
        </div>
      </div>
    </div>
  );
}

/** Sessão de fisioterapia em texto: 60 → "1 hora". */
