import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initStaffPage } from './staff-layout.js';
import {
  el, bn, formatBDT, formatDate, formatDateTime, normalizeDigits, debounce,
  firebaseErrorMessage, setBusy, openModal, loadingState, emptyState, errorState
} from './ui.js';

const PAGE_SIZE = 15;
const STATUS_LABEL = { pending: 'অপেক্ষমান', approved: 'অনুমোদিত', rejected: 'বাতিল' };

const state = { status: 'all', search: '', page: 1, items: [], plans: new Map() };

const shell = await initStaffPage({ active: 'customers', title: 'আমার কাস্টমার' });
const uid = shell.profile.uid;

const $id = (id) => document.getElementById(id);
const listArea = $id('listArea');
const pagination = $id('pagination');
const tabs = [...document.querySelectorAll('#statusTabs .tab')];
const stat = {
  total: $id('statTotal'), pending: $id('statPending'),
  approved: $id('statApproved'), rejected: $id('statRejected')
};

/* ---------- Data ---------- */
async function loadPlans() {
  const snap = await getDocs(collection(db, 'plans'));
  state.plans = new Map(snap.docs.map((d) => [d.id, { name: d.data().name, price: d.data().price }]));
}

async function loadList() {
  listArea.replaceChildren(loadingState('কাস্টমার তালিকা লোড হচ্ছে...'));
  pagination.classList.add('hidden');
  try {
    const snap = await getDocs(query(collection(db, 'customers'), where('createdBy', '==', uid)));
    state.items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    state.page = 1;
    renderStats();
    render();
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

const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

function render() {
  const rows = filtered();
  if (!rows.length) {
    const searching = state.search || state.status !== 'all';
    listArea.replaceChildren(searching
      ? emptyState('কোনো ফলাফল পাওয়া যায়নি', 'ফিল্টার বা সার্চ পরিবর্তন করে দেখুন।', '🔍')
      : emptyState('এখনো কোনো কাস্টমার নেই', '"নতুন কাস্টমার" বাটনে ক্লিক করে প্রথম কাস্টমার যোগ করুন।', '👥'));
    pagination.classList.add('hidden');
    return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      th('আইডি'), th('নাম'), th('মোবাইল'), th('প্ল্যান'), th('এন্ট্রির তারিখ'), th('স্ট্যাটাস'), th('অ্যাকশন')
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
      el('div', { text: plan ? plan.name : 'অজানা প্ল্যান' }),
      plan ? el('div', { class: 'cell-sub', text: `${formatBDT(plan.price)} / মাস` }) : null
    ]),
    el('td', { text: formatDate(c.createdAt) }),
    el('td', {}, [el('span', { class: `badge badge-${c.status}`, text: STATUS_LABEL[c.status] || c.status })]),
    el('td', {}, [el('div', { class: 'row-actions' }, [
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'বিস্তারিত', onclick: () => showDetails(c) }),
      c.status === 'approved'
        ? el('a', { class: 'btn btn-success btn-sm', href: 'staff-receipts.html', text: 'রিসিট' })
        : null
    ])])
  ]);
}

/* ---------- Details (NID দেখানো হয় না) ---------- */
function showDetails(c) {
  const plan = state.plans.get(c.planId);
  const row = (label, value) => [el('dt', { text: label }), el('dd', {}, [value])];

  const rows = [
    row('কাস্টমার আইডি', el('span', { class: 'mono', text: c.customerId || c.id })),
    row('নাম', c.name || '—'),
    row('মোবাইল', el('span', { class: 'mono', text: c.mobile || '—' })),
    row('ঠিকানা', c.address || '—'),
    row('প্ল্যান', plan ? `${plan.name} — ${formatBDT(plan.price)} / মাস` : 'অজানা প্ল্যান'),
    row('জন্ম তারিখ', c.birthDate ? formatDate(c.birthDate) : '—'),
    row('এন্ট্রির সময়', formatDateTime(c.createdAt)),
    row('স্ট্যাটাস', el('span', { class: `badge badge-${c.status}`, text: STATUS_LABEL[c.status] || c.status }))
  ];
  if (c.status === 'approved') rows.push(row('অনুমোদনের সময়', formatDateTime(c.approvedAt)));
  if (c.status === 'rejected') {
    rows.push(row('বাতিলের কারণ', c.rejectReason || '—'));
    rows.push(row('বাতিলের সময়', formatDateTime(c.rejectedAt)));
  }

  let dialog;
  const footer = [el('button', { class: 'btn btn-secondary', type: 'button', text: 'বন্ধ করুন', onclick: () => dialog.close() })];
  if (c.status === 'approved') footer.push(el('a', { class: 'btn', href: 'staff-receipts.html', text: 'রিসিট পেজে যান' }));

  const notice = c.status === 'pending'
    ? el('div', { class: 'alert alert-warning mb-2', text: 'অ্যাডমিনের অনুমোদনের পর রিসিট তৈরি করা যাবে।' })
    : null;

  dialog = openModal({
    title: 'কাস্টমারের বিস্তারিত',
    size: 'modal-lg',
    content: el('div', {}, [notice, el('dl', { class: 'detail-grid' }, rows.flat())]),
    footer
  });
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
    await loadPlans().catch(console.error);
    await loadList();
  } finally {
    setBusy(btn, false);
  }
});

/* ---------- Init ---------- */
await loadPlans().catch((err) => console.error(err));
loadList();