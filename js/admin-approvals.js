import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, getCountFromServer,
  doc, updateDoc, deleteField, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, formatDate, formatDateTime, normalizeDigits, maskNid, debounce,
  firebaseErrorMessage, setBusy, toast, openModal, confirmDialog,
  loadingState, emptyState, errorState
} from './ui.js';

const PAGE_SIZE = 15;
const STATUS_LABEL = { pending: 'অপেক্ষমান', approved: 'অনুমোদিত', rejected: 'বাতিল' };
const EMPTY_TEXT = {
  pending: ['কোনো অপেক্ষমান কাস্টমার নেই', 'নতুন এন্ট্রি এলে এখানে দেখা যাবে।'],
  approved: ['কোনো অনুমোদিত কাস্টমার নেই', ''],
  rejected: ['কোনো বাতিল কাস্টমার নেই', '']
};

const state = {
  status: 'pending',
  items: [],
  search: '',
  page: 1,
  plans: new Map(),
  users: new Map()
};

const shell = await initAdminPage({ active: 'approvals', title: 'কাস্টমার অনুমোদন' });
const adminUid = shell.profile.uid;

const listArea = document.getElementById('listArea');
const pagination = document.getElementById('pagination');
const tabs = [...document.querySelectorAll('#statusTabs .tab')];
const statEls = {
  pending: document.getElementById('statPending'),
  approved: document.getElementById('statApproved'),
  rejected: document.getElementById('statRejected')
};

/* ---------- Data ---------- */
async function loadMeta() {
  const [plansSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, 'plans')),
    getDocs(collection(db, 'users'))
  ]);
  state.plans = new Map(plansSnap.docs.map((d) => [d.id, { name: d.data().name, price: d.data().price }]));
  state.users = new Map(usersSnap.docs.map((d) => [d.id, d.data().name || d.data().email || 'অজানা']));
}

async function loadCounts() {
  try {
    const statuses = Object.keys(statEls);
    const snaps = await Promise.all(
      statuses.map((s) => getCountFromServer(query(collection(db, 'customers'), where('status', '==', s))))
    );
    statuses.forEach((s, i) => { statEls[s].textContent = bn(snaps[i].data().count); });
    shell.setPendingBadge(snaps[0].data().count);
  } catch (err) {
    console.error(err);
  }
}

async function loadList() {
  listArea.replaceChildren(loadingState('কাস্টমার তালিকা লোড হচ্ছে...'));
  pagination.classList.add('hidden');
  try {
    const snap = await getDocs(query(collection(db, 'customers'), where('status', '==', state.status)));
    state.items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    state.page = 1;
    render();
  } catch (err) {
    console.error(err);
    listArea.replaceChildren(errorState(firebaseErrorMessage(err), loadList));
  }
}

/* ---------- Render ---------- */
function filtered() {
  const q = normalizeDigits(state.search).trim().toLowerCase();
  if (!q) return state.items;
  return state.items.filter((c) =>
    String(c.name || '').toLowerCase().includes(q) ||
    String(c.mobile || '').includes(q) ||
    String(c.customerId || c.id).toLowerCase().includes(q)
  );
}

function planLabel(planId) {
  return state.plans.get(planId) || null;
}

function th(text, cls = '') {
  return el('th', { class: cls, scope: 'col', text });
}

function render() {
  const rows = filtered();
  if (!rows.length) {
    const [title, hint] = state.search
      ? ['কোনো ফলাফল পাওয়া যায়নি', 'অন্য শব্দ দিয়ে খুঁজে দেখুন।']
      : EMPTY_TEXT[state.status];
    listArea.replaceChildren(emptyState(title, hint, state.search ? '🔍' : '📭'));
    pagination.classList.add('hidden');
    return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      th('আইডি'), th('নাম'), th('মোবাইল'), th('প্ল্যান'), th('এন্ট্রিকারী'),
      th('তারিখ'), th('স্ট্যাটাস'), th('অ্যাকশন')
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
  const plan = planLabel(c.planId);
  const actions = el('div', { class: 'row-actions' });
  actions.append(el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'বিস্তারিত', onclick: () => showDetails(c) }));
  if (c.status === 'pending' || c.status === 'rejected') {
    actions.append(el('button', { class: 'btn btn-success btn-sm', type: 'button', text: 'অনুমোদন', onclick: (e) => approve(c, e.currentTarget) }));
  }
  if (c.status === 'pending') {
    actions.append(el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'বাতিল', onclick: (e) => reject(c, e.currentTarget) }));
  }

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
    el('td', {}, [actions])
  ]);
}

/* ---------- Actions ---------- */
function removeFromList(id) {
  state.items = state.items.filter((c) => c.id !== id);
  render();
  loadCounts();
}

async function approve(c, btn) {
  const ok = await confirmDialog({
    title: 'কাস্টমার অনুমোদন',
    message: `"${c.name}" কে অনুমোদন করবেন? অনুমোদনের পর স্টাফ মাসিক রিসিট তৈরি করতে পারবে।`,
    confirmText: 'অনুমোদন করুন'
  });
  if (!ok) return false;

  setBusy(btn, true, '...');
  try {
    await updateDoc(doc(db, 'customers', c.id), {
      status: 'approved',
      approvedBy: adminUid,
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      rejectReason: deleteField(),
      rejectedBy: deleteField(),
      rejectedAt: deleteField()
    });
    toast(`"${c.name}" অনুমোদিত হয়েছে।`);
    removeFromList(c.id);
    return true;
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
    return false;
  } finally {
    setBusy(btn, false);
  }
}

async function reject(c, btn) {
  const reasonInput = el('textarea', {
    class: 'form-control', id: 'rejectReason', maxlength: '200', rows: '3',
    placeholder: 'বাতিলের কারণ (ঐচ্ছিক)'
  });
  const content = el('div', { class: 'form-group' }, [
    el('label', { class: 'form-label', for: 'rejectReason', text: 'কারণ' }),
    reasonInput
  ]);
  const ok = await confirmDialog({
    title: 'কাস্টমার বাতিল',
    message: `"${c.name}" এর এন্ট্রি বাতিল করবেন?`,
    confirmText: 'বাতিল করুন',
    danger: true,
    content
  });
  if (!ok) return false;

  setBusy(btn, true, '...');
  try {
    await updateDoc(doc(db, 'customers', c.id), {
      status: 'rejected',
      rejectReason: reasonInput.value.trim().slice(0, 200),
      rejectedBy: adminUid,
      rejectedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    toast(`"${c.name}" বাতিল করা হয়েছে।`, 'warning');
    removeFromList(c.id);
    return true;
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
    return false;
  } finally {
    setBusy(btn, false);
  }
}

/* ---------- Details modal ---------- */
function showDetails(c) {
  const plan = planLabel(c.planId);

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
  if (c.status === 'rejected') {
    rows.push(row('বাতিলের কারণ', c.rejectReason || '—'));
    rows.push(row('বাতিলের সময়', formatDateTime(c.rejectedAt)));
  }
  if (c.status === 'approved') {
    rows.push(row('অনুমোদনের সময়', formatDateTime(c.approvedAt)));
  }

  let dialog;
  const footer = [el('button', { class: 'btn btn-secondary', type: 'button', text: 'বন্ধ করুন', onclick: () => dialog.close() })];
  if (c.status === 'pending') {
    footer.push(el('button', {
      class: 'btn btn-danger', type: 'button', text: 'বাতিল',
      onclick: async (e) => { if (await reject(c, e.currentTarget)) dialog.close(); }
    }));
  }
  if (c.status === 'pending' || c.status === 'rejected') {
    footer.push(el('button', {
      class: 'btn btn-success', type: 'button', text: 'অনুমোদন',
      onclick: async (e) => { if (await approve(c, e.currentTarget)) dialog.close(); }
    }));
  }

  dialog = openModal({
    title: 'কাস্টমারের বিস্তারিত',
    size: 'modal-lg',
    content: el('dl', { class: 'detail-grid' }, rows.flat()),
    footer
  });
}

/* ---------- Events ---------- */
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    if (tab.dataset.status === state.status) return;
    state.status = tab.dataset.status;
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    loadList();
  });
});

document.getElementById('searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  state.page = 1;
  render();
}, 200));

document.getElementById('refreshBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  setBusy(btn, true, 'রিফ্রেশ হচ্ছে...');
  try {
    await Promise.all([loadMeta().catch(console.error), loadCounts(), loadList()]);
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
loadCounts();
loadList();
