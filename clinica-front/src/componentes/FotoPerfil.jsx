import { useState, useRef } from "react";
import { Button } from "./basicos";
import { useApp } from "./contexto";
import { DEL, PUT } from "../servicos/api";

export function reduzirFoto(arquivo) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const lado = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      c.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 256, 256);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui ler essa imagem. Use JPEG, PNG ou WebP.")); };
    img.src = url;
  });
}

export function FotoPerfil() {
  const { me, recarregarMe, toast } = useApp();
  const [enviando, setEnviando] = useState(false);
  const entrada = useRef(null);
  async function escolher(e) {
    const arq = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!arq) return;
    if (!/^image\/(jpeg|png|webp)$/.test(arq.type)) return toast("Use uma imagem JPEG, PNG ou WebP.", true);
    setEnviando(true);
    try { await PUT("/auth/me/foto", { foto: await reduzirFoto(arq) }); await recarregarMe(); toast("Foto de perfil atualizada."); }
    catch (x) { toast(x.message, true); } finally { setEnviando(false); }
  }
  async function remover() {
    setEnviando(true);
    try { await DEL("/auth/me/foto"); await recarregarMe(); toast("Foto removida."); }
    catch (x) { toast(x.message, true); } finally { setEnviando(false); }
  }
  return (
    <div className="foto-perfil">
      <div className="avatar avatar-grande">{me?.foto_perfil ? <img src={me.foto_perfil} alt="Foto de perfil" /> : (me?.nome_completo || me?.email || "?").trim().charAt(0).toUpperCase()}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={escolher} />
        <Button size="sm" variant="outline" carregando={enviando} onClick={() => entrada.current && entrada.current.click()}>{me?.foto_perfil ? "Alterar foto" : "Adicionar foto de perfil"}</Button>
        {me?.foto_perfil && <button type="button" className="btn-text" disabled={enviando} onClick={remover}>Remover foto</button>}
      </div>
    </div>
  );
}
