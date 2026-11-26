import { useEffect } from "react";

export function Redirecionar({ para }) { useEffect(() => { window.location.replace(para); }, [para]); return null; }
