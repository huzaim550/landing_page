// ===== Manzar storefront — vanilla JS =====

// ---- 1) Navbar background on scroll
const navbar = document.getElementById('navbar');
const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 50);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---- 2) Mobile hamburger menu
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
navToggle.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});
navLinks.querySelectorAll('a').forEach((link) =>
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  })
);

// ---- Shared state
let SERVER_URL = '';

// ---- 3) Load config (server URL to display in the setup section)
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    SERVER_URL = cfg.server_url || '';
    document.getElementById('serverUrl').textContent = SERVER_URL;
  })
  .catch(() => {
    document.getElementById('serverUrl').textContent = 'unavailable — is the server running?';
  });

// ---- 4) Copy server URL
document.getElementById('copyServer').addEventListener('click', () => {
  navigator.clipboard?.writeText(SERVER_URL).then(() => {
    const b = document.getElementById('copyServer');
    const old = b.textContent;
    b.textContent = 'Copied!';
    setTimeout(() => (b.textContent = old), 1500);
  });
});

// ---- 5) Request to join
const joinForm = document.getElementById('joinForm');
joinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('joinMsg');
  const name = document.getElementById('joinName').value.trim();
  const email = document.getElementById('joinEmail').value.trim();
  const note = document.getElementById('joinNote').value.trim();
  msg.className = 'form-msg';

  if (!name) {
    msg.textContent = 'Please enter your name.';
    msg.classList.add('error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.textContent = 'Please enter a valid email address.';
    msg.classList.add('error');
    return;
  }

  const btn = joinForm.querySelector('button');
  btn.disabled = true;
  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, note }),
    });
    const data = await res.json();
    if (res.ok) {
      joinForm.reset();
      msg.textContent = data.message || "Thanks! Your request is in — we'll be in touch by email.";
      msg.classList.add('ok');
    } else {
      msg.textContent = data.error || 'Something went wrong. Please try again.';
      msg.classList.add('error');
    }
  } catch {
    msg.textContent = 'Could not reach the server. Please try again.';
    msg.classList.add('error');
  } finally {
    btn.disabled = false;
  }
});
