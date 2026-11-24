import { Router } from 'express';
import { z } from 'zod';
import { query, one, tx } from '../db.js';
import { requirePerm } from '../middleware/auth.js';
import { badRequest, notFound, round2 } from '../utils/http.js';
import { parse, listQuery, paging, zStr, zOptStr, zId, zOptId, zDate, zNum, zBool, zPhone } from '../utils/validate.js';
import { todayIST, addDays } from '../utils/dates.js';
import { audit } from '../utils/audit.js';
import { sendCsv } from '../utils/csv.js';
import { syncLinkedExpense, deleteLinkedExpense } from '../services/finance.js';

const r = Router();
const CATEGORIES = ['green_fodder', 'dry_fodder', 'concentrate', 'mineral', 'medicine', 'supplement', 'other'];
const UNITS = ['kg', 'litre', 'bag', 'piece', 'dose', 'bundle'];

// ---------------------------------------------------------------- suppliers
const supplierSchema = z.object({ name: zStr(120), phone: zPhone, address: zOptStr(255), supplies: zOptStr(255), notes: zOptStr(1000), is_active: zBool });

r.get('/suppliers', async (_req, res) => {
  res.json(await query(`SELECT s.*, (SELECT COALESCE(SUM(total_cost),0) FROM inventory_transactions t WHERE t.supplier_id = s.id) AS total_purchases
                        FROM suppliers s ORDER BY s.is_active DESC, s.name`));
});
r.post('/suppliers', requirePerm('inventory.purchase'), async (req, res) => {
  const b = parse(supplierSchema, req.body);
  const ins = await query('INSERT INTO suppliers (name, phone, address, supplies, notes, is_active) VALUES (?,?,?,?,?,?)', [b.name, b.phone, b.address, b.supplies, b.notes, b.is_active]);
  await audit(req, 'create', 'supplier', ins.insertId, b);
  res.status(201).json({ id: ins.insertId });
});
r.put('/suppliers/:id', requirePerm('inventory.purchase'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(supplierSchema, req.body);
  const result = await query('UPDATE suppliers SET name=?, phone=?, address=?, supplies=?, notes=?, is_active=? WHERE id=?', [b.name, b.phone, b.address, b.supplies, b.notes, b.is_active, id]);
  if (!result.affectedRows) throw notFound('Supplier');
  await audit(req, 'update', 'supplier', id, b);
  res.json({ ok: true });
});
r.delete('/suppliers/:id', requirePerm('records.delete'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const used = await one('SELECT (SELECT COUNT(*) FROM inventory_transactions WHERE supplier_id = ?) + (SELECT COUNT(*) FROM expenses WHERE supplier_id = ?) n', [id, id]);
  if (used.n) return res.status(409).json({ error: 'This supplier has purchase records. Mark it inactive instead.' });
  const result = await query('DELETE FROM suppliers WHERE id = ?', [id]);
  if (!result.affectedRows) throw notFound('Supplier');
  await audit(req, 'delete', 'supplier', id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- items with live stock
export const STOCK_SQL = `
  SELECT i.*, COALESCE(SUM(t.quantity), 0) AS stock,
    (SELECT unit_price FROM inventory_transactions p WHERE p.item_id = i.id AND p.txn_type = 'purchase' ORDER BY p.txn_date DESC, p.id DESC LIMIT 1) AS last_unit_price,
    (SELECT MAX(txn_date) FROM inventory_transactions p WHERE p.item_id = i.id AND p.txn_type = 'purchase') AS last_purchase_date
  FROM inventory_items i LEFT JOIN inventory_transactions t ON t.item_id = i.id`;

async function stockOf(conn, itemId) {
  const [rows] = await conn.query('SELECT COALESCE(SUM(quantity),0) s FROM inventory_transactions WHERE item_id = ?', [itemId]);
  return Number(rows[0].s);
}

r.get('/items', async (req, res) => {
  const q = parse(listQuery.extend({ category: z.enum(CATEGORIES).optional(), low: zBool.optional(), status: z.enum(['active', 'all']).default('active') }), req.query);
  const where = [];
  const params = [];
  if (q.status === 'active') where.push('i.is_active = 1');
  if (q.category) { where.push('i.category = ?'); params.push(q.category); }
  if (q.q) { where.push('i.name LIKE ?'); params.push(`%${q.q}%`); }
  let rows = await query(`${STOCK_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY i.id ORDER BY i.name`, params);
  const since = addDays(todayIST(), -30);
  const usage = await query("SELECT item_id, -SUM(quantity) used FROM inventory_transactions WHERE txn_type='usage' AND txn_date > ? GROUP BY item_id", [since]);
  const used = new Map(usage.map((u) => [u.item_id, Number(u.used)]));
  rows = rows.map((r) => {
    const stock = Math.round(Number(r.stock) * 1000) / 1000;
    const perDay = (used.get(r.id) || 0) / 30;
    return {
      ...r, stock, low_stock: Number(r.reorder_level) > 0 && stock <= Number(r.reorder_level),
      usage_30d: round2(used.get(r.id) || 0), days_left: perDay > 0 ? Math.floor(stock / perDay) : null,
      stock_value: r.last_unit_price ? round2(stock * r.last_unit_price) : null,
    };
  });
  if (q.low) rows = rows.filter((r) => r.low_stock);
  if (q.format === 'csv') {
    return sendCsv(res, 'inventory-stock.csv', rows, [
      { label: 'Item', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Unit', key: 'unit' }, { label: 'Stock', key: 'stock' },
      { label: 'Reorder level', key: 'reorder_level' }, { label: 'Low stock', value: (r) => (r.low_stock ? 'YES' : '') },
      { label: 'Used last 30 days', key: 'usage_30d' }, { label: 'Days left (approx.)', key: 'days_left' },
      { label: 'Last unit price (INR)', key: 'last_unit_price' }, { label: 'Stock value at last price (INR)', key: 'stock_value' },
    ]);
  }
  res.json({ rows });
});

const itemSchema = z.object({ name: zStr(100), category: z.enum(CATEGORIES), unit: z.enum(UNITS), reorder_level: zNum(0, 9999999), notes: zOptStr(255), is_active: zBool });

r.post('/items', requirePerm('inventory.manage'), async (req, res) => {
  const b = parse(itemSchema.extend({ opening_stock: zNum(0, 9999999).optional(), opening_date: zDate.optional() }), req.body);
  const id = await tx(async (conn) => {
    const [ins] = await conn.query('INSERT INTO inventory_items (name, category, unit, reorder_level, notes, is_active) VALUES (?,?,?,?,?,?)', [b.name, b.category, b.unit, b.reorder_level, b.notes, b.is_active]);
    if (b.opening_stock > 0) {
      // Opening stock was bought before using this system, so it is not an expense.
      await conn.query("INSERT INTO inventory_transactions (item_id, txn_date, txn_type, quantity, notes, created_by) VALUES (?,?,'opening',?, 'Opening stock', ?)",
        [ins.insertId, b.opening_date || todayIST(), b.opening_stock, req.user.id]);
    }
    return ins.insertId;
  });
  await audit(req, 'create', 'inventory_item', id, b);
  res.status(201).json({ id });
});

r.put('/items/:id', requirePerm('inventory.manage'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const b = parse(itemSchema, req.body);
  const result = await query('UPDATE inventory_items SET name=?, category=?, unit=?, reorder_level=?, notes=?, is_active=? WHERE id=?', [b.name, b.category, b.unit, b.reorder_level, b.notes, b.is_active, id]);
  if (!result.affectedRows) throw notFound('Item');
  await audit(req, 'update', 'inventory_item', id, b);
  res.json({ ok: true });
});

r.delete('/items/:id', requirePerm('records.delete', 'inventory.manage'), async (req, res) => {
  const id = parse(zId, req.params.id);
  const result = await query('DELETE FROM inventory_items WHERE id = ?', [id]); // 409 if it has transactions
  if (!result.affectedRows) throw notFound('Item');
  await audit(req, 'delete', 'inventory_item', id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- transactions
r.get('/transactions', async (req, res) => {
  const q = parse(listQuery.extend({ item_id: zOptId, txn_type: z.enum(['opening', 'purchase', 'usage', 'adjustment']).optional() }), req.query);
  const to = q.to || todayIST();
  const from = q.from || addDays(to, -29);
  const where = ['t.txn_date BETWEEN ? AND ?'];
  const params = [from, to];
  if (q.item_id) { where.push('t.item_id = ?'); params.push(q.item_id); }
  if (q.txn_type) { where.push('t.txn_type = ?'); params.push(q.txn_type); }
  const csv = q.format === 'csv';
  const { limit, offset } = paging(q);
  const rows = await query(
    `SELECT t.*, i.name AS item_name, i.unit, s.name AS supplier_name, u.full_name AS created_by_name
     FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id LEFT JOIN suppliers s ON s.id = t.supplier_id LEFT JOIN users u ON u.id = t.created_by
     WHERE ${where.join(' AND ')} ORDER BY t.txn_date DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, csv ? 1000000 : limit, csv ? 0 : offset],
  );
  if (csv) {
    return sendCsv(res, `inventory-transactions-${from}-to-${to}.csv`, rows, [
      { label: 'Date', key: 'txn_date' }, { label: 'Item', key: 'item_name' }, { label: 'Type', key: 'txn_type' }, { label: 'Quantity', key: 'quantity' },
      { label: 'Unit', key: 'unit' }, { label: 'Unit price (INR)', key: 'unit_price' }, { label: 'Total cost (INR)', key: 'total_cost' },
      { label: 'Supplier', key: 'supplier_name' }, { label: 'Notes', key: 'notes' },
    ]);
  }
  res.json({ rows, from, to });
});

r.post('/purchase', requirePerm('inventory.purchase'), async (req, res) => {
  const b = parse(z.object({
    item_id: zId, txn_date: zDate, quantity: zNum(0.001, 9999999), unit_price: zNum(0, 9999999), supplier_id: zOptId,
    payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'other']).default('cash'), notes: zOptStr(255),
  }), req.body);
  if (b.txn_date > todayIST()) throw badRequest('Date cannot be in the future');
  const id = await tx(async (conn) => {
    const [items] = await conn.query('SELECT * FROM inventory_items WHERE id = ?', [b.item_id]);
    const item = items[0];
    if (!item) throw badRequest('Item not found');
    const total = round2(b.quantity * b.unit_price);
    let supplierName = null;
    if (b.supplier_id) supplierName = (await conn.query('SELECT name FROM suppliers WHERE id = ?', [b.supplier_id]))[0][0]?.name ?? null;
    const expenseId = await syncLinkedExpense(conn, {
      amount: total, date: b.txn_date, categoryCode: item.category === 'medicine' ? 'medicine_vet' : 'feed',
      description: `${item.name}: ${b.quantity} ${item.unit} @ ${b.unit_price}`, source: 'inventory', supplierId: b.supplier_id,
      method: b.payment_method, paidTo: supplierName, userId: req.user.id,
    });
    const [ins] = await conn.query(
      "INSERT INTO inventory_transactions (item_id, txn_date, txn_type, quantity, unit_price, total_cost, supplier_id, expense_id, notes, created_by) VALUES (?,?,'purchase',?,?,?,?,?,?,?)",
      [b.item_id, b.txn_date, b.quantity, b.unit_price, total, b.supplier_id, expenseId, b.notes, req.user.id],
    );
    return ins.insertId;
  });
  await audit(req, 'purchase', 'inventory', id, b);
  res.status(201).json({ id });
});

r.post('/usage', requirePerm('inventory.use'), async (req, res) => {
  const b = parse(z.object({ item_id: zId, txn_date: zDate, quantity: zNum(0.001, 9999999), notes: zOptStr(255) }), req.body);
  if (b.txn_date > todayIST()) throw badRequest('Date cannot be in the future');
  const id = await tx(async (conn) => {
    await conn.query('SELECT id FROM inventory_items WHERE id = ? FOR UPDATE', [b.item_id]);
    const stock = await stockOf(conn, b.item_id);
    if (b.quantity > stock + 1e-9) throw badRequest(`Only ${stock} in stock. Record the purchase first or adjust stock.`);
    const [ins] = await conn.query("INSERT INTO inventory_transactions (item_id, txn_date, txn_type, quantity, notes, created_by) VALUES (?,?,'usage',?,?,?)",
      [b.item_id, b.txn_date, -b.quantity, b.notes, req.user.id]);
    return ins.insertId;
  });
  await audit(req, 'usage', 'inventory', id, b);
  res.status(201).json({ id });
});

// Stock count correction (+ found extra, - spoiled/missing). Not an expense.
r.post('/adjust', requirePerm('inventory.manage'), async (req, res) => {
  const b = parse(z.object({ item_id: zId, txn_date: zDate, quantity: zNum(-9999999, 9999999), notes: zStr(255) }), req.body);
  if (b.quantity === 0) throw badRequest('Quantity cannot be zero');
  const id = await tx(async (conn) => {
    await conn.query('SELECT id FROM inventory_items WHERE id = ? FOR UPDATE', [b.item_id]);
    const stock = await stockOf(conn, b.item_id);
    if (stock + b.quantity < -1e-9) throw badRequest(`Stock cannot go below zero (current stock ${stock})`);
    const [ins] = await conn.query("INSERT INTO inventory_transactions (item_id, txn_date, txn_type, quantity, notes, created_by) VALUES (?,?,'adjustment',?,?,?)",
      [b.item_id, b.txn_date, b.quantity, b.notes, req.user.id]);
    return ins.insertId;
  });
  await audit(req, 'adjust', 'inventory', id, b);
  res.status(201).json({ id });
});

r.delete('/transactions/:id', requirePerm('records.delete', 'inventory.manage'), async (req, res) => {
  const id = parse(zId, req.params.id);
  await tx(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM inventory_transactions WHERE id = ? FOR UPDATE', [id]);
    const t = rows[0];
    if (!t) throw notFound('Transaction');
    const stock = await stockOf(conn, t.item_id);
    if (stock - Number(t.quantity) < -1e-9) throw badRequest('Deleting this would make stock negative. Delete the later usage entries first.');
    await conn.query('DELETE FROM inventory_transactions WHERE id = ?', [id]);
    await deleteLinkedExpense(conn, t.expense_id);
  });
  await audit(req, 'delete', 'inventory_txn', id);
  res.json({ ok: true });
});

export default r;
