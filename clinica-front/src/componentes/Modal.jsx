import { useState, useEffect } from "react";
import { Icon } from "./Icon";
import { Button, ErroBox } from "./basicos";
import { useApp } from "./contexto";

// ---------- Modal ----------
export function Modal({ open, onClose, title, subtitle, wide, children }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === "Escape" && onClose && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={`modal-box ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        {onClose && <button className="modal-close" onClick={onClose} aria-label="Fechar"><Icon.Close /></button>}
        {title && <h3 className="modal-title">{title}</h3>}
        {subtitle && <p className="modal-sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

export function ModalAcoes({ children }) { return <div className="modal-acoes">{children}</div>; }

/**
 * Modal de ação: roda `acao` ao confirmar, mostra o erro da API sem fechar
 * e fecha com toast no sucesso.
 */

export function ModalAcao({ open, onClose, title, subtitle, wide, textoBotao = "Confirmar", variante = "primary", acao, sucesso, children, desabilitar }) {
  const { toast } = useApp();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  useEffect(() => { if (open) setErro(null); }, [open]);
  async function confirmar(e) {
    e && e.preventDefault();
    setEnviando(true); setErro(null);
    try {
      const r = await acao();
      const msg = typeof sucesso === "function" ? sucesso(r) : sucesso;
      if (msg) toast(msg);
      onClose(r, true);
    } catch (x) { setErro(x); } finally { setEnviando(false); }
  }
  return (
    <Modal open={open} onClose={() => onClose()} title={title} subtitle={subtitle} wide={wide}>
      <form onSubmit={confirmar} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {children}
        <ErroBox erro={erro} />
        <ModalAcoes>
          <Button type="button" variant="outline" onClick={() => onClose()}>Voltar</Button>
          <Button type="submit" variant={variante} carregando={enviando} disabled={desabilitar}>{textoBotao}</Button>
        </ModalAcoes>
      </form>
    </Modal>
  );
}

// ---------- Toast ----------
export function Toast({ toast, onDone }) {
  useEffect(() => { if (!toast) return; const t = setTimeout(onDone, toast.erro ? 5000 : 3200); return () => clearTimeout(t); }, [toast]);
  if (!toast) return null;
  return <div className={`toast ${toast.erro ? "toast-erro" : ""}`} role="status">{toast.erro ? <Icon.Alert /> : <Icon.Check />} {toast.msg}</div>;
}
