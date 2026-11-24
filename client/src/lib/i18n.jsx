import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings.js';

const LangContext = createContext(null);

function readLang() {
  try { return localStorage.getItem('sdfm.lang') === 'mr' ? 'mr' : 'en'; } catch { return 'en'; }
}

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(readLang);
  useEffect(() => { document.documentElement.lang = lang === 'mr' ? 'mr' : 'en'; }, [lang]);
  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem('sdfm.lang', l); } catch { /* private mode */ }
  }, []);
  const t = useCallback((key, vars) => {
    const entry = STRINGS[key];
    let s = entry ? (lang === 'mr' ? entry[1] || entry[0] : entry[0]) : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
    return s;
  }, [lang]);
  /** Pick name_en / name_mr from a lookup row. */
  const ln = useCallback((row) => (row ? (lang === 'mr' ? row.name_mr || row.name_en : row.name_en) : ''), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, ln }), [lang, setLang, t, ln]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useI18n = () => useContext(LangContext);
