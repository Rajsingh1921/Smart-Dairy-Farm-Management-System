import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useI18n } from '../lib/i18n.jsx';
import { Button, Field, ErrorBox, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { t, lang, setLang } = useI18n();
  const { refresh } = useAuth();
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ username: '', password: '', full_name: '', confirm: '', farm_name: '', setup_token: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => { api.get('/auth/setup-status').then(setStatus).catch((e) => setError(e)); }, []);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (status.needsSetup && f.password !== f.confirm) { setError(new Error(t('auth.mismatch'))); return; }
    setBusy(true);
    try {
      if (status.needsSetup) await api.post('/auth/setup', { full_name: f.full_name, username: f.username, password: f.password, farm_name: f.farm_name || undefined, setup_token: f.setup_token || undefined });
      else await api.post('/auth/login', { username: f.username, password: f.password });
      await refresh();
    } catch (err) {
      setError(err.details?.length ? new Error(err.details.map((d) => d.message).join('. ')) : err);
    } finally {
      setBusy(false);
    }
  }

  const setup = status?.needsSetup;
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-lang">
          <div className="seg" role="radiogroup" aria-label={t('auth.chooseLang')}>
            <button type="button" role="radio" aria-checked={lang === 'mr'} className={lang === 'mr' ? 'on' : ''} onClick={() => setLang('mr')} lang="mr">मराठी</button>
            <button type="button" role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} lang="en">English</button>
          </div>
        </div>
        <div className="auth-brand">
          <img className="brand-logo" src="/logo.png" alt="" width="112" height="112" />
          <div className="brand-name">{t('app.name')}</div>
        </div>
        {!status && !error && <Spinner />}
        {status && (
          <>
            <h2>{setup ? t('auth.setupTitle') : t('auth.welcome')}</h2>
            <p className="muted small">{setup ? t('auth.setupSubtitle') : t('auth.subtitle')}</p>
            <form onSubmit={submit}>
              {setup && <Field label={t('auth.fullName')} required><input value={f.full_name} onChange={set('full_name')} required maxLength={100} autoComplete="name" /></Field>}
              {setup && <Field label={t('auth.farmName')}><input value={f.farm_name} onChange={set('farm_name')} maxLength={120} /></Field>}
              <Field label={t('c.username')} required><input value={f.username} onChange={set('username')} required autoComplete="username" autoCapitalize="none" /></Field>
              <Field label={t('c.password')} required hint={setup ? t('auth.passwordHint') : null}>
                <input type="password" value={f.password} onChange={set('password')} required autoComplete={setup ? 'new-password' : 'current-password'} />
              </Field>
              {setup && <Field label={t('auth.confirmPassword')} required><input type="password" value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>}
              {setup && status.tokenRequired && <Field label={t('auth.setupToken')} required><input value={f.setup_token} onChange={set('setup_token')} required /></Field>}
              <ErrorBox error={error} />
              <Button type="submit" loading={busy}>{setup ? t('auth.createOwner') : busy ? t('auth.loggingIn') : t('auth.login')}</Button>
            </form>
          </>
        )}
        {!status && error && <ErrorBox error={error} />}
      </div>
    </div>
  );
}
