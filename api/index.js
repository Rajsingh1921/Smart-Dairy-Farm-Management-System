// Vercel entry point: runs the same Express API as `npm start`, as a serverless function.
// The database schema is brought up to date once per cold start.

let ready = null;

async function start() {
  const [{ createApp }, { migrate }] = await Promise.all([import('../server/src/app.js'), import('../server/src/migrate.js')]);
  await migrate({ log: () => {} });
  return createApp();
}

// Plain-language reason shown on the login page when the server cannot start.
function startupMessage(err) {
  const m = String(err?.message || '');
  if (/^Missing required environment variable (DB_USER|DB_NAME)/.test(m)) {
    return 'No database is connected yet. Add DATABASE_URL (your MySQL "Service URI") in Vercel → Project → Settings → Environment Variables, then redeploy.';
  }
  if (m.startsWith('Missing required environment variable')) {
    return `${m.split('.')[0]}. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.`;
  }
  if (m.startsWith('JWT_SECRET') || m.startsWith('DATABASE_URL')) return m;
  const tls = ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'HANDSHAKE_SSL_ERROR'];
  if (tls.includes(err?.code)) return `The database's security certificate was not accepted (${err.code}). Add the provider's CA certificate as DB_SSL_CA in Vercel settings.`;
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'HANDSHAKE_NO_SSL_SUPPORT', 'PROTOCOL_CONNECTION_LOST'].includes(err?.code)) {
    return `Cannot connect to the database (${err.code}). Check DATABASE_URL (or DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) in Vercel settings.`;
  }
  return 'The server could not start. See the function logs in Vercel for details.';
}

export default async function handler(req, res) {
  try {
    ready ??= start();
    const app = await ready;
    return app(req, res);
  } catch (err) {
    ready = null; // try again on the next request
    console.error('Startup failed:', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: startupMessage(err) }));
  }
}
