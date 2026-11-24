import { query } from '../db.js';

export async function getSettings() {
  const rows = await query('SELECT setting_key, setting_value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
}

export async function getNumberSetting(key, fallback) {
  const rows = await query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  const n = Number(rows[0]?.setting_value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
