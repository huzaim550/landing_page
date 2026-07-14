// ===== Manzar — Express backend =====
// Serves the static landing page and handles the APK download.

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env (ADMIN_TOKEN, etc.) if present. Real env vars still take precedence.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  /* no .env file — rely on real environment variables */
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Admin password for viewing signups. Set ADMIN_TOKEN in the environment in production.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'changeme';
if (ADMIN_TOKEN === 'changeme') {
  console.warn('⚠  ADMIN_TOKEN is unset — using default "changeme". Set ADMIN_TOKEN before deploying.');
}

// Gate for admin-only routes. Accepts the token via ?token= or an Authorization: Bearer header.
function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = req.query.token || bearer;
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized. Provide the admin token.' });
  }
  next();
}

// The APK the download button serves. Drop your build here (see downloads/README.txt).
const APK_PATH = path.join(__dirname, 'downloads', 'yourapp.apk');
const APK_FILENAME = 'manzar.apk';

// Simple persisted download counter.
const STATS_PATH = path.join(__dirname, 'stats.json');
function readStats() {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return { downloads: 0 };
  }
}
function writeStats(stats) {
  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2));
  } catch (err) {
    console.error('Could not write stats:', err.message);
  }
}

// ----- Routes -----

// Download the APK with correct headers, and count it.
app.get('/download', (req, res) => {
  if (!fs.existsSync(APK_PATH)) {
    return res
      .status(404)
      .send('App build not available yet. Please add downloads/yourapp.apk on the server.');
  }

  const stats = readStats();
  stats.downloads += 1;
  writeStats(stats);

  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.download(APK_PATH, APK_FILENAME);
});

// Public download count (powers the hero "X downloads" badge).
app.get('/api/stats', (req, res) => {
  res.json(readStats());
});

// Email signup — stores interested users, one JSON line per signup.
const SIGNUPS_PATH = path.join(__dirname, 'signups.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readSignups() {
  try {
    return JSON.parse(fs.readFileSync(SIGNUPS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

app.post('/api/signup', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const signups = readSignups();
  if (signups.some((s) => s.email === email)) {
    return res.json({ message: "You're already on the list — thanks!" });
  }

  signups.push({ email, at: new Date().toISOString() });
  try {
    fs.writeFileSync(SIGNUPS_PATH, JSON.stringify(signups, null, 2));
  } catch (err) {
    console.error('Could not save signup:', err.message);
    return res.status(500).json({ error: 'Could not save your email. Please try again.' });
  }

  res.json({ message: "You're on the list! We'll email you when there's news." });
});

// Admin: list collected signups (JSON). Requires the admin token.
app.get('/api/signups', requireAdmin, (req, res) => {
  const signups = readSignups();
  res.json({ count: signups.length, signups });
});

// Admin: simple HTML dashboard to eyeball signups in a browser.
app.get('/admin', requireAdmin, (req, res) => {
  const signups = readSignups();
  const { downloads } = readStats();
  const rows = signups
    .map(
      (s, i) =>
        `<tr><td>${i + 1}</td><td>${escapeHtml(s.email)}</td><td>${escapeHtml(s.at)}</td></tr>`
    )
    .join('');
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Manzar Admin</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee;margin:0;padding:40px}
  h1{color:#E50914} .stats{color:#b3b3b3;margin-bottom:24px}
  table{border-collapse:collapse;width:100%;max-width:720px}
  th,td{text-align:left;padding:10px 14px;border-bottom:1px solid #222;font-size:14px}
  th{color:#b3b3b3} tr:hover td{background:#141414}
  .empty{color:#777}
</style></head><body>
  <h1>Manzar — Signups</h1>
  <p class="stats">${signups.length} email(s) · ${downloads} download(s)</p>
  ${
    signups.length
      ? `<table><thead><tr><th>#</th><th>Email</th><th>Signed up</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="empty">No signups yet.</p>'
  }
</body></html>`);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// Health check.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve the static landing page (index.html, css/, js/, assets/, downloads/).
app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Manzar landing running at http://localhost:${PORT}`);
});
