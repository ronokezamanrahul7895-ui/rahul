import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initStaffPage } from './staff-layout.js';
import {
  el, bn, formatBDT, firebaseErrorMessage, setBusy, loadingState, emptyState, errorState
} from './ui.js';
import { STATUS_LABEL, round2, currentMonth, monthLabel } from './receipt-utils.js';

const shell = await initStaffPage({ active: 'dashboard', title: 'ড্যাশবোর্ড' });
const { uid, name } = shell.profile;

const $id = (id) => document.getElementById(id);
const statusArea = $id('statusArea');
const dashboard = $id('dashboard');
const refreshBtn = $id('refreshBtn');

const month = currentMonth();
const toNum = (v) => Number(v) || 0;
const dueOf = (r) => round2(toNum(r.amount) - toNum(r.paidAmount));
const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

$id('welcomeTitle').textContent = `স্বাগতম, ${name || 'স্টাফ'}`;
$id('periodLabel').textContent = `চলতি মাস: ${monthLabel(month)}`;

/* ---------- Data ---------- */
async function fetchData() {
  const [cSnap, rSnap] = await Promise.all([
    getDocs(query(collection(db, 'customers'), where('createdBy', '==', uid))),
    getDocs(query(collection(db, 'receipts'), where('createdBy', '==', uid)))
  ]);
  return {
    customers: cSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    receipts: rSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  };
}

/* ---------- Render ---------- */
function renderCustomerStats(customers) {
  const count = (s) => customers.filter((c) => c.status === s).length;
  $id('cTotal').textContent = bn(customers.length);
  $id('cPending').textContent = bn(count('pending'));
  $id('cApproved').textContent = bn(count('approved'));
  $id('cRejected').textContent = bn(count('rejected'));
}

function renderMonthStats(customers, receipts) {
  const cur = receipts.filter((r) => r.month === month);
  const billed = cur.reduce((s, r) => s + toNum(r.amount), 0);
  const paid = cur.reduce((s, r) => s + toNum(r.paidAmount), 0);
  const rate = billed > 0 ? Math.round((paid / billed) * 100) : 0;

  $id('mBilled').textContent = formatBDT(billed);
  $id('mCount').textContent = `${bn(cur.length)}টি রিসিট`;
  $id('mPaid').textContent = formatBDT(paid);
  $id('mRate').textContent = `আদায়ের হার ${bn(rate)}%`;
  $id('mDue').textContent = formatBDT(round2(billed - paid));

  const billedIds = new Set(cur.map((r) => r.customerId));
  const missing = customers
    .filter((c) => c.status === 'approved' && !billedIds.has(c.id))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'bn'));
  $id('mMissing').textContent = bn(missing.length);
  renderMissing(missing);
}

function renderDues(receipts) {
  const dues = receipts
    .filter((r) => r.status !== 'paid' && dueOf(r) > 0)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)) || dueOf(b) - dueOf(a));

  const total = round2(dues.reduce((s, r) => s + dueOf(r), 0));
  $id('totalDue').textContent = dues.length ? `${formatBDT(total)} (${bn(dues.length)}টি)` : '';

  if (!dues.length) {
    $id('dueList').replaceChildren(emptyState('কোনো বকেয়া নেই', 'সব রিসিট পরিশোধিত।', '🎉'));
    return;
  }

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('কাস্টমার'), th('মাস'), th('বকেয়া', 'num'), th('স্ট্যাটাস')])]),
    el('tbody', {}, dues.slice(0, 8).map((r) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'cell-title', text: r.customerName || '—' }),
        el('div', { class: 'cell-sub mono', text: r.customerId || '' })
      ]),
      el('td', { text: monthLabel(r.month) }),
      el('td', { class: 'num text-loss', text: formatBDT(dueOf(r)) }),
      el('td', {}, [el('span', { class: `badge badge-${r.status}`, text: STATUS_LABEL[r.status] || r.status })])
    ])))
  ]);
  const nodes = [el('div', { class: 'table-wrap' }, [table])];
  if (dues.length > 8) {
    nodes.push(el('div', { class: 'cell-sub', style: 'padding:10px 16px', text: `আরও ${bn(dues.length - 8)}টি বকেয়া রিসিট আছে।` }));
  }
  $id('dueList').replaceChildren(...nodes);
}

function renderMissing(missing) {
  if (!missing.length) {
    $id('missingList').replaceChildren(emptyState('সব রিসিট তৈরি আছে', 'এই মাসের সব অনুমোদিত কাস্টমারের রিসিট হয়েছে।', '✅'));
    return;
  }
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('কাস্টমার'), th('মোবাইল')])]),
    el('tbody', {}, missing.slice(0, 8).map((c) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'cell-title', text: c.name || '—' }),
        el('div', { class: 'cell-sub mono', text: c.customerId || c.id })
      ]),
      el('td', { class: 'mono', text: c.mobile || '—' })
    ])))
  ]);
  const nodes = [el('div', { class: 'table-wrap' }, [table])];
  if (missing.length > 8) {
    nodes.push(el('div', { class: 'cell-sub', style: 'padding:10px 16px', text: `আরও ${bn(missing.length - 8)} জনের রিসিট বাকি।` }));
  }
  $id('missingList').replaceChildren(...nodes);
}

/* ---------- Load ---------- */
async function load() {
  dashboard.classList.add('hidden');
  statusArea.replaceChildren(loadingState('তথ্য লোড হচ্ছে...'));
  setBusy(refreshBtn, true, 'রিফ্রেশ হচ্ছে...');
  try {
    const { customers, receipts } = await fetchData();

    if (!customers.length) {
      statusArea.replaceChildren(
        emptyState('এখনো কোনো কাস্টমার নেই', 'প্রথম কাস্টমার যোগ করতে "নতুন কাস্টমার" বাটনে ক্লিক করুন।', '👥')
      );
      return;
    }

    statusArea.replaceChildren();
    dashboard.classList.remove('hidden');
    renderCustomerStats(customers);
    renderMonthStats(customers, receipts);
    renderDues(receipts);
  } catch (err) {
    console.error(err);
    statusArea.replaceChildren(errorState(firebaseErrorMessage(err), load));
  } finally {
    setBusy(refreshBtn, false);
  }
}

refreshBtn.addEventListener('click', load);
load();