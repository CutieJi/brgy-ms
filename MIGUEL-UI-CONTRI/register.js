const $ = s => document.querySelector(s);
const registerForm = $('#loginForm');
const registerErr = $('#loginErr');

registerForm.querySelectorAll('.password-field').forEach(field => {
  const input = field.querySelector('input');
  const toggle = field.querySelector('.toggle-password');
  toggle.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
});

registerForm.onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  registerErr.textContent = '';

  if (f.password !== f.confirmPassword) return (registerErr.textContent = 'Passwords do not match.');
  if (!f.terms) return (registerErr.textContent = 'Please agree to the Terms & Conditions and Privacy Policy.');

  const r = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: f.email, password: f.password }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return (registerErr.textContent = d.error || 'Registration failed.');

  if (d.token) {
    sessionStorage.setItem('tok', d.token);
    location.href = 'index.html';
    return;
  }
  location.href = 'index.html?registered=1';
};
