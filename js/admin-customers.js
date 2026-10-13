import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, getCountFromServer,
  doc, updateDoc, deleteDoc, deleteField, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, formatDate, formatDateTime, normalizeDigits, maskNid, debounce,
  firebaseErrorMessage, setBusy, toast, openModal, confirmDialog,
  loadingState, emptyState, errorState
} from './ui.js';

const PAGE_SIZE = 15;
const STATUS_LABEL = { pending: 'অপেক্ষমান', approved: 'অনুমোদিত', rejected: 'বাতিল' };
const MOBILE_RE = /^01[3-9][0-9]{8}$/;
const NID_RE = /^([0-9]{10}|[0-9]{13}|[0-9]{17})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const state = { status: 'all', search: '', page: 1, items: [], plans: new Map(), users: new Map() };

const shell = await initAdminPage({ active: 'customers', title: 'সব কাস্টমার' });

const $id = (id) => document.getElementById(id);
const listArea = $id('listArea');
const pagination = $id('pagination');
const tabs = [...document.querySelectorAll('#statusTabs .tab')];
const stat = {
  total: $id('statTotal'), pending: $id('statPending'),
  approved: $id('statApproved'), rejected: $id('statRejected')
};

const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

/* ---------- Data ---------- */
async function loadMeta() {
  const [plansSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, 'plans')),
    getDocs(collection(db, 'users'))
  ]);
  state.plans = new Map(plansSnap.docs.map((d) => [d.id, {
    name: d.data().name, price: d.data().price, active: d.data().isActive !== false
  }]));
  state.users = new Map(usersSnap.docs.map((d) => [d.id, d.data().name || d.data().email || 'অজানা']));
}

async function loadList() {
  listArea.replaceChildren(loadingState('কাস্টমার তালিকা লোড হচ্ছে...'));
  pagination.classList.add('hidden');
  try {
    const snap = await getDocs(collection(db, 'customers'));
    state.items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    state.page = 1;
    renderStats();
    render();
    shell.setPendingBadge(state.items.filter((c) => c.status === 'pending').length);
  } catch (err) {
    console.error(err);
    listArea.replaceChildren(errorState(firebaseErrorMessage(err), loadList));
  }
}

/* ---------- Render ---------- */
function renderStats() {
  const count = (s) => state.items.filter((c) => c.status === s).length;
  stat.total.textContent = bn(state.items.length);
  stat.pending.textContent = bn(count('pending'));
  stat.approved.textContent = bn(count('approved'));
  stat.rejected.textContent = bn(count('rejected'));
}

function filtered() {
  const q = normalizeDigits(state.search).trim().toLowerCase();
  return state.items.filter((c) => {
    if (state.status !== 'all' && c.status !== state.status) return false;
    if (!q) return true;
    return String(c.name || '').toLowerCase().includes(q) ||
      String(c.mobile || '').includes(q) ||
      String(c.customerId || c.id).toLowerCase().includes(q);
  });
}

function render() {
  const rows = filtered();
  if (!rows.length) {
    const searching = state.search || state.status !== 'all';
    listArea.replaceChildren(searching
      ? emptyState('কোনো ফলাফল পাওয়া যায়নি', 'ফিল্টার বা সার্চ পরিবর্তন করে দেখুন।', '🔍')
      : emptyState('এখনো কোনো কাস্টমার নেই', 'স্টাফ কাস্টমার এন্ট্রি করলে এখানে দেখা যাবে।', '👥'));
    pagination.classList.add('hidden');
    return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      th('আইডি'), th('নাম'), th('মোবাইল'), th('প্ল্যান'), th('এন্ট্রিকারী'), th('তারিখ'), th('স্ট্যাটাস'), th('অ্যাকশন')
    ])]),
    el('tbody', {}, pageRows.map(buildRow))
  ]);
  listArea.replaceChildren(el('div', { class: 'table-wrap' }, [table]));

  const end = start + pageRows.length;
  const prev = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: '← আগের', disabled: state.page <= 1, onclick: () => { state.page--; render(); } });
  const next = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'পরের →', disabled: state.page >= pages, onclick: () => { state.page++; render(); } });
  pagination.replaceChildren(
    el('span', { text: `দেখানো হচ্ছে ${bn(start + 1)}–${bn(end)} / মোট ${bn(rows.length)} জন` }),
    el('div', { class: 'flex items-center gap-1' }, [prev, el('span', { text: `${bn(state.page)} / ${bn(pages)}` }), next])
  );
  pagination.classList.remove('hidden');
}

function buildRow(c) {
  const plan = state.plans.get(c.planId);
  return el('tr', {}, [
    el('td', { class: 'mono', text: c.customerId || c.id }),
    el('td', {}, [el('div', { class: 'cell-title', text: c.name || '—' })]),
    el('td', { class: 'mono', text: c.mobile || '—' }),
    el('td', {}, [
      el('div', { text: plan ? plan.name : 'মুছে ফেলা প্ল্যান' }),
      plan ? el('div', { class: 'cell-sub', text: `${formatBDT(plan.price)} / মাস` }) : null
    ]),
    el('td', { text: state.users.get(c.createdBy) || 'অজানা' }),
    el('td', { text: formatDate(c.createdAt) }),
    el('td', {}, [el('span', { class: `badge badge-${c.status}`, text: STATUS_LABEL[c.status] || c.status })]),
    el('td', {}, [el('div', { class: 'row-actions' }, [
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'বিস্তারিত', onclick: () => showDetails(c) }),
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'এডিট', onclick: () => openEditForm(c) }),
      el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'ডিলিট', onclick: (e) => removeCustomer(c, e.currentTarget) })
    ])])
  ]);
}

/* ---------- Details ---------- */
function showDetails(c) {
  const plan = state.plans.get(c.planId);

  const nidValue = el('span', { class: 'mono', text: maskNid(c.nid) });
  const nidCell = el('span', { class: 'inline-actions' }, [nidValue]);
  if (c.nid) {
    let shown = false;
    const toggle = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'দেখান' });
    toggle.addEventListener('click', () => {
      shown = !shown;
      nidValue.textContent = shown ? c.nid : maskNid(c.nid);
      toggle.textContent = shown ? 'লুকান' : 'দেখান';
    });
    nidCell.append(toggle);
  }

  const row = (label, value) => [el('dt', { text: label }), el('dd', {}, [value])];
  const rows = [
    row('কাস্টমার আইডি', el('span', { class: 'mono', text: c.customerId || c.id })),
    row('নাম', c.name || '—'),
    row('মোবাইল', el('span', { class: 'mono', text: c.mobile || '—' })),
    row('ঠিকানা', c.address || '—'),
    row('প্ল্যান', plan ? `${plan.name} — ${formatBDT(plan.price)} / মাস` : 'মুছে ফেলা প্ল্যান'),
    row('জন্ম তারিখ', c.birthDate ? formatDate(c.birthDate) : '—'),
    row('NID', nidCell),
    row('এন্ট্রিকারী', state.users.get(c.createdBy) || 'অজানা'),
    row('এন্ট্রির সময়', formatDateTime(c.createdAt)),
    row('স্ট্যাটাস', el('span', { class: `badge badge-${c.status}`, text: STATUS_LABEL[c.status] || c.status }))
  ];
  if (c.status === 'approved') rows.push(row('অনুমোদনের সময়', formatDateTime(c.approvedAt)));
  if (c.status === 'rejected') {
    rows.push(row('বাতিলের কারণ', c.rejectReason || '—'));
    rows.push(row('বাতিলের সময়', formatDateTime(c.rejectedAt)));
  }
  if (c.updatedAt) rows.push(row('সর্বশেষ আপডেট', formatDateTime(c.updatedAt)));

  let dialog;
  dialog = openModal({
    title: 'কাস্টমারের বিস্তারিত',
    size: 'modal-lg',
    content: el('dl', { class: 'detail-grid' }, rows.flat()),
    footer: [
      el('button', { class: 'btn btn-secondary', type: 'button', text: 'বন্ধ করুন', onclick: () => dialog.close() }),
      el('button', { class: 'btn', type: 'button', text: 'এডিট', onclick: () => { dialog.close(); openEditForm(c); } })
    ]
  });
}

/* ---------- Edit ---------- */
function field({ id, label, input, required = false, hint = null }) {
  const error = el('div', { class: 'form-error', id: `${id}Error`, role: 'alert' });
  const group = el('div', { class: `form-group${input.tagName === 'TEXTAREA' ? ' full' : ''}` }, [
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

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function openEditForm(c) {
  const idInput = el('input', { class: 'form-control', id: 'ecId', type: 'text', value: c.customerId || c.id, disabled: true });
  const idF = field({ id: 'ecId', label: 'কাস্টমার আইডি', input: idInput });

  const nameF = field({
    id: 'ecName', label: 'নাম', required: true,
    input: el('input', { class: 'form-control', id: 'ecName', type: 'text', maxlength: '100', value: c.name ?? '' })
  });
  const mobileF = field({
    id: 'ecMobile', label: 'মোবাইল নম্বর', required: true,
    input: el('input', { class: 'form-control', id: 'ecMobile', type: 'tel', inputmode: 'numeric', maxlength: '11', value: c.mobile ?? '' })
  });

  const planSelect = el('select', { class: 'form-control', id: 'ecPlan' });
  const planEntries = [...state.plans.entries()].sort((a, b) => (Number(a[1].price) || 0) - (Number(b[1].price) || 0));
  if (c.planId && !state.plans.has(c.planId)) {
    planSelect.append(el('option', { value: c.planId, text: 'মুছে ফেলা প্ল্যান (বর্তমান)' }));
  }
  planEntries.forEach(([id, p]) => {
    planSelect.append(el('option', {
      value: id,
      text: `${p.name} — ${formatBDT(p.price)}${p.active ? '' : ' (নিষ্ক্রিয়)'}`,
      disabled: !p.active && id !== c.planId
    }));
  });
  planSelect.value = c.planId ?? '';
  const planF = field({ id: 'ecPlan', label: 'প্ল্যান', required: true, input: planSelect });

  const addressInput = el('textarea', { class: 'form-control', id: 'ecAddress', maxlength: '300', rows: '3' });
  addressInput.value = c.address ?? '';
  const addressF = field({ id: 'ecAddress', label: 'ঠিকানা', required: true, input: addressInput });

  const nidF = field({
    id: 'ecNid', label: 'NID নম্বর (ঐচ্ছিক)',
    input: el('input', { class: 'form-control', id: 'ecNid', type: 'text', inputmode: 'numeric', maxlength: '17', value: c.nid ?? '' }),
    hint: el('div', { class: 'form-hint', text: '১০, ১৩ বা ১৭ ডিজিট। খালি রাখলে NID মুছে যাবে।' })
  });
  const birthF = field({
    id: 'ecBirth', label: 'জন্ম তারিখ (ঐচ্ছিক)',
    input: el('input', { class: 'form-control', id: 'ecBirth', type: 'date', min: '1900-01-01', max: todayStr(), value: c.birthDate ?? '' })
  });

  const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const grid = el('div', { class: 'form-grid' }, [
    idF.group, nameF.group, mobileF.group, planF.group, addressF.group, nidF.group, birthF.group
  ]);
  const form = el('form', { id: 'customerEditForm', novalidate: true, class: 'stack' }, [formAlert, grid]);

  [nameF, mobileF, addressF, nidF].forEach((f) => f.input.addEventListener('input', () => setError(f, '')));
  planF.input.addEventListener('change', () => setError(planF, ''));
  birthF.input.addEventListener('change', () => setError(birthF, ''));

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
  const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'customerEditForm', text: 'আপডেট করুন' });
  const dialog = openModal({ title: 'কাস্টমার এডিট', size: 'modal-lg', content: form, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formAlert.classList.add('hidden');
    let ok = true;

    const name = nameF.input.value.trim().replace(/\s+/g, ' ');
    if (!name) { setError(nameF, 'নাম দিন।'); ok = false; }
    else if (name.length < 2) { setError(nameF, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); ok = false; }
    else setError(nameF, '');

    const mobile = normalizeDigits(mobileF.input.value).replace(/\s|-/g, '');
    if (!mobile) { setError(mobileF, 'মোবাইল নম্বর দিন।'); ok = false; }
    else if (!MOBILE_RE.test(mobile)) { setError(mobileF, 'সঠিক মোবাইল নম্বর দিন (যেমন: 01712345678)।'); ok = false; }
    else setError(mobileF, '');

    const planId = planSelect.value;
    if (!planId) { setError(planF, 'প্ল্যান নির্বাচন করুন।'); ok = false; }
    else setError(planF, '');

    const address = addressInput.value.trim();
    if (!address) { setError(addressF, 'ঠিকানা দিন।'); ok = false; }
    else if (address.length < 3) { setError(addressF, 'ঠিকানা কমপক্ষে ৩ অক্ষরের হতে হবে।'); ok = false; }
    else setError(addressF, '');

    const nid = normalizeDigits(nidF.input.value).replace(/\s|-/g, '');
    if (nid && !NID_RE.test(nid)) { setError(nidF, 'NID ১০, ১৩ বা ১৭ ডিজিটের হতে হবে।'); ok = false; }
    else setError(nidF, '');

    const birth = birthF.input.value;
    if (birth && (!isRealDate(birth) || birth > todayStr() || birth < '1900-01-01')) {
      setError(birthF, 'সঠিক জন্ম তারিখ দিন।'); ok = false;
    } else setError(birthF, '');

    if (!ok) return;

    setBusy(saveBtn, true, 'সংরক্ষণ হচ্ছে...');
    try {
      await updateDoc(doc(db, 'customers', c.id), {
        name, mobile, address, planId,
        nid: nid || deleteField(),
        birthDate: birth || deleteField(),
        updatedAt: serverTimestamp()
      });
      toast('কাস্টমারের তথ্য আপডেট হয়েছে।');
      dialog.close();
      await loadList();
    } catch (err) {
      console.error(err);
      formAlert.textContent = firebaseErrorMessage(err);
      formAlert.classList.remove('hidden');
    } finally {
      setBusy(saveBtn, false);
    }
  });
}

/* ---------- Delete ---------- */
async function removeCustomer(c, btn) {
  setBusy(btn, true, '...');
  let receipts = 0;
  try {
    const snap = await getCountFromServer(query(collection(db, 'receipts'), where('customerId', '==', c.id)));
    receipts = snap.data().count;
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
    setBusy(btn, false);
    return;
  }
  setBusy(btn, false);

  if (receipts > 0) {
    toast(`এই কাস্টমারের ${bn(receipts)}টি রিসিট আছে, তাই ডিলিট করা যাবে না। রিসিটের হিসাব অক্ষুণ্ণ রাখতে বদলে বাতিল করুন।`, 'error', 7000);
    return;
  }

  const ok = await confirmDialog({
    title: 'কাস্টমার ডিলিট',
    message: `"${c.name}" কে স্থায়ীভাবে ডিলিট করবেন? এটি আর ফেরানো যাবে না।`,
    confirmText: 'ডিলিট করুন',
    danger: true
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'customers', c.id));
    toast('কাস্টমার ডিলিট হয়েছে।');
    await loadList();
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
  }
}

/* ---------- Events ---------- */
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.status = tab.dataset.status;
    state.page = 1;
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
  state.page = 1;
  render();
}, 200));

$id('refreshBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  setBusy(btn, true, 'রিফ্রেশ হচ্ছে...');
  try {
    await loadMeta().catch(console.error);
    await loadList();
  } finally {
    setBusy(btn, false);
  }
});

/* ---------- Init ---------- */
try {
  await loadMeta();
} catch (err) {
  console.error(err);
  toast('প্ল্যান/ইউজারের তথ্য লোড করা যায়নি।', 'warning');
}
loadList();