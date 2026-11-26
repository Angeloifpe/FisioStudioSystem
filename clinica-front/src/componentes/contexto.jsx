import { useContext, createContext } from "react";

// ===========================================================================
// Contexto da aplicação
// ===========================================================================
export const AppCtx = createContext(null);

export const useApp = () => useContext(AppCtx);

export const ir = (hash) => { window.location.hash = hash; };
