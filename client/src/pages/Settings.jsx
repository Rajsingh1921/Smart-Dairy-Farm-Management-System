import { useState } from 'react';
import { Plus, Pencil, Trash2, KeyRound, Download, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { fmtDateTime } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Table, Spinner, ErrorBox, Card, Badge, Alert, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';

function Farm() {
  const { t } = useI18n();
  const { can, refresh } = useAuth();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi('/settings');
  const [edit, setEdit] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const rows = [
    ['farm_name', t('se.farmName')], ['farm_address', t('c.address')], ['farm_phone', t('c.phone')], ['invoice_footer', t('se.invoiceFooter')],
    ['payment_terms_days', t('se.terms')], ['pd_check_days', t('se.pdDays')], ['calving_alert_days', t('se.calvingDays')], ['reminder_window_days', t('se.windowDays')],
  ];
  return (
    <Card actions={can('settings.write') && <Button icon={Pencil} onClick={() => setEdit(true)}>{t('c.edit')}</Button>}>
      <div className="kv">{rows.map(([k, l]) => <div key={k}><span>{l}</span><b>{data[k] || '—'}</b></div>)}</div>
      {edit && (
        <FormModal title={t('se.farm')} onClose={() => setEdit(false)} initial={data}
          fields={[
            { name: 'farm_name', label: t('se.farmName'), required: true, full: true },
            { name: 'farm_address', label: t('c.address'), full: true },
            { name: 'farm_phone', label: t('c.phone') },
            { name: 'invoice_footer', label: t('se.invoiceFooter') },
            { name: 'payment_terms_days', label: t('se.terms'), type: 'number', min: 0, max: 90, step: 1, required: true },
            { name: 'pd_check_days', label: t('se.pdDays'), type: 'number', min: 30, max: 120, step: 1, required: true },
            { name: 'calving_alert_days', label: t('se.calvingDays'), type: 'number', min: 1, max: 90, step: 1, required: true },
            { name: 'reminder_window_days', label: t('se.windowDays'), type: 'number', min: 1, max: 60, step: 1, required: true },
          ]}
          onSubmit={async (v) => { await api.put('/settings', v); toast(t('c.saved')); setEdit(false); reload(); refresh(); }} />
      )}
    </Card>
  );
}

function Users() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const { data, loading, error, reload } = useApi('/users');
  const [modal, setModal] = useState(null);
  const roles = ['owner', 'manager', 'accountant', 'staff'].map((r) => ({ value: r, label: t(`role.${r}`) }));
  return (
    <Card actions={<Button icon={Plus} onClick={() => setModal({ type: 'add' })}>{t('se.addUser')}</Button>}>
      <Alert kind="info">{t('se.roleHelp')}</Alert>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : <Table rows={data} columns={[
        { key: 'full_name', label: t('c.name'), render: (r) => <><b>{r.full_name}</b>{r.id === me.user.id && <> <Badge tone="green">you</Badge></>}</> },
        { key: 'username', label: t('c.username') },
        { key: 'role', label: t('c.role'), render: (r) => t(`role.${r.role}`) },
        { key: 'is_active', label: t('c.status'), render: (r) => <Badge tone={r.is_active ? 'green' : 'gray'}>{r.is_active ? t('c.active') : t('c.inactive')}</Badge> },
        { key: 'last_login_at', label: t('se.lastLogin'), render: (r) => <span className="small">{fmtDateTime(r.last_login_at)}</span> },
        { key: 'a', label: '', render: (r) => (
          <div className="row nowrap">
            <Button size="sm" variant="link" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ type: 'edit', row: { ...r, is_active: !!r.is_active } })} />
            <Button size="sm" variant="link" icon={KeyRound} aria-label={t('se.resetPassword')} onClick={() => setModal({ type: 'reset', row: r })} />
          </div>
        ) },
      ]} />}
      {modal?.type === 'add' && (
        <FormModal title={t('se.addUser')} onClose={() => setModal(null)} initial={{ role: 'staff' }}
          fields={[
            { name: 'full_name', label: t('c.name'), required: true },
            { name: 'username', label: t('c.username'), required: true, autoComplete: 'off' },
            { name: 'password', label: t('c.password'), type: 'password', required: true, hint: t('auth.passwordHint'), autoComplete: 'new-password' },
            { name: 'role', label: t('c.role'), type: 'select', placeholder: false, options: roles },
          ]}
          onSubmit={async (v) => { await api.post('/users', v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
      {modal?.type === 'edit' && (
        <FormModal title={t('se.editUser')} onClose={() => setModal(null)} initial={modal.row}
          fields={[
            { name: 'full_name', label: t('c.name'), required: true },
            { name: 'role', label: t('c.role'), type: 'select', placeholder: false, options: roles },
            { name: 'is_active', label: t('c.active'), type: 'checkbox' },
          ]}
          onSubmit={async (v) => { await api.put(`/users/${modal.row.id}`, v); toast(t('c.saved')); setModal(null); reload(); }} />
      )}
      {modal?.type === 'reset' && (
        <FormModal title={`${t('se.resetPassword')} — ${modal.row.username}`} onClose={() => setModal(null)}
          fields={[{ name: 'password', label: t('auth.newPassword'), type: 'password', required: true, hint: t('auth.passwordHint'), autoComplete: 'new-password', full: true }]}
          onSubmit={async (v) => { await api.post(`/users/${modal.row.id}/reset-password`, v); toast(t('c.saved')); setModal(null); }} />
      )}
    </Card>
  );
}

function LookupCard({ title, path, rows, cols, fields, defaults, hint }) {
  const { t } = useI18n();
  const { reloadLookups } = useAuth();
  const { toast, confirm } = useToast();
  const [modal, setModal] = useState(null);
  return (
    <Card title={title} actions={<Button size="sm" icon={Plus} onClick={() => setModal({ ...defaults })}>{t('c.add')}</Button>}>
      {hint && <p className="muted small">{hint}</p>}
      <Table rows={rows} columns={[...cols, { key: 'is_active', label: t('c.status'), render: (r) => (r.is_active ? '' : <Badge>{t('c.inactive')}</Badge>) }, { key: 'a', label: '', render: (r) => (
        <div className="row nowrap">
          <Button size="sm" variant="link" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, ['is_active', 'is_milking'].includes(k) ? !!v : k === 'species_id' ? String(v) : v])))} />
          <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
            if (!(await confirm(t('c.confirmDelete')))) return;
            try { await api.del(`/lookups/${path}/${r.id}`); toast(t('c.deleted')); reloadLookups(); } catch (e) { toast(e.message, 'error'); }
          }} />
        </div>
      ) }]} />
      {modal && (
        <FormModal title={title} onClose={() => setModal(null)} initial={modal} fields={[...fields(!!modal.id), { name: 'is_active', label: t('c.active'), type: 'checkbox' }]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/lookups/${path}/${modal.id}`, v); else await api.post(`/lookups/${path}`, v); toast(t('c.saved')); setModal(null); reloadLookups(); }} />
      )}
    </Card>
  );
}

function Lookups() {
  const { t, ln } = useI18n();
  const { lookups } = useAuth();
  const names = (editing, codeLocked) => [
    { name: 'code', label: t('se.code'), required: true, pattern: '[a-z0-9_]{2,30}', hint: 'a-z, 0-9, _', disabled: editing && codeLocked },
    { name: 'name_en', label: t('se.nameEn'), required: true },
    { name: 'name_mr', label: t('se.nameMr'), required: true },
  ];
  return (
    <div className="grid grid-2">
      <LookupCard title={t('se.categories')} path="categories" rows={lookups.categories} defaults={{ is_active: true, is_milking: false, sort_order: 10 }}
        cols={[{ key: 'code', label: t('se.code') }, { key: 'n', label: t('c.name'), render: (r) => ln(r) }, { key: 'm', label: t('dash.milking'), render: (r) => (r.is_milking ? '✓' : '') }]}
        fields={(e) => [...names(e, false), { name: 'is_milking', label: t('se.isMilking'), type: 'checkbox', full: true }, { name: 'sort_order', label: t('se.sortOrder'), type: 'number', min: 0, step: 1 }]} />
      <LookupCard title={t('se.species')} path="species" rows={lookups.species} defaults={{ is_active: true, gestation_days: 283 }} hint={t('se.gestationHint')}
        cols={[{ key: 'code', label: t('se.code') }, { key: 'n', label: t('c.name'), render: (r) => ln(r) }, { key: 'gestation_days', label: t('se.gestation'), align: 'right' }]}
        fields={(e) => [...names(e, false), { name: 'gestation_days', label: t('se.gestation'), type: 'number', min: 200, max: 400, step: 1, required: true }]} />
      <LookupCard title={t('se.breeds')} path="breeds" rows={lookups.breeds} defaults={{ is_active: true, species_id: String(lookups.species[0]?.id || '') }}
        cols={[{ key: 'name', label: t('c.name') }, { key: 's', label: t('an.species'), render: (r) => ln(lookups.species.find((s) => s.id === r.species_id)) }]}
        fields={() => [{ name: 'species_id', label: t('an.species'), type: 'select', required: true, placeholder: false, options: lookups.species.map((s) => ({ value: String(s.id), label: ln(s) })) }, { name: 'name', label: t('c.name'), required: true }]} />
      <LookupCard title={t('se.expenseCats')} path="expense-categories" rows={lookups.expenseCategories} defaults={{ is_active: true }}
        cols={[{ key: 'code', label: t('se.code') }, { key: 'n', label: t('c.name'), render: (r) => ln(r) }]}
        fields={(e) => names(e, true)} />
    </div>
  );
}

function Backup() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const { toast, confirm } = useToast();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  return (
    <div className="grid grid-2">
      <Card title={t('se.download')}>
        <p className="small">{t('se.backupHelp')}</p>
        <p className="small muted">{t('se.photosNote')}</p>
        <Button icon={Download} loading={busy} onClick={async () => { setBusy(true); try { await api.download('/backup/export', null, 'dairy-backup.json'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); } }}>{t('se.download')}</Button>
      </Card>
      <Card title={t('se.restore')}>
        <Alert kind="warn">{t('se.restoreWarn')}</Alert>
        <Field label={t('se.chooseFile')}><input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <div className="mt"><Button variant="danger" icon={Upload} disabled={!file} loading={busy} onClick={async () => {
          const typed = await confirm(t('se.restoreWarn'), { input: { label: 'REPLACE', required: true } });
          if (typed !== 'REPLACE') return;
          setBusy(true);
          try {
            const text = await file.text();
            const res = await fetch('/api/backup/restore?confirm=REPLACE-ALL-DATA', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'SmartDairy' }, body: text });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || 'Restore failed');
            toast(t('se.restored'));
            setTimeout(logout, 1500);
          } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
        }}>{t('se.restore')}</Button></div>
      </Card>
    </div>
  );
}

function Account() {
  const { t, lang, setLang } = useI18n();
  const { me } = useAuth();
  const { toast } = useToast();
  const [pw, setPw] = useState(false);
  return (
    <Card>
      <div className="kv mb">
        <div><span>{t('c.name')}</span><b>{me.user.full_name}</b></div>
        <div><span>{t('c.username')}</span><b>{me.user.username}</b></div>
        <div><span>{t('c.role')}</span><b>{t(`role.${me.user.role}`)}</b></div>
      </div>
      <div className="row">
        <Button variant="ghost" onClick={() => { const l = lang === 'en' ? 'mr' : 'en'; setLang(l); api.patch('/auth/language', { language: l }).catch(() => {}); }}>{t('se.language')}: {t('top.language')}</Button>
        <Button icon={KeyRound} onClick={() => setPw(true)}>{t('auth.changePassword')}</Button>
      </div>
      {pw && (
        <FormModal title={t('auth.changePassword')} onClose={() => setPw(false)}
          fields={[
            { name: 'current_password', label: t('auth.currentPassword'), type: 'password', required: true, autoComplete: 'current-password', full: true },
            { name: 'new_password', label: t('auth.newPassword'), type: 'password', required: true, hint: t('auth.passwordHint'), autoComplete: 'new-password' },
            { name: 'confirm', label: t('auth.confirmPassword'), type: 'password', required: true, autoComplete: 'new-password' },
          ]}
          onSubmit={async (v) => {
            if (v.new_password !== v.confirm) throw Object.assign(new Error(t('auth.mismatch')), { details: [{ path: 'confirm', message: t('auth.mismatch') }] });
            await api.post('/auth/change-password', v); toast(t('c.saved')); setPw(false);
          }} />
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [tab, setTab] = useLocalState('sdfm.settings.tab', 'farm');
  const owner = can('settings.write');
  const current = !owner && ['users', 'lookups', 'backup'].includes(tab) ? 'account' : tab;
  return (
    <div>
      <PageHeader title={t('se.title')} />
      <Tabs value={current} onChange={setTab} tabs={[
        { value: 'farm', label: t('se.farm') },
        can('users.manage') && { value: 'users', label: t('se.users') },
        owner && { value: 'lookups', label: t('se.lookups') },
        can('backup.run') && { value: 'backup', label: t('se.backup') },
        { value: 'account', label: t('se.account') },
      ]} />
      {current === 'farm' && <Farm />}
      {current === 'users' && <Users />}
      {current === 'lookups' && <Lookups />}
      {current === 'backup' && <Backup />}
      {current === 'account' && <Account />}
    </div>
  );
}
