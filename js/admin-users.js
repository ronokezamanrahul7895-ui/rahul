import { auth, db, firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, deleteUser, signOut,
  sendPasswordResetEmail, setPersistence, inMemoryPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection, getDocs, doc, setDoc, updateDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatDate, debounce, firebaseErrorMessage, setBusy, toast,
  openModal, confirmDialog, loadingState, emptyState, errorState
} from './ui.js';

const ROLE_LABEL = { admin: 'অ্যাডমিন', staff: 'স্টাফ' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const USER_ERRORS = {
  'auth/email-already-in-use': 'এই ইমেইল দিয়ে আগেই অ্যাকাউন্ট খোলা হয়েছে।',
  'auth/weak-password': 'পাসওয়ার্ড দুর্বল। আরও শক্তিশালী পাসওয়ার্ড দিন।',
  'auth/invalid-email': 'ইমেইল ঠিকানাটি সঠিক নয়।',
  'auth/user-not-found': 'এই ইমেইলের কোনো অ্যাকাউন্ট পাওয়া যায়নি।'
};
const userError = (err) => USER_ERRORS[err?.code] || firebaseErrorMessage(err);

const state = { role: 'all', search: '', items: [] };

const shell = await initAdminPage({ active: 'users', title: 'ইউজার ম্যানেজমেন্ট' });
const myUid = shell.profile.uid;

const $id = (id) => document.getElementById(id);
const listArea = $id('listArea');
const tabs = [...document.querySelectorAll('#roleTabs .tab')];
const stat = {
  total: $id('statTotal'), active: $id('statActive'),
  admin: $id('statAdmin'), staff: $id('statStaff')
};

const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

/* ---------- Secondary app (অ্যাডমিনের সেশন অক্ষুণ্ণ রাখতে) ---------- */
async function getSecondaryAuth() {
  const app = getApps().find((a) => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
  const sAuth = getAuth(app);
  await setPersistence(sAuth, inMemoryPersistence);
  return sAuth;
}

/* ---------- Data ---------- */
async function loadList() {
  listArea.replaceChildren(loadingState('ইউজার তালিকা লোড হচ্ছে...'));
  try {
    const snap = await getDocs(collection(db, 'users'));
    state.items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.role === b.role ? 0 : a.role === 'admin' ? -1 : 1) ||
        String(a.name || '').localeCompare(String(b.name || ''), 'bn'));
    renderStats();
    render();
  } catch (err) {
    console.error(err);
    listArea.replaceChildren(errorState(firebaseErrorMessage(err), loadList));
  }
}

/* ---------- Render ---------- */
function renderStats() {
  stat.total.textContent = bn(state.items.length);
  stat.active.textContent = bn(state.items.filter((u) => u.isActive === true).length);
  stat.admin.textContent = bn(state.items.filter((u) => u.role === 'admin').length);
  stat.staff.textContent = bn(state.items.filter((u) => u.role === 'staff').length);
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.items.filter((u) => {
    if (state.role !== 'all' && u.role !== state.role) return false;
    if (!q) return true;
    return String(u.name || '').toLowerCase().includes(q) || String(u.email || '').toLowerCase().includes(q);
  });
}

function render() {
  const rows = filtered();
  if (!rows.length) {
    const searching = state.search || state.role !== 'all';
    listArea.replaceChildren(searching
      ? emptyState('কোনো ফলাফল পাওয়া যায়নি', 'ফিল্টার বা সার্চ পরিবর্তন করে দেখুন।', '🔍')
      : emptyState('কোনো ইউজার নেই', '"নতুন ইউজার" বাটনে ক্লিক করে অ্যাকাউন্ট তৈরি করুন।', '🔐'));
    return;
  }

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('নাম'), th('ইমেইল'), th('রোল'), th('স্ট্যাটাস'), th('তৈরির তারিখ'), th('অ্যাকশন')])]),
    el('tbody', {}, rows.map(buildRow))
  ]);
  listArea.replaceChildren(el('div', { class: 'table-wrap' }, [table]));
}

function buildRow(u) {
  const isSelf = u.id === myUid;
  const active = u.isActive === true;

  const actions = el('div', { class: 'row-actions' }, [
    el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'এডিট', onclick: () => openEditForm(u) }),
    el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'পাসওয়ার্ড রিসেট', onclick: (e) => resetPassword(u, e.currentTarget) }),
    el('button', {
      class: `btn btn-sm ${active ? 'btn-danger' : 'btn-success'}`, type: 'button',
      text: active ? 'নিষ্ক্রিয়' : 'সক্রিয়', disabled: isSelf,
      title: isSelf ? 'নিজের অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না' : '',
      onclick: (e) => toggleActive(u, e.currentTarget)
    })
  ]);

  return el('tr', {}, [
    el('td', {}, [
      el('div', { class: 'cell-title', text: u.name || '—' }),
      isSelf ? el('div', { class: 'cell-sub', text: '(আপনি)' }) : null
    ]),
    el('td', { class: 'mono', text: u.email || '—' }),
    el('td', {}, [el('span', { class: 'badge badge-role', text: ROLE_LABEL[u.role] || u.role || '—' })]),
    el('td', {}, [el('span', { class: `badge ${active ? 'badge-active' : 'badge-inactive'}`, text: active ? 'সক্রিয়' : 'নিষ্ক্রিয়' })]),
    el('td', { text: formatDate(u.createdAt) }),
    el('td', {}, [actions])
  ]);
}

/* ---------- Form helpers ---------- */
function field({ id, label, input, required = false, hint = null }) {
  const error = el('div', { class: 'form-error', id: `${id}Error`, role: 'alert' });
  const group = el('div', { class: 'form-group' }, [
    el('label', { class: `form-label${required ? ' required' : ''}`, for: id, text: label }),
    input,
    hint,
    error
  ]);
  return { group, error, input };
}

function setError(f, message) {
  f.error.textContent = message || '';
  f.input.classList.toggle('is-invalid', Boolean(message));
  f.input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function roleSelect(id, value) {
  const select = el('select', { class: 'form-control', id }, Object.entries(ROLE_LABEL).map(([v, t]) => el('option', { value: v, text: t })));
  select.value = value;
  return select;
}

/* ---------- Create user ---------- */
function openCreateForm() {
  const nameF = field({
    id: 'nuName', label: 'নাম', required: true,
    input: el('input', { class: 'form-control', id: 'nuName', type: 'text', maxlength: '80', autocomplete: 'off' })
  });
  const emailF = field({
    id: 'nuEmail', label: 'ইমেইল', required: true,
    input: el('input', { class: 'form-control', id: 'nuEmail', type: 'email', inputmode: 'email', autocomplete: 'off', placeholder: 'staff@company.com' })
  });
  const passF = field({
    id: 'nuPass', label: 'প্রাথমিক পাসওয়ার্ড', required: true,
    input: el('input', { class: 'form-control', id: 'nuPass', type: 'password', autocomplete: 'new-password' }),
    hint: el('div', { class: 'form-hint', text: 'কমপক্ষে ৮ অক্ষর, অন্তত একটি অক্ষর ও একটি সংখ্যা। ইউজারকে পাসওয়ার্ড বদলাতে বলুন।' })
  });
  const roleSel = roleSelect('nuRole', 'staff');
  const roleF = field({ id: 'nuRole', label: 'রোল', required: true, input: roleSel });

  const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const form = el('form', { id: 'userCreateForm', novalidate: true, class: 'stack' }, [
    formAlert, nameF.group, emailF.group, passF.group, roleF.group
  ]);

  [nameF, emailF, passF].forEach((f) => f.input.addEventListener('input', () => setError(f, '')));

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
  const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'userCreateForm', text: 'অ্যাকাউন্ট তৈরি করুন' });
  const dialog = openModal({ title: 'নতুন ইউজার', content: form, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formAlert.classList.add('hidden');
    let ok = true;

    const name = nameF.input.value.trim().replace(/\s+/g, ' ');
    if (!name) { setError(nameF, 'নাম দিন।'); ok = false; }
    else if (name.length < 2) { setError(nameF, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); ok = false; }
    else setError(nameF, '');

    const email = emailF.input.value.trim().toLowerCase();
    if (!email) { setError(emailF, 'ইমেইল দিন।'); ok = false; }
    else if (!EMAIL_RE.test(email)) { setError(emailF, 'সঠিক ইমেইল ঠিকানা দিন।'); ok = false; }
    else if (state.items.some((u) => String(u.email || '').toLowerCase() === email)) { setError(emailF, 'এই ইমেইল আগে থেকেই তালিকায় আছে।'); ok = false; }
    else setError(emailF, '');

    const password = passF.input.value;
    if (!password) { setError(passF, 'পাসওয়ার্ড দিন।'); ok = false; }
    else if (password.length < 8) { setError(passF, 'পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।'); ok = false; }
    else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { setError(passF, 'পাসওয়ার্ডে অন্তত একটি ইংরেজি অক্ষর ও একটি সংখ্যা থাকতে হবে।'); ok = false; }
    else setError(passF, '');

    const role = roleSel.value;
    if (!Object.hasOwn(ROLE_LABEL, role)) { setError(roleF, 'রোল নির্বাচন করুন।'); ok = false; }
    else setError(roleF, '');

    if (!ok) return;

    setBusy(saveBtn, true, 'তৈরি হচ্ছে...');
    let sAuth = null;
    try {
      sAuth = await getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(sAuth, email, password);
      try {
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email, role, isActive: true,
          createdBy: myUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
      } catch (profileErr) {
        // প্রোফাইল না লিখতে পারলে অনাথ Auth অ্যাকাউন্ট মুছে ফেলা হয়
        await deleteUser(cred.user).catch(console.error);
        throw profileErr;
      }
      toast(`"${name}" এর অ্যাকাউন্ট তৈরি হয়েছে।`);
      dialog.close();
      await loadList();
    } catch (err) {
      console.error(err);
      formAlert.textContent = userError(err);
      formAlert.classList.remove('hidden');
    } finally {
      if (sAuth) await signOut(sAuth).catch(() => {});
      setBusy(saveBtn, false);
    }
  });
}

/* ---------- Edit user ---------- */
function openEditForm(u) {
  const isSelf = u.id === myUid;

  const emailInput = el('input', { class: 'form-control', id: 'euEmail', type: 'email', value: u.email ?? '', disabled: true });
  const emailF = field({ id: 'euEmail', label: 'ইমেইল', input: emailInput, hint: el('div', { class: 'form-hint', text: 'ইমেইল পরিবর্তন করা যায় না।' }) });

  const nameF = field({
    id: 'euName', label: 'নাম', required: true,
    input: el('input', { class: 'form-control', id: 'euName', type: 'text', maxlength: '80', value: u.name ?? '' })
  });

  const roleSel = roleSelect('euRole', u.role || 'staff');
  roleSel.disabled = isSelf;
  const roleF = field({
    id: 'euRole', label: 'রোল', required: true, input: roleSel,
    hint: isSelf ? el('div', { class: 'form-hint', text: 'নিজের রোল পরিবর্তন করা যায় না।' }) : null
  });

  const activeInput = el('input', { type: 'checkbox', id: 'euActive', checked: u.isActive === true, disabled: isSelf });
  const activeRow = el('label', { class: 'check-row', for: 'euActive' }, [activeInput, el('span', { text: 'সক্রিয় (লগইন করতে পারবে)' })]);

  const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const form = el('form', { id: 'userEditForm', novalidate: true, class: 'stack' }, [
    formAlert, emailF.group, nameF.group, roleF.group, activeRow
  ]);
  nameF.input.addEventListener('input', () => setError(nameF, ''));

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
  const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'userEditForm', text: 'আপডেট করুন' });
  const dialog = openModal({ title: 'ইউজার এডিট', content: form, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formAlert.classList.add('hidden');

    const name = nameF.input.value.trim().replace(/\s+/g, ' ');
    if (!name) { setError(nameF, 'নাম দিন।'); return; }
    if (name.length < 2) { setError(nameF, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); return; }
    setError(nameF, '');

    const role = isSelf ? u.role : roleSel.value;
    const isActive = isSelf ? true : activeInput.checked;
    if (!Object.hasOwn(ROLE_LABEL, role)) { setError(roleF, 'রোল নির্বাচন করুন।'); return; }

    setBusy(saveBtn, true, 'সংরক্ষণ হচ্ছে...');
    try {
      await updateDoc(doc(db, 'users', u.id), { name, role, isActive, updatedAt: serverTimestamp() });
      toast('ইউজারের তথ্য আপডেট হয়েছে।');
      dialog.close();
      await loadList();
    } catch (err) {
      console.error(err);
      formAlert.textContent = userError(err);
      formAlert.classList.remove('hidden');
    } finally {
      setBusy(saveBtn, false);
    }
  });
}

/* ---------- Row actions ---------- */
async function toggleActive(u, btn) {
  if (u.id === myUid) return;
  const active = u.isActive === true;
  const ok = await confirmDialog({
    title: active ? 'ইউজার নিষ্ক্রিয় করুন' : 'ইউজার সক্রিয় করুন',
    message: active
      ? `"${u.name}" নিষ্ক্রিয় করলে সে আর লগইন করতে বা ডেটা দেখতে পারবে না।`
      : `"${u.name}" কে আবার সক্রিয় করবেন?`,
    confirmText: active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন',
    danger: active
  });
  if (!ok) return;

  setBusy(btn, true, '...');
  try {
    await updateDoc(doc(db, 'users', u.id), { isActive: !active, updatedAt: serverTimestamp() });
    toast(active ? 'ইউজার নিষ্ক্রিয় করা হয়েছে।' : 'ইউজার সক্রিয় করা হয়েছে।');
    await loadList();
  } catch (err) {
    console.error(err);
    toast(userError(err), 'error');
    setBusy(btn, false);
  }
}

async function resetPassword(u, btn) {
  if (!u.email) {
    toast('এই ইউজারের ইমেইল পাওয়া যায়নি।', 'error');
    return;
  }
  const ok = await confirmDialog({
    title: 'পাসওয়ার্ড রিসেট',
    message: `"${u.email}" ঠিকানায় পাসওয়ার্ড রিসেটের লিংক পাঠানো হবে। চালিয়ে যাবেন?`,
    confirmText: 'লিংক পাঠান'
  });
  if (!ok) return;

  setBusy(btn, true, 'পাঠানো হচ্ছে...');
  try {
    await sendPasswordResetEmail(auth, u.email);
    toast('পাসওয়ার্ড রিসেটের ইমেইল পাঠানো হয়েছে।');
  } catch (err) {
    console.error(err);
    toast(userError(err), 'error');
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- Events & Init ---------- */
$id('addUserBtn').addEventListener('click', openCreateForm);

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.role = tab.dataset.role;
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    render();
  });
});

$id('searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  render();
}, 200));

loadList();