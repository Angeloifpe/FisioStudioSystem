import { Button, Decor } from "../../componentes/basicos";
import { ir, useApp } from "../../componentes/contexto";
import { PublicTopbar } from "./PublicTopbar";

export function HomePage() {
  const { abrirLogin } = useApp();
  return (
    <div className="hero">
      <Decor variant="hero" />
      <div className="container" style={{ position: "relative", zIndex: 2 }}><PublicTopbar /></div>
      <div className="hero-content">
        <div className="hero-badge"><img src="img/logo-circular.png" alt="Amaria Emanuelle" /></div>
        <h1 className="font-serif">Saúde e movimento em harmonia</h1>
        <p className="sub">Fisioterapia e Pilates com atendimento humanizado. Agende e acompanhe tudo por aqui.</p>
        <div className="hero-actions">
          <Button variant="cream" size="lg" onClick={() => ir("#/cadastro")}>Criar minha conta</Button>
          <Button variant="outline-light" size="lg" onClick={abrirLogin}>Já sou paciente</Button>
        </div>
      </div>
      <p className="hero-services text-center">Fisioterapia &nbsp;•&nbsp; Pilates</p>
    </div>
  );
}
