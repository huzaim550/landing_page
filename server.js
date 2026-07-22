// ===== Manzar — Xtream IPTV landing + onboarding backend =====
// This server runs the *storefront* for a public-domain / free-to-air IPTV
// service. Visitors "request to join"; those requests are stored in Supabase
// and worked through the admin panel.
//
// It does NOT serve video. The actual Xtream Codes API + streams live on your
// real streaming server (set XTREAM_SERVER_URL to point customers at it).
//
// Onboarding model: request-driven.
//   1. Visitor submits name + email + phone -> a "pending" request is stored.
//   2. From /admin/requests you approve, reject, or mark them onboarded.

import express from 'express';
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

// Resend — transactional email (confirmation / approved / onboarding welcome).
// RESEND_FROM must be a sender on a domain you've verified in Resend, e.g.
// "Manzar <noreply@mail.yourdomain.com>".
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.RESEND_FROM || '';
const resendReady = Boolean(RESEND_API_KEY && RESEND_FROM);
if (!resendReady) {
  console.warn('⚠  RESEND_API_KEY / RESEND_FROM not set — outbound email is disabled.');
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
    body: JSON.stringify([{ name, email, phone, note: note || null, status: 'pending' }]),
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

// Update one join request's status; returns the updated row.
async function updateJoinRequestStatus(id, status) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ status }),
    }
  );
  if (!res.ok) {
    throw new Error(`Supabase update failed (${res.status}): ${await res.text()}`);
  }
  const rows = await res.json();
  return rows[0];
}

// Permanently delete one join request.
async function deleteJoinRequest(id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: supabaseHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Supabase delete failed (${res.status}): ${await res.text()}`);
  }
}

// ----- Transactional email (Resend) -----

// Send one email. Returns true if sent, false if email is disabled. Throws on
// an actual send failure so callers can decide whether to surface it.
async function sendEmail({ to, subject, html }) {
  if (!resendReady) {
    console.warn(`email skipped (Resend not configured): "${subject}" → ${to}`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${await res.text()}`);
  }
  return true;
}

// Shared branded wrapper for all outbound emails (inline styles for email clients).
function emailShell(heading, bodyHtml) {
  return `<!DOCTYPE html><html><body style="margin:0;background:#0b0b0b;padding:24px;font-family:system-ui,'Segoe UI',Arial,sans-serif;color:#e5e5e5">
  <div style="max-width:560px;margin:0 auto;background:#141414;border:1px solid #222;border-radius:12px;overflow:hidden">
    <div style="background:#E50914;padding:18px 24px"><span style="color:#fff;font-size:18px;font-weight:800;letter-spacing:1px">MANZAR</span></div>
    <div style="padding:24px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#fff">${heading}</h1>
      <div style="font-size:15px;line-height:1.6;color:#cfcfcf">${bodyHtml}</div>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #222;font-size:12px;color:#777">You're receiving this because you requested access to Manzar.</div>
  </div>
</body></html>`;
}

// "We got your request" auto-reply, sent right after a submission is stored.
function confirmationEmail(name, email) {
  return {
    to: email,
    subject: 'We got your Manzar request',
    html: emailShell('Request received', `<p>Hi ${escapeHtml(name || 'there')},</p>
      <p>Thanks for requesting access to Manzar. We've received your details and will review your request shortly — you'll hear back from us by email.</p>
      <p>— The Manzar team</p>`),
  };
}

// Sent when an admin marks a request Approved.
function approvedEmail(r) {
  return {
    to: r.email,
    subject: 'Your Manzar request is approved',
    html: emailShell('You\'re approved 🎉', `<p>Hi ${escapeHtml(r.name || 'there')},</p>
      <p>Good news — your request to join Manzar has been approved. We're setting up your Xtream line now and will email your login and setup steps shortly.</p>
      <p>— The Manzar team</p>`),
  };
}

// Sent when an admin marks a request Onboarded, carrying the customer's line.
function onboardedEmail(r, username, password) {
  const row = (label, value) =>
    `<tr><td style="padding:8px 12px;color:#9a9a9a">${label}</td><td style="padding:8px 12px;color:#fff;font-family:ui-monospace,Menlo,monospace">${escapeHtml(value)}</td></tr>`;
  return {
    to: r.email,
    subject: 'Your Manzar line is ready',
    html: emailShell('Welcome to Manzar', `<p>Hi ${escapeHtml(r.name || 'there')},</p>
      <p>Your line is live. Plug these details into any Xtream-compatible player:</p>
      <table style="border-collapse:collapse;background:#0f0f0f;border:1px solid #222;border-radius:8px;margin:8px 0 20px">
        ${row('Server URL', XTREAM_SERVER_URL)}
        ${row('Username', username)}
        ${row('Password', password)}
      </table>
      <h2 style="font-size:15px;color:#fff;margin:0 0 8px">How to set up</h2>
      <ol style="margin:0;padding-left:20px">
        <li>Install an Xtream player — we recommend <strong>Televizo</strong> (IPTV Smarters, TiViMate and VLC work too).</li>
        <li>Choose "Login with Xtream Codes".</li>
        <li>Enter the Server URL, Username and Password above.</li>
        <li>Your movies and live channels load automatically.</li>
      </ol>
      <p style="margin-top:20px">Enjoy,<br>— The Manzar team</p>`),
  };
}

app.use(express.json());

// Admin password for the dashboard. Set ADMIN_TOKEN in production.
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

// ----- Tiny JSON file reader (used for the content catalog) -----
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Lifecycle of a join request: it lands as "pending", then an admin moves it
// to approved / rejected / onboarded from the requests page.
const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'onboarded'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-\s]{7,20}$/;

// ===================== Public storefront API =====================

// Config the frontend needs (server URL to display in the setup section).
app.get('/api/config', (req, res) => {
  res.json({ server_url: XTREAM_SERVER_URL });
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
    // Best-effort confirmation email — never let it block or fail the request.
    sendEmail(confirmationEmail(name, email)).catch((err) =>
      console.error('confirmation email failed:', err.message)
    );
    res.json({ message: "Thanks! Your request is in — we'll be in touch by email." });
  } catch (err) {
    console.error('join request failed:', err.message);
    res.status(502).json({ error: 'Could not save your request. Please try again in a moment.' });
  }
});

// ===================== Admin: join-request management =====================

// Move a request through its lifecycle (pending → approved / rejected / onboarded).
app.post('/api/admin/requests/status', requireAdmin, async (req, res) => {
  const id = String(req.body?.id || '').trim();
  const status = String(req.body?.status || '').trim();
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing request id.' });
  if (!REQUEST_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${REQUEST_STATUSES.join(', ')}.` });
  }
  if (status === 'onboarded' && (!username || !password)) {
    return res.status(400).json({ error: 'Onboarding needs a username and password to send the welcome email.' });
  }
  if (!supabaseReady) return res.status(503).json({ error: 'Supabase is not configured.' });
  try {
    const request = await updateJoinRequestStatus(id, status);
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    // Best-effort transactional email — the status change already succeeded, so
    // report an email failure back to the admin rather than failing the request.
    let emailed = false;
    let emailError = '';
    try {
      if (status === 'approved') emailed = await sendEmail(approvedEmail(request));
      else if (status === 'onboarded') emailed = await sendEmail(onboardedEmail(request, username, password));
    } catch (err) {
      emailError = err.message;
      console.error('status email failed:', err.message);
    }
    res.json({ request, emailed, emailError });
  } catch (err) {
    console.error('update request failed:', err.message);
    res.status(502).json({ error: 'Could not update the request.' });
  }
});

// Delete a request permanently.
app.post('/api/admin/requests/delete', requireAdmin, async (req, res) => {
  const id = String(req.body?.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Missing request id.' });
  if (!supabaseReady) return res.status(503).json({ error: 'Supabase is not configured.' });
  try {
    await deleteJoinRequest(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete request failed:', err.message);
    res.status(502).json({ error: 'Could not delete the request.' });
  }
});

// ===================== Admin UI (browser views) =====================

// Shared page chrome: dark theme, top nav, admin token carried in every link.
function adminPage({ title, token, body }) {
  const t = encodeURIComponent(String(token));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Manzar — ${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;margin:0}
  .topbar{display:flex;align-items:center;gap:24px;padding:16px 32px;border-bottom:1px solid #222;background:#101010}
  .topbar h1{color:#E50914;margin:0;font-size:1.1rem}
  .topbar nav{display:flex;gap:6px}
  .topbar nav a{color:#cfcfcf;text-decoration:none;padding:7px 12px;border-radius:6px;font-size:.9rem}
  .topbar nav a:hover{background:#1c1c1c}
  .topbar nav a.active{background:#E50914;color:#fff}
  main{padding:28px 32px;max-width:1100px}
  h2{margin:0 0 16px;font-size:1.05rem;color:#ddd}
  .muted{color:#8a8a8a;font-size:.85rem}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
  .card{background:#141414;border:1px solid #222;border-radius:10px;padding:18px}
  .card .num{display:block;font-size:1.8rem;font-weight:800}
  .card .lbl{color:#9a9a9a;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #222;font-size:13px;vertical-align:top}
  th{color:#b3b3b3} tr:hover td{background:#141414}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;text-transform:uppercase;font-weight:700}
  .pill.pending{background:#3d360f;color:#facc15}
  .pill.approved{background:#0f2a3d;color:#38bdf8}
  .pill.rejected{background:#3d0f12;color:#f87171}
  .pill.onboarded{background:#0f3d21;color:#4ade80}
  .actions{white-space:nowrap}
  button{background:#1c1c1c;color:#eee;border:1px solid #333;border-radius:5px;padding:5px 9px;cursor:pointer;font-size:12px;margin:2px 2px 0 0}
  button:hover{border-color:#E50914}
  button.approve:hover{border-color:#38bdf8;color:#38bdf8}
  button.onboard:hover{border-color:#4ade80;color:#4ade80}
  button.reject:hover,button.danger:hover{border-color:#f87171;color:#f87171}
  .btn-link{display:inline-block;background:#E50914;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:.9rem}
</style></head><body>
  <header class="topbar">
    <h1>Manzar Admin</h1>
    <nav>
      <a href="/admin?token=${t}"${title === 'Dashboard' ? ' class="active"' : ''}>Dashboard</a>
      <a href="/admin/requests?token=${t}"${title === 'Requests' ? ' class="active"' : ''}>Requests</a>
    </nav>
  </header>
  <main>${body}</main>
</body></html>`;
}

// Load requests from Supabase, returning { requests, error }.
async function loadRequests() {
  if (!supabaseReady) {
    return { requests: [], error: 'Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY).' };
  }
  try {
    return { requests: await listJoinRequests(), error: '' };
  } catch (err) {
    console.error('admin requests load failed:', err.message);
    return { requests: [], error: 'Could not load requests from Supabase.' };
  }
}

const countBy = (rows, status) => rows.filter((r) => (r.status || 'pending') === status).length;

// Admin dashboard: at-a-glance counts + a link into request management.
app.get('/admin', requireAdmin, async (req, res) => {
  const token = req.query.token || '';
  const t = encodeURIComponent(String(token));
  const { requests, error } = await loadRequests();
  const body = `
    <h2>Overview</h2>
    ${error ? `<p class="muted">${escapeHtml(error)}</p>` : ''}
    <div class="cards">
      <div class="card"><span class="num">${requests.length}</span><span class="lbl">Total</span></div>
      <div class="card"><span class="num">${countBy(requests, 'pending')}</span><span class="lbl">Pending</span></div>
      <div class="card"><span class="num">${countBy(requests, 'approved')}</span><span class="lbl">Approved</span></div>
      <div class="card"><span class="num">${countBy(requests, 'onboarded')}</span><span class="lbl">Onboarded</span></div>
      <div class="card"><span class="num">${countBy(requests, 'rejected')}</span><span class="lbl">Rejected</span></div>
    </div>
    <a class="btn-link" href="/admin/requests?token=${t}">Manage requests →</a>
    <p class="muted" style="margin-top:24px">Xtream server advertised to customers: ${escapeHtml(XTREAM_SERVER_URL)}</p>`;
  res.type('html').send(adminPage({ title: 'Dashboard', token, body }));
});

// Requests page: the full CRUD table for join requests.
app.get('/admin/requests', requireAdmin, async (req, res) => {
  const token = req.query.token || '';
  const { requests, error } = await loadRequests();

  const rows = requests
    .map((r) => {
      const status = r.status || 'pending';
      const when = r.created_at ? new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ') : '—';
      const id = escapeHtml(r.id);
      const btn = (cls, label, next) =>
        status === next ? '' : `<button class="${cls}" onclick="setStatus('${id}','${next}')">${label}</button>`;
      return `<tr>
        <td>${escapeHtml(r.name || '')}</td>
        <td>${escapeHtml(r.email || '')}</td>
        <td>${escapeHtml(r.phone || '')}</td>
        <td>${escapeHtml(r.note || '')}</td>
        <td><span class="pill ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(when)}</td>
        <td class="actions">
          ${btn('approve', 'Approve', 'approved')}
          ${status === 'onboarded' ? '' : `<button class="onboard" onclick="onboard('${id}')">Onboard</button>`}
          ${btn('reject', 'Reject', 'rejected')}
          ${status === 'pending' ? '' : `<button onclick="setStatus('${id}','pending')">Reset</button>`}
          <button class="danger" onclick="del('${id}')">Delete</button>
        </td></tr>`;
    })
    .join('');

  const body = `
    <h2>Join requests <span class="muted">(${requests.length})</span></h2>
    ${error ? `<p class="muted">${escapeHtml(error)}</p>` : ''}
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Note</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No requests yet.</td></tr>'}</tbody>
    </table>
<script>
  const TOKEN = ${JSON.stringify(String(token))};
  async function post(url, body){
    const r = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+TOKEN}, body:JSON.stringify(body)});
    const d = await r.json().catch(()=>({}));
    if(!r.ok){ alert(d.error || 'Request failed.'); return null; }
    return d;
  }
  async function setStatus(id, status){
    const d = await post('/api/admin/requests/status', {id, status});
    if(!d) return;
    if(d.emailError) alert('Status updated, but the email could not be sent:\\n' + d.emailError);
    location.reload();
  }
  async function onboard(id){
    const username = prompt('Xtream username for this customer:');
    if(username === null) return;
    const password = prompt('Xtream password for this customer:');
    if(password === null) return;
    if(!username.trim() || !password.trim()){ alert('Username and password are both required to onboard.'); return; }
    const d = await post('/api/admin/requests/status', {id, status:'onboarded', username:username.trim(), password:password.trim()});
    if(!d) return;
    if(d.emailError) alert('Onboarded, but the welcome email could not be sent:\\n' + d.emailError);
    location.reload();
  }
  async function del(id){
    if(!confirm('Delete this request permanently?')) return;
    if(await post('/api/admin/requests/delete', {id})) location.reload();
  }
</script>`;
  res.type('html').send(adminPage({ title: 'Requests', token, body }));
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
