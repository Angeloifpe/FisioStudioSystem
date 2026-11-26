import { Icon } from "../../componentes/Icon";
import { Button } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";

export function PublicTopbar() {
  const { abrirLogin } = useApp();
  return (
    <div className="nav-row">
      <a href="#/" className="logo-mark"><Icon.Logo size={150} color="#fff" /></a>
      <div className="nav-actions">
        <Button variant="outline-light" size="sm" onClick={abrirLogin}>Entrar</Button>
        <Button variant="cream" size="sm" onClick={() => ir("#/cadastro")}>Criar conta</Button>
      </div>
    </div>
  );
}
