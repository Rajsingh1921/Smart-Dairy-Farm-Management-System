import { pool } from '../db.js';

/** Record who did what. Never throws (audit failure must not break the request). */
export async function audit(req, action, entity, entityId, details = null, conn = pool) {
  try {
    await conn.query('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?)', [
      req.user?.id ?? null,
      action,
      entity,
      entityId == null ? null : String(entityId),
      details ? JSON.stringify(details) : null,
      req.ip ?? null,
    ]);
  } catch (err) {
    console.error('audit log failed:', err.message);
  }
}
