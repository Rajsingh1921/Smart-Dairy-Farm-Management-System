import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/** Load data from an API path; reloads when the path/params change. */
export function useApi(path, params) {
  const key = path ? path + JSON.stringify(params || {}) : null;
  const [state, setState] = useState({ data: null, loading: !!path, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api.get(path, params);
      if (n === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (n === seq.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

/** Per-viewer convenience state (remembered tab etc.). Falls back silently. */
export function useLocalState(key, initial) {
  const [v, setV] = useState(() => {
    try { const s = localStorage.getItem(key); return s === null ? initial : JSON.parse(s); } catch { return initial; }
  });
  const set = useCallback((nv) => {
    setV(nv);
    try { localStorage.setItem(key, JSON.stringify(nv)); } catch { /* ignore */ }
  }, [key]);
  return [v, set];
}
