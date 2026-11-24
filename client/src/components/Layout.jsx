import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, PawPrint, Milk, Users, Receipt, Wheat, HeartPulse, Baby, IndianRupee, UserCog, ListChecks, Bell, FileBarChart, Settings, LogOut,
  Search, Languages, LayoutGrid, X, Home,
} from 'lucide-react';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'nav.dashboard', perm: 'dashboard.read', end: true },
  { to: '/animals', icon: PawPrint, label: 'nav.animals', perm: 'animals.read' },
  { to: '/milk', icon: Milk, label: 'nav.milk', perm: 'milk.read' },
  { to: '/customers', icon: Users, label: 'nav.customers', perm: 'customers.read' },
  { to: '/sales', icon: Receipt, label: 'nav.sales', perm: 'customers.read' },
  { to: '/inventory', icon: Wheat, label: 'nav.inventory', perm: 'inventory.read' },
  { to: '/health', icon: HeartPulse, label: 'nav.health', perm: 'health.read' },
  { to: '/breeding', icon: Baby, label: 'nav.breeding', perm: 'breeding.read' },
  { to: '/finance', icon: IndianRupee, label: 'nav.finance', perm: 'finance.read' },
  { to: '/employees', icon: UserCog, label: 'nav.employees', perm: ['employees.read', 'salary.write'] },
  { to: '/tasks', icon: ListChecks, label: 'nav.tasks', perm: 'tasks.read' },
  { to: '/reminders', icon: Bell, label: 'nav.reminders', perm: 'reminders.read' },
  { to: '/reports', icon: FileBarChart, label: 'nav.reports', perm: 'reports.read' },
  { to: '/settings', icon: Settings, label: 'nav.settings', perm: 'dashboard.read' },
];

// Phone tab bar: the four most-used sections this person can open, then "More".
const TABS = [
  { to: '/', icon: Home, label: 'bn.home', perm: 'dashboard.read', end: true },
  { to: '/milk', icon: Milk, label: 'bn.milk', perm: 'milk.read' },
  { to: '/sales', icon: Receipt, label: 'bn.sales', perm: 'customers.read' },
  { to: '/animals', icon: PawPrint, label: 'bn.animals', perm: 'animals.read' },
  { to: '/customers', icon: Users, label: 'bn.customers', perm: 'customers.read' },
  { to: '/health', icon: HeartPulse, label: 'bn.health', perm: 'health.read' },
  { to: '/tasks', icon: ListChecks, label: 'bn.tasks', perm: 'tasks.read' },
];

function GlobalSearch({ autoFocus, onDone }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const box = useRef(null);
  const input = useRef(null);
  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (q.trim().length < 1) { setRes(null); return undefined; }
    const h = setTimeout(async () => {
      const [a, c] = await Promise.all([
        api.get('/animals', { q, life_status: 'all', limit: 6 }).catch(() => ({ rows: [] })),
        can('customers.read') ? api.get('/customers', { q, status: 'all' }).catch(() => ({ rows: [] })) : { rows: [] },
      ]);
      setRes({ animals: a.rows, customers: c.rows.slice(0, 6) });
    }, 250);
    return () => clearTimeout(h);
  }, [q, can]);
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) setRes(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (path) => { setQ(''); setRes(null); onDone?.(); nav(path); };
  return (
    <div className="gsearch" ref={box}>
      <Search size={17} className="gsearch-icon" aria-hidden />
      <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('top.search')} aria-label={t('c.search')} enterKeyHint="search" />
      {res && (
        <div className="gsearch-results">
          {!res.animals.length && !res.customers.length && <div className="muted small pad">{t('c.empty')}</div>}
          {res.animals.map((a) => (
            <button key={`a${a.id}`} onClick={() => go(`/animals/${a.id}`)}><PawPrint size={16} /> <b>{a.tag_no}</b> {a.name} <span className="muted small">{t(`life.${a.life_status}`)}</span></button>
          ))}
          {res.customers.map((c) => (
            <button key={`c${c.id}`} onClick={() => go(`/customers/${c.id}`)}><Users size={16} /> <b>{c.name}</b> <span className="muted small">{c.village || c.phone}</span></button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { t, lang, setLang } = useI18n();
  const { me, can, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); setSearchOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const allowed = (p) => (Array.isArray(p) ? p.some(can) : can(p));
  const tabs = TABS.filter((n) => allowed(n.perm)).slice(0, 4);
  const inTabs = tabs.some((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));
  const farmName = me.farm.name || t('app.name');

  const toggleLang = () => {
    const l = lang === 'en' ? 'mr' : 'en';
    setLang(l);
    api.patch('/auth/language', { language: l }).catch(() => {});
  };

  return (
    <div className={`app ${open ? 'nav-open' : ''} ${searchOpen ? 'search-open' : ''}`}>
      <aside className="sidebar" aria-label={t('nav.menu')}>
        <div className="brand">
          <img className="brand-logo" src="/logo.png" alt="" width="46" height="46" />
          <div>
            <div className="brand-name">{farmName}</div>
            <div className="brand-sub">{t('app.name')}</div>
          </div>
        </div>
        <div className="sheet-head">
          <h2>{t('nav.allSections')}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label={t('c.close')}><X size={22} /></button>
        </div>
        <nav>
          {NAV.filter((n) => allowed(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <n.icon size={18} aria-hidden /> <span>{t(n.label)}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <div className="avatar">{me.user.full_name.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="me-name">{me.user.full_name}</div>
              <div className="muted small">{t(`role.${me.user.role}`)}</div>
            </div>
          </div>
          <button className="nav-btn" onClick={logout}><LogOut size={18} /> <span>{t('top.logout')}</span></button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <Link to="/" className="topbar-brand">
            <img className="brand-logo" src="/logo.png" alt="" width="36" height="36" />
            <b>{farmName}</b>
          </Link>
          <GlobalSearch autoFocus={searchOpen} onDone={() => setSearchOpen(false)} />
          <div className="topbar-spacer" />
          <button className="icon-btn search-btn" onClick={() => setSearchOpen((s) => !s)} aria-label={t('top.openSearch')} aria-expanded={searchOpen}>
            {searchOpen ? <X size={22} /> : <Search size={22} />}
          </button>
          <button className="lang-btn" onClick={toggleLang} title={t('se.language')}><Languages size={16} /> {t('top.language')}</button>
        </header>
        {me.farm.demo_mode && <div className="demo-banner">{t('demo.banner')}</div>}
        <main className="content">
          <Outlet />
        </main>
      </div>
      <nav className="bottom-nav" aria-label={t('nav.menu')}>
        {tabs.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive && !open ? 'active' : '')}>
            <span className="bn-icon"><n.icon size={22} aria-hidden /></span>
            <span>{t(n.label)}</span>
          </NavLink>
        ))}
        <button className={open || !inTabs ? 'active' : ''} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="bn-icon"><LayoutGrid size={22} aria-hidden /></span>
          <span>{t('bn.more')}</span>
        </button>
      </nav>
    </div>
  );
}
