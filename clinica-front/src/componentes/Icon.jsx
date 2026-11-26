// Ícones SVG simples e leves (sem dependências externas)
export const Icon = {
  // Logo oficial (branca, para fundos escuros). A imagem fica em img/logo-branco.png
  Logo: ({size = 150}) => (
    <img src="img/logo-branco.png" width={size} height={Math.round(size * 69 / 170)} alt="FisioStudio · Dra. Amaria Emanuelle" style={{ display: "block", maxWidth: "100%", height: "auto" }} />
  ),
  Menu: (p) => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" {...p}><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>),
  Close: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>),
  Chevron: ({dir="right", ...p}) => {
    const rot = {left:180, right:0, up:-90, down:90}[dir];
    return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{transform:`rotate(${rot}deg)`}} {...p}><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
  },
  Calendar: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  Clock: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/><path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  User: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/><path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  Search: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>),
  Check: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  CheckCircle: (p) => (<svg width="64" height="64" viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="10" fill="#8d5476"/><path d="M7 12.5l3 3 7-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>),
  Doc: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><path d="M7 3h7l5 5v13H7V3z" stroke="currentColor" strokeWidth="1.8"/><path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.8"/></svg>),
  Home: (p) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}><path d="M4 11l8-7 8 7v9a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>),
  Alert: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><path d="M12 3L2 21h20L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  Inbox: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><path d="M3 12l3-8h12l3 8v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M3 12h5l1.5 2.5h5L16 12h5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>),
  Bell: (p) => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...p}><path d="M6 9a6 6 0 0112 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  Settings: (p) => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...p}><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>),
  Logout: (p) => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}><path d="M9 21H5a1 1 0 01-1-1V4a1 1 0 011-1h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>),
};
