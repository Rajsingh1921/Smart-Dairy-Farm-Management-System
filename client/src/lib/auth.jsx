import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { useI18n } from './i18n.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null, lookups: null });
  const { setLang } = useI18n();

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/auth/me');
      if (!me.user) { setState({ loading: false, me: null, lookups: null }); return; }
      const lookups = await api.get('/lookups');
      setState({ loading: false, me, lookups });
      if (me.user.language) setLang(me.user.language);
    } catch {
      setState({ loading: false, me: null, lookups: null });
    }
  }, [setLang]);

  const reloadLookups = useCallback(async () => {
    const lookups = await api.get('/lookups');
    setState((s) => ({ ...s, lookups }));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState({ loading: false, me: null, lookups: null }));
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => {});
    setState({ loading: false, me: null, lookups: null });
  }, []);

  const can = useCallback((perm) => !!state.me?.permissions.includes(perm), [state.me]);
  const value = useMemo(() => ({ ...state, refresh, reloadLookups, logout, can }), [state, refresh, reloadLookups, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
