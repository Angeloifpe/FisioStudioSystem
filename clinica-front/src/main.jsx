import { createRoot } from "react-dom/client";
import "./estilos/base.css";
import "./estilos/componentes.css";
import "./estilos/telas.css";
import "./estilos/responsivo.css";
import "./estilos/painel.css";
import "./estilos/responsivo-ajustes.css";
import "./estilos/agenda.css";
import { App } from "./App";

createRoot(document.getElementById("root")).render(<App />);
