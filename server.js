// Dr. Somani's Homoeopathy CRM — server (Node built-ins only)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const store = require('./store');

const PORT = process.env.PORT || 4180;
const PUB = path.join(__dirname, 'public');
const USERS_FILE = path.join(__dirname, 'data/users.json');
if (!fs.existsSync(USERS_FILE)) {
  console.error('No admin user yet. Create one first:\n  node scripts/create-admin.js <email> <password>');
  process.exit(1);
}
const USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const PROD = process.env.NODE_ENV === 'production' || !!process.env.HTTPS;  // behind HTTPS
const TRUST_PROXY = !!process.env.TRUST_PROXY;                              // set when behind nginx / a load balancer
const SESSION_TTL = 8 * 3600e3;          // 8 h normal
const REMEMBER_TTL = 30 * 24 * 3600e3;   // 30 d "keep me signed in"
const LOCK_MS = 5 * 60e3;
const IP_LIMIT = 5;                      // failed attempts per IP before lockout
const ACCOUNT_LIMIT = 10;                // failed attempts per account (from any IP)
const MAX_VERIFYING = 8;                 // concurrent password checks server-wide
const sessions = new Map();              // token -> {uid, exp}
const limits = new Map();                // 'ip:x' | 'acct:x' -> {fails, inflight, until}
let verifying = 0;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; frame-ancestors 'none'; form-action 'self'",
  ...(PROD && { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
};

function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { ...SEC_HEADERS, 'Content-Type': isObj ? 'application/json' : 'text/plain', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* skip malformed */ }
  }
  return out;
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    const hops = String(req.headers['x-forwarded-for']).split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];  // right-most = added by our own proxy
  }
  return req.socket.remoteAddress;
}

function currentUser(req) {
  const tok = cookies(req).sid;
  const s = tok && sessions.get(tok);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(tok); return null; }
  return USERS.find(u => u.id === s.uid) || null;
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.removeAllListeners('data'); reject(new Error('too large')); req.resume(); return; }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (size > limit) return;
      try {
        const o = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');   // decode once, so multi-byte characters never split
        if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not an object');
        resolve(o);
      } catch (e) { reject(e); }
    });
  });
}

async function checkPassword(user, pw) {
  const got = await scrypt(String(pw).slice(0, 256), user.salt, 64);
  return crypto.timingSafeEqual(got, Buffer.from(user.hash, 'hex'));
}

function publicUser(u) { return { email: u.email, name: u.name, role: u.role }; }

// Rate-limit bucket. In-flight requests count as attempts, so a burst of parallel guesses can't slip past the limit.
function bucket(key) {
  let b = limits.get(key);
  if (!b) { b = { fails: 0, inflight: 0, until: 0 }; limits.set(key, b); }
  return b;
}
function blocked(b, limit) {
  if (b.until > Date.now()) return b.until - Date.now();
  if (b.fails + b.inflight >= limit) return LOCK_MS;
  return 0;
}
function fail(b, limit) {
  b.fails += 1;
  b.at = Date.now();
  if (b.fails >= limit) { b.until = Date.now() + LOCK_MS; b.fails = 0; }
}
function tooMany(res, ms) {
  return send(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(ms / 60e3)} min.`, retryAfter: ms }, { 'Retry-After': String(Math.ceil(ms / 1000)) });
}

async function login(req, res) {
  const ipB = bucket('ip:' + clientIp(req));
  let wait = blocked(ipB, IP_LIMIT);
  if (wait) return tooMany(res, wait);
  if (verifying >= MAX_VERIFYING) return send(res, 503, { error: 'Server is busy. Please try again in a moment.' }, { 'Retry-After': '2' });

  ipB.inflight += 1;
  let acctB = null;
  try {
    let body;
    try { body = await readBody(req); } catch { return send(res, 400, { error: 'Invalid request.' }); }
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    acctB = bucket('acct:' + email);
    if ((wait = blocked(acctB, ACCOUNT_LIMIT))) return tooMany(res, wait);
    acctB.inflight += 1;

    const user = USERS.find(u => u.email === email);
    verifying += 1;
    let ok;
    try {
      // Always run scrypt so response time doesn't reveal whether the email exists
      ok = user ? await checkPassword(user, body.password || '') : (await checkPassword(USERS[0], crypto.randomBytes(8).toString('hex')), false);
    } finally { verifying -= 1; }

    if (!ok) {
      fail(ipB, IP_LIMIT);
      fail(acctB, ACCOUNT_LIMIT);
      wait = Math.max(ipB.until, acctB.until) - Date.now();
      if (wait > 0) return tooMany(res, wait);
      return send(res, 401, { error: 'Email or password is incorrect.', remaining: IP_LIMIT - ipB.fails });
    }
    ipB.fails = 0; acctB.fails = 0;
    const token = crypto.randomBytes(32).toString('hex');
    const ttl = body.remember ? REMEMBER_TTL : SESSION_TTL;
    sessions.set(token, { uid: user.id, exp: Date.now() + ttl });
    const cookie = `sid=${token}; HttpOnly; SameSite=Strict; Path=/` + (body.remember ? `; Max-Age=${ttl / 1000}` : '') + (PROD ? '; Secure' : '');
    send(res, 200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': cookie });
  } finally {
    ipB.inflight -= 1;
    if (acctB && acctB.inflight > 0) acctB.inflight -= 1;
  }
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  });
}

async function handle(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(res, 400, 'Bad request'); }

  if (p === '/api/login' && req.method === 'POST') return login(req, res);
  if (p === '/api/logout' && req.method === 'POST') {
    sessions.delete(cookies(req).sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' + (PROD ? '; Secure' : '') });
  }
  if (p === '/api/me') {
    const u = currentUser(req);
    return u ? send(res, 200, { user: publicUser(u) }) : send(res, 401, { error: 'Not signed in' });
  }
  if (p.startsWith('/api/')) {
    const u = currentUser(req);
    if (!u) return send(res, 401, { error: 'Not signed in' });
    return store.api(req, res, p, u, { send, readBody });
  }

  // Pages: / -> login (or app if signed in); /app -> protected shell
  if (p === '/' || p === '/login') return currentUser(req) ? send(res, 302, '', { Location: '/app' }) : serveFile(res, path.join(PUB, 'login.html'));
  if (p === '/app') return currentUser(req) ? serveFile(res, path.join(PUB, 'app.html')) : send(res, 302, '', { Location: '/' });

  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep) || file.toLowerCase().endsWith('.html')) return send(res, 404, 'Not found');
  serveFile(res, file);
}

http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error('Request error:', err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
    else res.end();
  });
}).listen(PORT, () => console.log(`Somani CRM running at http://localhost:${PORT}`));

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));

setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (s.exp < now) sessions.delete(k);
  for (const [k, b] of limits) if (!b.inflight && b.until < now && (!b.fails || now - b.at > 3600e3)) limits.delete(k);
}, 10 * 60e3).unref();
