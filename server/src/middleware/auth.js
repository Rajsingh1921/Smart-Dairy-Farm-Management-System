import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { can } from '../permissions.js';
import { HttpError, forbidden } from '../utils/http.js';

export const COOKIE = 'sdfm_session';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, v: user.token_version }, config.jwtSecret, {
    expiresIn: `${config.sessionHours}h`,
    algorithm: 'HS256',
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/' });
}

/** Verify the session cookie and attach req.user. */
export async function authenticate(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next(new HttpError(401, 'Please log in'));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return next(new HttpError(401, 'Your session has expired. Please log in again.'));
  }
  const user = await one(
    'SELECT id, full_name, username, role, language, is_active, token_version FROM users WHERE id = ?',
    [payload.sub],
  );
  if (!user || !user.is_active || user.token_version !== payload.v) {
    return next(new HttpError(401, 'Your session is no longer valid. Please log in again.'));
  }
  req.user = user;
  next();
}

/** Route guard: requirePerm('animals.write') */
export function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please log in'));
    if (!perms.every((p) => can(req.user.role, p))) return next(forbidden());
    next();
  };
}
