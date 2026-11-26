import { Icon } from "./Icon";
import { MOD, MOD_COR, SITUACAO, STATUS } from "../utils/constantes";

// ---------- Botão / chip / campos ----------
export function Button({ variant = "primary", size = "md", block, carregando, children, icon, disabled, ...rest }) {
  const cls = ["btn", `btn-${variant}`, size === "lg" && "btn-lg", size === "sm" && "btn-sm", block && "btn-block"].filter(Boolean).join(" ");
  return <button className={cls} disabled={disabled || carregando} {...rest}>{carregando ? <span className="spinner sm" /> : icon}{children}</button>;
}

export function Chip({ color = "lilas", dot, children, title }) {
  return <span className={`chip chip-${color}`} title={title}>{dot && <span className="chip-dot" />}{children}</span>;
}

export function StatusChip({ status }) { const [t, c] = STATUS[status] || [status, "cinza"]; return <Chip color={c}>{t}</Chip>; }

export function ModChip({ mod, experimental }) {
  return <Chip color={MOD_COR[mod] || "cinza"}>{experimental ? "Aula experimental" : MOD[mod] || mod}</Chip>;
}

export function SituacaoChip({ situacao }) { const [t, c] = SITUACAO[situacao] || [situacao, "cinza"]; return <Chip color={c} dot>{t}</Chip>; }

export function Field({ label, required, optional, hint, error, children }) {
  return (
    <div className={`field ${error ? "error" : ""}`}>
      {label && <label>{label}{required && <span className="req"> *</span>}{optional && <span className="opt">{optional}</span>}</label>}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error-msg">{error}</span>}
    </div>
  );
}

// ---------- Estados de carregamento ----------
export function Carregando({ texto = "Carregando..." }) {
  return <div className="estado-carregando"><span className="spinner" />{texto}</div>;
}

export function ErroBox({ erro, onTentar }) {
  if (!erro) return null;
  return (
    <div className="erro-box">
      <Icon.Alert />
      <div style={{ flex: 1 }}>{erro.message || String(erro)}</div>
      {onTentar && <button className="btn-text" onClick={onTentar}>Tentar de novo</button>}
    </div>
  );
}

export function Vazio({ children }) { return <p className="empty-state">{children}</p>; }

// ---------- Decoração ----------
export function Decor({ variant = "hero" }) {
  if (variant === "hero") {
    return <>
      <span className="decor" style={{ width: 380, height: 380, left: -120, top: -165, background: "rgba(255,255,255,.08)" }} />
      <span className="decor" style={{ width: 320, height: 320, right: -120, bottom: -100, background: "rgba(75,42,69,.25)" }} />
      <span className="decor" style={{ width: 160, height: 160, right: 60, top: -55, background: "rgba(255,255,255,.06)" }} />
    </>;
  }
  return <>
    <span className="decor" style={{ width: 310, height: 310, left: -100, top: -130, background: "rgba(255,255,255,.08)" }} />
    <span className="decor" style={{ width: 230, height: 230, left: 150, bottom: -120, background: "rgba(75,42,69,.3)" }} />
  </>;
}

export function Avatar({ name, foto }) { return <div className="avatar">{foto ? <img src={foto} alt="" /> : (name || "?").trim().charAt(0).toUpperCase()}</div>; }

export function InfoBadge({ children }) {
  return <div className="badge-info"><div className="badge-info-icon">i</div><div style={{ fontSize: 14, flex: 1 }}>{children}</div></div>;
}
