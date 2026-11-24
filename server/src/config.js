import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// All business dates are Indian Standard Time.
process.env.TZ = 'Asia/Kolkata';

const here = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. Copy server/.env.example to server/.env and fill it in.`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';
// Vercel runs the API as short-lived functions behind https, with a temporary disk.
const onVercel = !!process.env.VERCEL;

/** TLS for cloud MySQL. DB_SSL_CA may hold the provider's CA certificate (PEM, \n allowed). */
function dbSsl(wanted) {
  if (!wanted) return undefined;
  const ca = process.env.DB_SSL_CA ? process.env.DB_SSL_CA.replace(/\\n/g, '\n') : undefined;
  return { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(ca ? { ca } : {}) };
}

/**
 * Database settings: either one DATABASE_URL (the "Service URI" cloud providers show,
 * e.g. mysql://user:pass@host:3306/db?ssl-mode=REQUIRED) or the separate DB_* variables.
 */
function dbSettings() {
  const url = process.env.DATABASE_URL;
  if (url) {
    let u;
    try { u = new URL(url); } catch { throw new Error('DATABASE_URL is not a valid address. It should look like mysql://user:password@host:port/database'); }
    if (!/^mysql2?:$/.test(u.protocol)) throw new Error('DATABASE_URL must start with mysql://');
    const mode = (u.searchParams.get('ssl-mode') || u.searchParams.get('sslmode') || '').toUpperCase();
    const ssl = ['REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY', 'REQUIRE'].includes(mode) || u.searchParams.get('ssl') === 'true' || process.env.DB_SSL === 'true';
    const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
    if (!u.username || !database) throw new Error('DATABASE_URL must include a user name and a database name.');
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database,
      ssl: dbSsl(ssl),
    };
  }
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: required('DB_NAME'),
    ssl: dbSsl(process.env.DB_SSL === 'true'),
  };
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long.');

export const config = {
  isProd,
  onVercel,
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd || onVercel,
  setupToken: process.env.SETUP_TOKEN || '',
  corsOrigin: process.env.CORS_ORIGIN || '',
  trustProxy: process.env.TRUST_PROXY === 'true' || onVercel,
  db: dbSettings(),
  dbConnectionLimit: Number(process.env.DB_CONNECTION_LIMIT || (onVercel ? 3 : 10)),
  // Photos need a disk that is kept. Vercel's is wiped, so uploads are turned off there.
  photoUploads: !onVercel,
  uploadDir: onVercel ? '/tmp/sdfm-uploads' : path.resolve(here, '..', process.env.UPLOAD_DIR || 'uploads'),
  clientDist: path.resolve(here, '..', '..', 'client', 'dist'),
  migrationsDir: path.resolve(here, 'migrations'),
};
