import bcrypt from 'bcryptjs';
import { z } from 'zod';

export const zPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), 'Password must contain letters and numbers');

export const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/, 'Username: 3-50 letters, numbers, dot, dash or underscore');

export const hashPassword = (p) => bcrypt.hash(p, 12);
export const checkPassword = (p, hash) => bcrypt.compare(p, hash);
