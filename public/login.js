(() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const form = $('form'), email = $('email'), pw = $('password'), btn = $('submit');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Theme: theme.js already applied saved/system choice; follow OS changes until the user picks one
  $('themeBtn').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    safeSet('theme', root.dataset.theme);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!safeGet('theme')) root.dataset.theme = e.matches ? 'dark' : 'light';
  });

  // Time-aware greeting
  const h = new Date().getHours();
  $('greet').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('yr').textContent = new Date().getFullYear();

  // Remember last email
  const lastEmail = safeGet('lastEmail');
  if (lastEmail) { email.value = lastEmail; $('remember').checked = true; }
  (email.value ? pw : email).focus();

  // Show / hide password
  $('peek').addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    $('peek').setAttribute('aria-pressed', show);
    pw.focus();
  });

  // Caps Lock warning
  const caps = e => {
    if (!e.getModifierState) return;
    const on = e.getModifierState('CapsLock') ? '⇪ Caps Lock is on' : '';
    if ($('capsHint').textContent !== on) $('capsHint').textContent = on;
  };
  pw.addEventListener('keydown', caps);
  pw.addEventListener('keyup', caps);
  pw.addEventListener('blur', () => { $('capsHint').textContent = ''; });

  // Inline validation (after first blur)
  function validateEmail(show) {
    const v = email.value.trim();
    const msg = !v ? 'Enter your email address.' : !EMAIL_RE.test(v) ? 'That email doesn’t look right.' : '';
    if (show) setInvalid(email, msg);
    return !msg;
  }
  function setInvalid(input, msg) {
    const f = input.closest('.field');
    f.classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', !!msg);
    if (input === email) $('emailHint').textContent = msg;
  }
  email.addEventListener('blur', () => email.value && validateEmail(true));
  email.addEventListener('input', () => { if (email.closest('.field').classList.contains('invalid')) validateEmail(true); hideAlert(); });
  pw.addEventListener('input', () => { setInvalid(pw, ''); hideAlert(); });

  function showAlert(msg) {
    // Clear then set on the next frame so screen readers re-announce a repeated message
    $('alertText').textContent = '';
    $('alert').hidden = false;
    requestAnimationFrame(() => { $('alertText').textContent = msg; });
    const card = $('card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }
  function hideAlert() { $('alert').hidden = true; }

  let lockTimer;
  function lockout(ms) {
    btn.disabled = true;
    const end = Date.now() + ms;
    clearInterval(lockTimer);
    const tick = () => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      btn.querySelector('.lbl').textContent = s ? `Try again in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : 'Sign in';
      if (!s) { clearInterval(lockTimer); btn.disabled = false; hideAlert(); }
    };
    tick(); lockTimer = setInterval(tick, 1000);
  }

  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || btn.disabled) return;
    hideAlert();
    const okEmail = validateEmail(true);
    if (!pw.value) setInvalid(pw, 'empty');
    if (!okEmail) return email.focus();
    if (!pw.value) { showAlert('Enter your password.'); return pw.focus(); }

    busy = true;
    btn.classList.add('loading');
    btn.querySelector('.lbl').textContent = 'Signing in…';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: pw.value, remember: $('remember').checked }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        $('remember').checked ? safeSet('lastEmail', email.value.trim()) : safeDel('lastEmail');
        btn.classList.remove('loading');
        btn.classList.add('success');
        btn.querySelector('.lbl').textContent = 'Welcome';
        setTimeout(() => document.body.classList.add('leaving'), 450);
        setTimeout(() => location.replace('/app'), 900);
        return;
      }
      busy = false;
      btn.classList.remove('loading');
      btn.querySelector('.lbl').textContent = 'Sign in';
      if (res.status === 429) { showAlert(data.error); return lockout(data.retryAfter || 300000); }
      if (res.status !== 401) { showAlert(data.error || 'Something went wrong. Please try again.'); return; }
      setInvalid(pw, 'bad');
      const left = data.remaining;
      showAlert((data.error || 'Sign-in failed.') + (left > 0 && left < 3 ? ` ${left} attempt${left > 1 ? 's' : ''} left.` : ''));
      pw.select();
    } catch {
      busy = false;
      btn.classList.remove('loading');
      btn.querySelector('.lbl').textContent = 'Sign in';
      showAlert('Can’t reach the server. Check your connection and try again.');
    }
  });

  $('forgot').addEventListener('click', () => toast('Please contact the clinic administrator to reset your password.'));

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 6000);
  }

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
  function safeDel(k) { try { localStorage.removeItem(k); } catch {} }
})();
