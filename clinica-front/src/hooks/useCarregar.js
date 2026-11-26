import { useState, useEffect } from "react";

// ===========================================================================
// Hook de carregamento
// ===========================================================================
export function useCarregar(fn, deps = []) {
  const [estado, setEstado] = useState({ dados: null, erro: null, carregando: true });
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    Promise.resolve().then(fn).then(
      (dados) => vivo && setEstado({ dados, erro: null, carregando: false }),
      (erro) => vivo && setEstado({ dados: null, erro, carregando: false }),
    );
    return () => { vivo = false; };
    // eslint-disable-next-line
  }, [...deps, versao]);
  return { ...estado, recarregar: () => setVersao((v) => v + 1) };
}
