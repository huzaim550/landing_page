// ===== Manzar — Xtream IPTV landing + billing backend =====
// This server runs the *storefront* for a public-domain / free-to-air IPTV
// service. It sells access as Xtream "lines" (server URL + username + password)
// that customers plug into any Xtream-compatible player.
//
// It does NOT serve video. The actual Xtream Codes API + streams live on your
// real streaming server (set XTREAM_SERVER_URL to point customers at it).
//
// Paywall model: manual / activation codes.
//   1. Visitor subscribes  -> a *pending* line is created (username+password).
//   2. They pay you off-platform, then redeem an activation code (or you
//      activate them from /admin). Redeeming sets the line Active + expiry.

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env if present. Real environment variables still win.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* no .env file — rely on real environment variables */
}

const app = express();
const PORT = process.env.PORT || 3000;

// The Xtream server customers actually connect their player to.
const XTREAM_SERVER_URL = process.env.XTREAM_SERVER_URL || 'http://your-xtream-server:8080';

// Supabase — stores "request to join" submissions. Use the SERVICE ROLE key
// (server-side only, never expose it to the browser). Table: join_requests.
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'join_requests';
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
if (!supabaseReady) {
  console.warn('⚠  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — "request to join" storage is disabled.');
}

// Base headers for Supabase's REST (PostgREST) API.
function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// Insert one join request; returns the stored row.
async function insertJoinRequest({ name, email, phone, note }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`, {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify([{ name, email, phone, note: note || null, status: 'new' }]),
  });
  if (!res.ok) {
    throw new Error(`Supabase insert failed (${res.status}): ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0];
}

// List join requests, newest first (for the admin panel).
async function listJoinRequests(limit = 200) {
  const url =
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
    `?select=id,name,email,phone,note,status,created_at&order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) {
    throw new Error(`Supabase read failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

app.use(express.json());

// Admin password for the billing dashboard. Set ADMIN_TOKEN in production.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';
if (ADMIN_TOKEN === 'changeme') {
  console.warn('⚠  ADMIN_TOKEN is unset — using default "changeme". Set ADMIN_TOKEN before deploying.');
}

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = req.query.token || bearer;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Provide the admin token.' });
  }
  next();
}

// Subscription plans (price is informational — payment is handled manually).
const PLANS = [
  { id: '1m', label: '1 Month', months: 1, price: 5, connections: 1 },
  { id: '3m', label: '3 Months', months: 3, price: 12, connections: 1, badge: 'Popular' },
  { id: '12m', label: '12 Months', months: 12, price: 35, connections: 2, badge: 'Best value' },
];
const planById = (id) => PLANS.find((p) => p.id === id);

// ----- Tiny JSON "database" helpers -----
const ACCOUNTS_PATH = path.join(__dirname, 'accounts.json');
const CODES_PATH = path.join(__dirname, 'codes.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const readAccounts = () => readJson(ACCOUNTS_PATH, []);
const writeAccounts = (a) => writeJson(ACCOUNTS_PATH, a);
const readCodes = () => readJson(CODES_PATH, []);
const writeCodes = (c) => writeJson(CODES_PATH, c);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-\s]{7,20}$/;
const nowSec = () => Math.floor(Date.now() / 1000);

// Human-readable but hard-to-guess credentials.
function randId(len = 8) {
  return crypto.randomBytes(16).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, len);
}
function genCode() {
  const part = () => crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 4);
  return `MANZAR-${part()}-${part()}`;
}

// Derive the live status of an account (pending / active / expired / suspended).
function accountStatus(acc) {
  if (acc.status === 'suspended') return 'suspended';
  if (acc.status === 'pending') return 'pending';
  if (acc.exp_date && acc.exp_date < nowSec()) return 'expired';
  return 'active';
}

function publicAccount(acc) {
  return {
    username: acc.username,
    password: acc.password,
    plan: acc.plan,
    status: accountStatus(acc),
    exp_date: acc.exp_date || 0,
    max_connections: acc.max_connections || 1,
    server_url: XTREAM_SERVER_URL,
  };
}

// ===================== Public storefront API =====================

// Config the frontend needs (server URL to display, plans).
app.get('/api/config', (req, res) => {
  res.json({ server_url: XTREAM_SERVER_URL, plans: PLANS });
});

// Content preview catalog (public-domain movies + free-to-air live channels).
app.get('/api/catalog', (req, res) => {
  const catalog = readJson(path.join(__dirname, 'catalog.json'), { live: [], movies: [] });
  res.json(catalog);
});

// Request to join -> store the submission in Supabase for review in /admin.
app.post('/api/request', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 2000);

  if (!name) {
    return res.status(400).json({ error: 'Please enter your name.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }
  if (!supabaseReady) {
    return res.status(503).json({ error: 'Requests are temporarily unavailable. Please try again later.' });
  }

  try {
    await insertJoinRequest({ name, email, phone, note });
    res.json({ message: "Thanks! Your request is in — we'll be in touch by email." });
  } catch (err) {
    console.error('join request failed:', err.message);
    res.status(502).json({ error: 'Could not save your request. Please try again in a moment.' });
  }
});

// Subscribe -> create a PENDING line. Returns the customer's Xtream credentials.
// app.post('/api/subscribe', (req, res) => {
//   const email = String(req.body?.email || '').trim().toLowerCase();
//   const planId = String(req.body?.plan || '').trim();
//   const plan = planById(planId);

//   if (!EMAIL_RE.test(email)) {
//     return res.status(400).json({ error: 'Please enter a valid email address.' });
//   }
//   if (!plan) {
//     return res.status(400).json({ error: 'Please choose a valid plan.' });
//   }

//   const accounts = readAccounts();

//   // Auto-generate a unique username + password (Xtream "line").
//   let username;
//   do {
//     username = `mz_${randId(6)}`;
//   } while (accounts.some((a) => a.username === username));
//   const password = randId(10);

//   const acc = {
//     username,
//     password,
//     email,
//     plan: plan.id,
//     status: 'pending',
//     exp_date: 0,
//     max_connections: plan.connections || 1,
//     created_at: nowSec(),
//   };
//   accounts.push(acc);
//   writeAccounts(accounts);

//   res.json({
//     message: 'Line created. Redeem your activation code (or pay to receive one) to go live.',
//     account: publicAccount(acc),
//     plan,
//   });
// });

// // Redeem an activation code -> mark the line Active and extend expiry.
// app.post('/api/redeem', (req, res) => {
//   const username = String(req.body?.username || '').trim();
//   const code = String(req.body?.code || '').trim().toUpperCase();

//   const accounts = readAccounts();
//   const acc = accounts.find((a) => a.username === username);
//   if (!acc) {
//     return res.status(404).json({ error: 'No line found for that username.' });
//   }

//   const codes = readCodes();
//   const entry = codes.find((c) => c.code === code);
//   if (!entry) {
//     return res.status(400).json({ error: 'Invalid activation code.' });
//   }
//   if (entry.used_by) {
//     return res.status(400).json({ error: 'This activation code has already been used.' });
//   }

//   // Extend from the later of "now" or the current expiry (stacking).
//   const base = Math.max(nowSec(), acc.exp_date || 0);
//   acc.exp_date = base + entry.days * 86400;
//   acc.status = 'active';
//   entry.used_by = username;
//   entry.used_at = nowSec();

//   writeAccounts(accounts);
//   writeCodes(codes);

//   res.json({
//     message: `Activated! Your line is live for ${entry.days} more day(s).`,
//     account: publicAccount(acc),
//   });
// });

// // Check the status of an existing line.
// app.get('/api/account', (req, res) => {
//   const username = String(req.query.username || '').trim();
//   const password = String(req.query.password || '').trim();
//   const accounts = readAccounts();
//   const acc = accounts.find((a) => a.username === username && a.password === password);
//   if (!acc) {
//     return res.status(404).json({ error: 'Line not found. Check your username and password.' });
//   }
//   res.json({ account: publicAccount(acc) });
// });

// ===================== Admin billing API =====================

// app.get('/api/admin/accounts', requireAdmin, (req, res) => {
//   const accounts = readAccounts().map((a) => ({ ...publicAccount(a), email: a.email, created_at: a.created_at }));
//   res.json({ count: accounts.length, accounts });
// });

// app.post('/api/admin/set-status', requireAdmin, (req, res) => {
//   const username = String(req.body?.username || '').trim();
//   const days = Number(req.body?.days);
//   const action = String(req.body?.action || '').trim(); // 'activate' | 'suspend'
//   const accounts = readAccounts();
//   const acc = accounts.find((a) => a.username === username);
//   if (!acc) return res.status(404).json({ error: 'Line not found.' });

//   if (action === 'suspend') {
//     acc.status = 'suspended';
//   } else if (action === 'activate') {
//     const grant = Number.isFinite(days) && days > 0 ? days : 30;
//     const base = Math.max(nowSec(), acc.exp_date || 0);
//     acc.exp_date = base + grant * 86400;
//     acc.status = 'active';
//   } else {
//     return res.status(400).json({ error: 'action must be "activate" or "suspend".' });
//   }
//   writeAccounts(accounts);
//   res.json({ account: publicAccount(acc) });
// });

// app.post('/api/admin/gen-codes', requireAdmin, (req, res) => {
//   const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 200);
//   const days = Math.max(Number(req.body?.days) || 30, 1);
//   const codes = readCodes();
//   const created = [];
//   for (let i = 0; i < count; i++) {
//     let code;
//     do {
//       code = genCode();
//     } while (codes.some((c) => c.code === code));
//     const entry = { code, days, created_at: nowSec(), used_by: null, used_at: null };
//     codes.push(entry);
//     created.push(entry);
//   }
//   writeCodes(codes);
//   res.json({ created });
// });

// app.get('/api/admin/codes', requireAdmin, (req, res) => {
//   res.json({ codes: readCodes() });
// });

// Admin dashboard (browser view).
app.get('/admin', requireAdmin, async (req, res) => {
  const token = req.query.token || '';
  const accounts = readAccounts();
  const codes = readCodes();
  const unused = codes.filter((c) => !c.used_by).length;
  const active = accounts.filter((a) => accountStatus(a) === 'active').length;

  // Load "request to join" submissions from Supabase.
  let joinRequests = [];
  let joinError = supabaseReady ? '' : 'Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).';
  if (supabaseReady) {
    try {
      joinRequests = await listJoinRequests();
    } catch (err) {
      joinError = 'Could not load requests from Supabase.';
      console.error('admin join requests load failed:', err.message);
    }
  }
  const joinRows = joinRequests
    .map((r) => {
      const when = r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') : '—';
      return `<tr>
        <td>${escapeHtml(r.name || '')}</td>
        <td>${escapeHtml(r.email || '')}</td>
        <td>${escapeHtml(r.phone || '')}</td>
        <td>${escapeHtml(r.note || '')}</td>
        <td><span class="pill ${escapeHtml(r.status || 'new')}">${escapeHtml(r.status || 'new')}</span></td>
        <td>${escapeHtml(when)}</td></tr>`;
    })
    .join('');

  const accRows = accounts
    .map((a) => {
      const st = accountStatus(a);
      const exp = a.exp_date ? new Date(a.exp_date * 1000).toISOString().slice(0, 10) : '—';
      return `<tr>
        <td>${escapeHtml(a.username)}</td>
        <td>${escapeHtml(a.email || '')}</td>
        <td>${escapeHtml(a.plan)}</td>
        <td><span class="pill ${st}">${st}</span></td>
        <td>${exp}</td>
        <td class="actions">
          <button onclick="act('${escapeHtml(a.username)}','activate',30)">+30d</button>
          <button onclick="act('${escapeHtml(a.username)}','activate',90)">+90d</button>
          <button class="danger" onclick="act('${escapeHtml(a.username)}','suspend')">Suspend</button>
        </td></tr>`;
    })
    .join('');

  const codeRows = codes
    .slice(-40)
    .reverse()
    .map(
      (c) =>
        `<tr><td class="mono">${escapeHtml(c.code)}</td><td>${c.days}d</td><td>${
          c.used_by ? `used by ${escapeHtml(c.used_by)}` : '<span class="ok">unused</span>'
        }</td></tr>`
    )
    .join('');

  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manzar — Billing</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;margin:0;padding:32px}
  h1{color:#E50914;margin:0 0 4px} h2{margin:32px 0 12px;font-size:1.1rem;color:#ddd}
  .stats{color:#b3b3b3;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;margin-bottom:8px}
  th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #222;font-size:13px}
  th{color:#b3b3b3} tr:hover td{background:#141414}
  .mono{font-family:ui-monospace,monospace}
  .pill{padding:2px 8px;border-radius:999px;font-size:11px;text-transform:uppercase}
  .pill.active{background:#0f3d21;color:#4ade80}.pill.pending,.pill.new{background:#3d360f;color:#facc15}
  .pill.expired,.pill.suspended{background:#3d0f12;color:#f87171}
  .ok{color:#4ade80}
  button{background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:5px;padding:5px 9px;cursor:pointer;font-size:12px;margin-right:4px}
  button:hover{border-color:#E50914} button.danger:hover{border-color:#f87171;color:#f87171}
  .gen{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
  .gen input{background:#141414;border:1px solid #333;color:#eee;border-radius:5px;padding:7px 10px;width:80px}
  .gen button{background:#E50914;border-color:#E50914;color:#fff;padding:8px 14px}
  pre{background:#141414;border:1px solid #222;border-radius:6px;padding:12px;white-space:pre-wrap;word-break:break-all}
</style></head><body>
  <h1>Manzar — Billing</h1>
  <p class="stats">${joinRequests.length} join request(s) · ${accounts.length} line(s) · ${active} active · ${unused} unused code(s) · Xtream: <span class="mono">${escapeHtml(
    XTREAM_SERVER_URL
  )}</span></p>

  <h2>Join requests</h2>
  ${joinError ? `<p class="stats">${escapeHtml(joinError)}</p>` : ''}
  <table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Note</th><th>Status</th><th>Received</th></tr></thead>
  <tbody>${joinRows || '<tr><td colspan="6">No requests yet.</td></tr>'}</tbody></table>

  <h2>Generate activation codes</h2>
  <div class="gen">
    <label>Count <input id="gcount" type="number" value="5" min="1" max="200"></label>
    <label>Days <input id="gdays" type="number" value="30" min="1"></label>
    <button onclick="gen()">Generate</button>
  </div>
  <pre id="genout" hidden></pre>

  <h2>Lines</h2>
  <table><thead><tr><th>Username</th><th>Email</th><th>Plan</th><th>Status</th><th>Expires</th><th>Actions</th></tr></thead>
  <tbody>${accRows || '<tr><td colspan="6">No lines yet.</td></tr>'}</tbody></table>

  <h2>Recent codes</h2>
  <table><thead><tr><th>Code</th><th>Days</th><th>State</th></tr></thead>
  <tbody>${codeRows || '<tr><td colspan="3">No codes yet.</td></tr>'}</tbody></table>

<script>
  const TOKEN = ${JSON.stringify(String(token))};
  async function post(url, body){
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN}, body:JSON.stringify(body)});
    return r.json();
  }
  async function act(username, action, days){
    await post('/api/admin/set-status', {username, action, days});
    location.reload();
  }
  async function gen(){
    const count = +document.getElementById('gcount').value;
    const days = +document.getElementById('gdays').value;
    const {created} = await post('/api/admin/gen-codes', {count, days});
    const out = document.getElementById('genout');
    out.hidden = false;
    out.textContent = created.map(c=>c.code).join('\\n');
  }
</script>
</body></html>`);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Health check.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Serve the static storefront (index.html, css/, js/, assets/).
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Manzar storefront running at http://localhost:${PORT}`);
  console.log(`Xtream server advertised to customers: ${XTREAM_SERVER_URL}`);
});
