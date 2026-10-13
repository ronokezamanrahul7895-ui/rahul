import { login, redirectIfAuthenticated, authErrorMessage, REASON_MESSAGES, ROLE_HOME } from './auth.js';

const $ = (id) => document.getElementById(id);
const form = $('loginForm');
const emailEl = $('email');
const passwordEl = $('password');
const alertEl = $('formAlert');
const submitBtn = $('submitBtn');
const submitSpinner = $('submitSpinner');
const submitText = $('submitText');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showAlert(message, type = 'error') {
  alertEl.className = `alert alert-${type}`;
  alertEl.textContent = message;
}

function hideAlert() {
  alertEl.className = 'alert hidden';
  alertEl.textContent = '';
}

function setFieldError(input, errorEl, message) {
  errorEl.textContent = message || '';
  input.classList.toggle('is-invalid', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function validate() {
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  let ok = true;

  if (!email) {
    setFieldError(emailEl, $('emailError'), 'ইমেইল দিন।');
    ok = false;
  } else if (!EMAIL_RE.test(email)) {
    setFieldError(emailEl, $('emailError'), 'সঠিক ইমেইল ঠিকানা দিন।');
    ok = false;
  } else {
    setFieldError(emailEl, $('emailError'), '');
  }

  if (!password) {
    setFieldError(passwordEl, $('passwordError'), 'পাসওয়ার্ড দিন।');
    ok = false;
  } else if (password.length < 6) {
    setFieldError(passwordEl, $('passwordError'), 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
    ok = false;
  } else {
    setFieldError(passwordEl, $('passwordError'), '');
  }
  return ok;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.setAttribute('aria-busy', String(isLoading));
  submitSpinner.classList.toggle('hidden', !isLoading);
  submitText.textContent = isLoading ? 'লগইন হচ্ছে...' : 'লগইন করুন';
  emailEl.disabled = isLoading;
  passwordEl.disabled = isLoading;
}

$('togglePassword').addEventListener('click', (e) => {
  const show = passwordEl.type === 'password';
  passwordEl.type = show ? 'text' : 'password';
  e.currentTarget.textContent = show ? 'লুকান' : 'দেখান';
  e.currentTarget.setAttribute('aria-label', show ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান');
});

emailEl.addEventListener('input', () => setFieldError(emailEl, $('emailError'), ''));
passwordEl.addEventListener('input', () => setFieldError(passwordEl, $('passwordError'), ''));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  if (!validate()) return;

  setLoading(true);
  try {
    const { profile } = await login(emailEl.value.trim(), passwordEl.value);
    showAlert('লগইন সফল হয়েছে। রিডাইরেক্ট হচ্ছে...', 'success');
    window.location.replace(ROLE_HOME[profile.role]);
  } catch (err) {
    showAlert(authErrorMessage(err), 'error');
    passwordEl.value = '';
    setLoading(false);
    passwordEl.focus();
  }
});

(async function init() {
  const reason = new URLSearchParams(window.location.search).get('reason');
  if (reason && REASON_MESSAGES[reason]) {
    showAlert(REASON_MESSAGES[reason], reason === 'logout' ? 'info' : 'warning');
    history.replaceState(null, '', window.location.pathname);
  }

  try {
    await redirectIfAuthenticated();
  } catch (err) {
    console.error(err);
  } finally {
    $('pageLoader').classList.add('hidden');
    emailEl.focus();
  }
})();
