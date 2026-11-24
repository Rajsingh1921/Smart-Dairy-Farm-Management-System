import { z } from 'zod';
import { isValidDate } from './dates.js';
import { badRequest } from './http.js';

const toNum = (v) => (v === '' || v === null || v === undefined ? null : typeof v === 'string' ? Number(v) : v);
const toStr = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : String(v));

export const zDate = z.string().refine(isValidDate, 'Invalid date (use YYYY-MM-DD)');
export const zOptDate = z.preprocess(toStr, zDate.nullable());
export const zStr = (max, min = 1) => z.preprocess(toStr, z.string().min(min).max(max));
export const zOptStr = (max) => z.preprocess(toStr, z.string().max(max).nullable());
export const zNum = (min, max) => z.preprocess(toNum, z.number().finite().min(min).max(max));
export const zOptNum = (min, max) => z.preprocess(toNum, z.number().finite().min(min).max(max).nullable());
export const zId = z.preprocess(toNum, z.number().int().positive());
export const zOptId = z.preprocess(toNum, z.number().int().positive().nullable());
export const zBool = z.preprocess((v) => v === true || v === 1 || v === '1' || v === 'true' || v === 'on', z.boolean());
export const zEnum = (vals) => z.enum(vals);
export const zOptEnum = (vals) => z.preprocess(toStr, z.enum(vals).nullable());
export const zPhone = z.preprocess(toStr, z.string().regex(/^[0-9+\-\s]{6,15}$/, 'Invalid phone number').nullable());
export const zMoney = zNum(0, 99999999.99);
export const zOptMoney = zOptNum(0, 99999999.99);

function format(err) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Parse data with schema or throw a 400 with field-level messages. */
export function parse(schema, data) {
  const input = data === undefined && schema instanceof z.ZodObject ? {} : data;
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('Please check the highlighted fields', format(r.error));
  return r.data;
}

/** Common list query params: search, date range, paging. */
export const listQuery = z.object({
  q: zOptStr(100),
  from: zOptDate,
  to: zOptDate,
  page: z.preprocess(toNum, z.number().int().min(1).nullable()).transform((v) => v ?? 1),
  limit: z.preprocess(toNum, z.number().int().min(1).max(5000).nullable()).transform((v) => v ?? 50),
  format: zOptEnum(['json', 'csv']),
});

export function paging(q) {
  return { limit: q.limit, offset: (q.page - 1) * q.limit };
}
