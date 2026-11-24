import { useState } from 'react';
import { Plus, Pencil, Trash2, ShoppingCart, MinusCircle, SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi, useLocalState } from '../lib/hooks.js';
import { useI18n } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';
import { addDays, fmtDate, money, number, round2, todayISO } from '../lib/format.js';
import { PageHeader, Tabs, Button, Field, Select, FilterBar, DateRange, Table, Spinner, ErrorBox, ExportButton, Badge, Alert, useToast } from '../components/ui.jsx';
import { FormModal } from '../components/FormModal.jsx';
import { METHODS } from '../components/PaymentForm.jsx';

const CATS = ['green_fodder', 'dry_fodder', 'concentrate', 'mineral', 'medicine', 'supplement', 'other'];
const UNITS = ['kg', 'litre', 'bag', 'piece', 'dose', 'bundle'];

function Stock({ suppliers }) {
  const { t } = useI18n();
  const { can, reloadLookups } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({});
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/inventory/items', f);
  const done = () => { setModal(null); reload(); reloadLookups(); };
  const item = modal?.item;
  return (
    <>
      <FilterBar>
        <Field label={t('c.category')}><Select value={f.category} onChange={(v) => setF({ ...f, category: v })} placeholder={t('c.all')} options={CATS.map((c) => ({ value: c, label: t(`icat.${c}`) }))} /></Field>
        <label className="check" style={{ marginBottom: 8 }}><input type="checkbox" checked={!!f.low} onChange={(e) => setF({ ...f, low: e.target.checked ? 1 : undefined })} /> {t('inv2.lowOnly')}</label>
        <ExportButton path="/inventory/items" params={f} />
        {can('inventory.manage') && <Button icon={Plus} onClick={() => setModal({ type: 'item' })}>{t('inv2.addItem')}</Button>}
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'name', label: t('inv2.item'), render: (r) => <><b>{r.name}</b> <span className="muted small">{t(`icat.${r.category}`)}</span></> },
          { key: 'stock', label: t('inv2.inStock'), align: 'right', render: (r) => <span className="nowrap"><b className={r.low_stock ? 'neg' : ''}>{number(r.stock)}</b> {t(`iunit.${r.unit}`)} {r.low_stock && <Badge tone="red">{t('inv2.low')}</Badge>}</span> },
          { key: 'reorder_level', label: t('inv2.reorder'), align: 'right', render: (r) => number(r.reorder_level) },
          { key: 'usage_30d', label: t('inv2.used30'), align: 'right', render: (r) => number(r.usage_30d) },
          { key: 'days_left', label: t('inv2.daysLeft'), align: 'right', render: (r) => (r.days_left != null ? number(r.days_left) : '') },
          { key: 'last_unit_price', label: t('inv2.lastPrice'), align: 'right', render: (r) => (r.last_unit_price != null ? `${money(r.last_unit_price)}/${t(`iunit.${r.unit}`)}` : '') },
          { key: 'stock_value', label: t('inv2.stockValue'), align: 'right', render: (r) => (r.stock_value != null ? money(r.stock_value) : '') },
          { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              {can('inventory.purchase') && <Button size="sm" variant="ghost" icon={ShoppingCart} onClick={() => setModal({ type: 'purchase', item: r })}>{t('inv2.purchase')}</Button>}
              {can('inventory.use') && <Button size="sm" variant="ghost" icon={MinusCircle} onClick={() => setModal({ type: 'usage', item: r })}>{t('inv2.use')}</Button>}
              {can('inventory.manage') && <Button size="sm" variant="link" icon={SlidersHorizontal} aria-label={t('inv2.adjust')} onClick={() => setModal({ type: 'adjust', item: r })} />}
              {can('inventory.manage') && <Button size="sm" variant="link" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ type: 'item', item: r })} />}
              {can('inventory.manage') && can('records.delete') && <Button size="sm" variant="link" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(t('c.confirmDelete')))) return;
                try { await api.del(`/inventory/items/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />}
            </div>
          ) },
        ]} />
      )}
      {modal?.type === 'item' && (
        <FormModal title={item ? t('inv2.editItem') : t('inv2.addItem')} onClose={() => setModal(null)}
          initial={item ? { ...item, is_active: !!item.is_active } : { category: 'concentrate', unit: 'kg', reorder_level: 0, is_active: true, opening_date: todayISO() }}
          fields={[
            { name: 'name', label: t('inv2.item'), required: true, maxLength: 100, full: true },
            { name: 'category', label: t('c.category'), type: 'select', placeholder: false, options: CATS.map((c) => ({ value: c, label: t(`icat.${c}`) })) },
            { name: 'unit', label: t('c.unit'), type: 'select', placeholder: false, options: UNITS.map((u) => ({ value: u, label: t(`iunit.${u}`) })) },
            { name: 'reorder_level', label: t('inv2.reorder'), type: 'number', min: 0 },
            !item && { name: 'opening_stock', label: t('inv2.openingStock'), type: 'number', min: 0, hint: t('inv2.openingHint') },
            !item && { name: 'opening_date', label: t('c.date'), type: 'date' },
            { name: 'is_active', label: t('c.active'), type: 'checkbox' },
            { name: 'notes', label: t('c.notes'), full: true },
          ]}
          onSubmit={async (v) => {
            const body = { ...v, opening_stock: v.opening_stock === '' || v.opening_stock == null ? undefined : v.opening_stock, opening_date: v.opening_date || undefined };
            if (item) await api.put(`/inventory/items/${item.id}`, body); else await api.post('/inventory/items', body);
            toast(t('c.saved')); done();
          }} />
      )}
      {modal?.type === 'purchase' && (
        <FormModal title={`${t('inv2.recordPurchase')} — ${item.name}`} onClose={() => setModal(null)}
          intro={<Alert kind="info">{t('inv2.purchaseHint')}</Alert>}
          initial={{ item_id: item.id, txn_date: todayISO(), unit_price: item.last_unit_price ?? '', payment_method: 'cash' }}
          fields={[
            { name: 'txn_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'quantity', label: `${t('c.quantity')} (${t(`iunit.${item.unit}`)})`, type: 'number', required: true, min: 0.001 },
            { name: 'unit_price', label: t('inv2.unitPrice'), type: 'number', required: true, min: 0, step: '0.01' },
            { name: 'supplier_id', label: t('c.supplier'), type: 'select', options: suppliers.map((s) => ({ value: String(s.id), label: s.name })) },
            { name: 'payment_method', label: t('c.method'), type: 'select', placeholder: false, options: METHODS.map((m) => ({ value: m, label: t(`method.${m}`) })) },
            { name: 'total', label: t('inv2.totalCost'), type: 'custom', render: (v) => <b className="num" style={{ padding: '8px 0' }}>{money(round2((Number(v.quantity) || 0) * (Number(v.unit_price) || 0)))}</b> },
            { name: 'notes', label: t('c.notes'), full: true },
          ]}
          onSubmit={async (v) => { await api.post('/inventory/purchase', v); toast(t('c.saved')); done(); }} />
      )}
      {modal?.type === 'usage' && (
        <FormModal title={`${t('inv2.recordUse')} — ${item.name}`} onClose={() => setModal(null)}
          intro={<Alert kind="info">{t('inv2.usageHint')} · {t('inv2.inStock')}: <b>{number(item.stock)} {t(`iunit.${item.unit}`)}</b></Alert>}
          initial={{ item_id: item.id, txn_date: todayISO() }}
          fields={[
            { name: 'txn_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'quantity', label: `${t('c.quantity')} (${t(`iunit.${item.unit}`)})`, type: 'number', required: true, min: 0.001, max: item.stock },
            { name: 'notes', label: t('c.notes'), full: true },
          ]}
          onSubmit={async (v) => { await api.post('/inventory/usage', v); toast(t('c.saved')); done(); }} />
      )}
      {modal?.type === 'adjust' && (
        <FormModal title={`${t('inv2.adjustStock')} — ${item.name}`} onClose={() => setModal(null)}
          intro={<Alert kind="info">{t('inv2.adjustHint')} · {t('inv2.inStock')}: <b>{number(item.stock)}</b></Alert>}
          initial={{ item_id: item.id, txn_date: todayISO() }}
          fields={[
            { name: 'txn_date', label: t('c.date'), type: 'date', required: true, max: todayISO() },
            { name: 'quantity', label: `${t('c.quantity')} (+/−)`, type: 'number', required: true },
            { name: 'notes', label: t('c.reason'), required: true, full: true },
          ]}
          onSubmit={async (v) => { await api.post('/inventory/adjust', v); toast(t('c.saved')); done(); }} />
      )}
    </>
  );
}

function Transactions({ items }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const { toast, confirm } = useToast();
  const [f, setF] = useState({ from: addDays(todayISO(), -29), to: todayISO() });
  const { data, loading, error, reload } = useApi('/inventory/transactions', { ...f, limit: 1000 });
  return (
    <>
      <FilterBar>
        <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
        <Field label={t('inv2.item')}><Select value={f.item_id} onChange={(v) => setF({ ...f, item_id: v })} placeholder={t('c.all')} options={items.map((i) => ({ value: i.id, label: i.name }))} /></Field>
        <Field label={t('c.type')}><Select value={f.txn_type} onChange={(v) => setF({ ...f, txn_type: v })} placeholder={t('c.all')} options={['opening', 'purchase', 'usage', 'adjustment'].map((x) => ({ value: x, label: t(`txn.${x}`) }))} /></Field>
        <ExportButton path="/inventory/transactions" params={f} />
      </FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data.rows} columns={[
          { key: 'txn_date', label: t('c.date'), render: (r) => fmtDate(r.txn_date) },
          { key: 'item_name', label: t('inv2.item') },
          { key: 'txn_type', label: t('c.type'), render: (r) => <Badge tone={{ purchase: 'green', usage: 'blue', adjustment: 'amber', opening: 'gray' }[r.txn_type]}>{t(`txn.${r.txn_type}`)}</Badge> },
          { key: 'quantity', label: t('c.quantity'), align: 'right', render: (r) => `${r.quantity > 0 ? '+' : ''}${number(r.quantity)} ${t(`iunit.${r.unit}`)}` },
          { key: 'unit_price', label: t('inv2.unitPrice'), align: 'right', render: (r) => (r.unit_price != null ? money(r.unit_price) : '') },
          { key: 'total_cost', label: t('inv2.totalCost'), align: 'right', render: (r) => (r.total_cost != null ? money(r.total_cost) : '') },
          { key: 'supplier_name', label: t('c.supplier') },
          { key: 'notes', label: t('c.notes') },
          can('records.delete') && can('inventory.manage') && { key: 'a', label: '', render: (r) => <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
            if (!(await confirm(t('c.confirmDelete')))) return;
            try { await api.del(`/inventory/transactions/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
          }} /> },
        ]} />
      )}
    </>
  );
}

function Suppliers() {
  const { t } = useI18n();
  const { can, reloadLookups } = useAuth();
  const { toast, confirm } = useToast();
  const [modal, setModal] = useState(null);
  const { data, loading, error, reload } = useApi('/inventory/suppliers');
  return (
    <>
      <FilterBar>{can('inventory.purchase') && <Button icon={Plus} onClick={() => setModal({ is_active: true })}>{t('inv2.addSupplier')}</Button>}</FilterBar>
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <Table rows={data} columns={[
          { key: 'name', label: t('c.name'), render: (r) => <><b>{r.name}</b>{!r.is_active && <> <Badge>{t('c.inactive')}</Badge></>}</> },
          { key: 'phone', label: t('c.phone'), render: (r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '') },
          { key: 'supplies', label: t('inv2.supplies') },
          { key: 'address', label: t('c.address') },
          { key: 'total_purchases', label: t('inv2.totalPurchases'), align: 'right', render: (r) => money(r.total_purchases) },
          { key: 'a', label: '', render: (r) => (
            <div className="row nowrap">
              {can('inventory.purchase') && <Button variant="link" size="sm" icon={Pencil} aria-label={t('c.edit')} onClick={() => setModal({ ...r, is_active: !!r.is_active })} />}
              {can('records.delete') && <Button variant="link" size="sm" icon={Trash2} aria-label={t('c.delete')} onClick={async () => {
                if (!(await confirm(t('c.confirmDelete')))) return;
                try { await api.del(`/inventory/suppliers/${r.id}`); toast(t('c.deleted')); reload(); } catch (e) { toast(e.message, 'error'); }
              }} />}
            </div>
          ) },
        ]} />
      )}
      {modal && (
        <FormModal title={modal.id ? t('inv2.editSupplier') : t('inv2.addSupplier')} onClose={() => setModal(null)} initial={modal}
          fields={[
            { name: 'name', label: t('c.name'), required: true, maxLength: 120 },
            { name: 'phone', label: t('c.phone'), type: 'tel' },
            { name: 'supplies', label: t('inv2.supplies'), full: true },
            { name: 'address', label: t('c.address'), full: true },
            { name: 'is_active', label: t('c.active'), type: 'checkbox' },
            { name: 'notes', label: t('c.notes'), type: 'textarea', rows: 2 },
          ]}
          onSubmit={async (v) => { if (modal.id) await api.put(`/inventory/suppliers/${modal.id}`, v); else await api.post('/inventory/suppliers', v); toast(t('c.saved')); setModal(null); reload(); reloadLookups(); }} />
      )}
    </>
  );
}

export default function Inventory() {
  const { t } = useI18n();
  const { lookups } = useAuth();
  const [tab, setTab] = useLocalState('sdfm.inv.tab', 'stock');
  return (
    <div>
      <PageHeader title={t('inv2.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'stock', label: t('inv2.stock') },
        { value: 'transactions', label: t('inv2.transactions') },
        { value: 'suppliers', label: t('inv2.suppliers') },
      ]} />
      {tab === 'stock' && <Stock suppliers={lookups.suppliers} />}
      {tab === 'transactions' && <Transactions items={lookups.items} />}
      {tab === 'suppliers' && <Suppliers />}
    </div>
  );
}
