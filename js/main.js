// ===== Manzar landing page — vanilla JS =====

// 1) Solid navbar background once the user scrolls
const navbar = document.getElementById('navbar');
const onScroll = () => {
  navbar.classList.toggle('scrolled', window.scrollY > 50);
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// 2) Mobile hamburger menu toggle
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

// Close the mobile menu after tapping any link inside it
navLinks.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

// 3) Live download-count badge in the hero
const badge = document.getElementById('downloadBadge');
const countEl = document.getElementById('downloadCount');

fetch('/api/stats')
  .then((res) => res.json())
  .then(({ downloads }) => {
    if (typeof downloads === 'number' && downloads > 0) {
      countEl.textContent = downloads.toLocaleString();
      badge.hidden = false;
    }
  })
  .catch(() => { /* backend not running — leave badge hidden */ });

// 4) Email signup form
const signupForm = document.getElementById('signupForm');
const signupEmail = document.getElementById('signupEmail');
const signupMsg = document.getElementById('signupMsg');

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = signupEmail.value.trim();

  signupMsg.className = 'signup-msg';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    signupMsg.textContent = 'Please enter a valid email address.';
    signupMsg.classList.add('error');
    return;
  }

  const btn = signupForm.querySelector('button');
  btn.disabled = true;

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();

    if (res.ok) {
      signupMsg.textContent = data.message || "You're on the list! We'll be in touch.";
      signupMsg.classList.add('ok');
      signupForm.reset();
    } else {
      signupMsg.textContent = data.error || 'Something went wrong. Please try again.';
      signupMsg.classList.add('error');
    }
  } catch {
    signupMsg.textContent = 'Could not reach the server. Please try again later.';
    signupMsg.classList.add('error');
  } finally {
    btn.disabled = false;
  }
});
