import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, formatDate, firebaseErrorMessage, setBusy,
  loadingState, emptyState, errorState
} from './ui.js';
import { round2, currentMonth, monthLabel } from './receipt-utils.js';

const MONTHS_BACK = 6;
const COLORS = { primary: '#1E40AF', success: '#059669', danger: '#DC2626' };

const shell = await initAdminPage({ active: 'dashboard', title: 'ড্যাশবোর্ড' });

const $id = (id) => document.getElementById(id);
const statusArea = $id('statusArea');
const dashboard = $id('dashboard');
const refreshBtn = $id('refreshBtn');
let trendChart = null;

const month = currentMonth();
const toNum = (v) => Number(v) || 0;
const dueOf = (r) => round2(toNum(r.amount) - toNum(r.paidAmount));
const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

$id('welcomeTitle').textContent = `স্বাগতম, ${shell.profile.name || 'অ্যাডমিন'}`;
$id('periodLabel').textContent = `চলতি মাস: ${monthLabel(month)}`;

/* ---------- Month helpers ---------- */
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function expenseMonth(e) {
  if (typeof e.date === 'string' && /^\d{4}-\d{2}/.test(e.date)) return e.date.slice(0, 7);
  const d = e.createdAt?.toDate?.();
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
}

/* ---------- Data ---------- */
async function count(q) {
  try {
    return (await getCountFromServer(q)).data().count;
  } catch (err) {
    console.error(err);
    return null;
  }
}

async function fetchData() {
  const from = shiftMonth(month, -(MONTHS_BACK - 1));
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(from, i));

  const [rSnap, eSnap, dueSnap, pendingSnap, approvedCount, activePlans, activeUsers] = await Promise.all([
    getDocs(query(collection(db, 'receipts'), where('month', '>=', from), where('month', '<=', month))),
    getDocs(query(collection(db, 'expenses'), where('date', '>=', `${from}-01`), where('date', '<=', `${month}-31`))),
    getDocs(query(collection(db, 'receipts'), where('status', 'in', ['due', 'partial']))),
    getDocs(query(collection(db, 'customers'), where('status', '==', 'pending'))),
    count(query(collection(db, 'customers'), where('status', '==', 'approved'))),
    count(query(collection(db, 'plans'), where('isActive', '==', true))),
    count(query(collection(db, 'users'), where('isActive', '==', true)))
  ]);

  return {
    months,
    receipts: rSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    expenses: eSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    dues: dueSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    pending: pendingSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)),
    approvedCount,
    activePlans,
    activeUsers
  };
}

/* ---------- Render ---------- */
function renderMonth({ receipts, expenses }) {
  const cur = receipts.filter((r) => r.month === month);
  const billed = cur.reduce((s, r) => s + toNum(r.amount), 0);
  const paid = cur.reduce((s, r) => s + toNum(r.paidAmount), 0);
  const expense = expenses
    .filter((e) => expenseMonth(e) === month)
    .reduce((s, e) => s + toNum(e.amount), 0);
  const profit = round2(paid - expense);
  const rate = billed > 0 ? Math.round((paid / billed) * 100) : 0;

  $id('mBilled').textContent = formatBDT(billed);
  $id('mCount').textContent = `${bn(cur.length)}টি রিসিট`;
  $id('mPaid').textContent = formatBDT(paid);
  $id('mRate').textContent = `আদায়ের হার ${bn(rate)}%`;
  $id('mDue').textContent = formatBDT(round2(billed - paid));
  $id('mExpense').textContent = formatBDT(expense);

  const isLoss = profit < 0;
  $id('mProfitLabel').textContent = isLoss ? 'নেট ক্ষতি' : 'নেট লাভ';
  $id('mProfit').textContent = formatBDT(Math.abs(profit));
  $id('mProfitCard').className = `stat-card ${isLoss ? 'loss' : 'profit'}`;
}

function renderSystem(data) {
  const num = (v) => (v === null ? '—' : bn(v));
  $id('cPending').textContent = bn(data.pending.length);
  $id('cApproved').textContent = num(data.approvedCount);
  $id('pActive').textContent = num(data.activePlans);
  $id('uActive').textContent = num(data.activeUsers);

  const total = round2(data.dues.reduce((s, r) => s + dueOf(r), 0));
  $id('totalDue').textContent = formatBDT(total);
  $id('totalDueNote').textContent = `${bn(data.dues.length)}টি অপরিশোধিত রিসিট`;

  const alertBox = $id('pendingAlert');
  if (data.pending.length) {
    alertBox.textContent = `${bn(data.pending.length)} জন কাস্টমার অনুমোদনের অপেক্ষায় আছে।`;
    alertBox.classList.remove('hidden');
  } else {
    alertBox.classList.add('hidden');
  }
}

function renderTrend({ months, receipts, expenses }) {
  if (typeof Chart === 'undefined') {
    $id('chartTrend').replaceWith(errorState('চার্ট লাইব্রেরি লোড হয়নি।'));
    return;
  }
  const income = months.map((m) => round2(receipts.filter((r) => r.month === m).reduce((s, r) => s + toNum(r.paidAmount), 0)));
  const cost = months.map((m) => round2(expenses.filter((e) => expenseMonth(e) === m).reduce((s, e) => s + toNum(e.amount), 0)));
  const profit = months.map((_, i) => round2(income[i] - cost[i]));

  Chart.defaults.font.family = "'Noto Sans Bengali','Hind Siliguri',system-ui,sans-serif";
  Chart.defaults.color = '#334155';
  trendChart?.destroy();
  trendChart = new Chart($id('chartTrend'), {
    type: 'bar',
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: 'আয়', data: income, backgroundColor: COLORS.success, borderRadius: 4 },
        { label: 'খরচ', data: cost, backgroundColor: COLORS.danger, borderRadius: 4 },
        {
          type: 'line', label: 'লাভ/ক্ষতি', data: profit, borderColor: COLORS.primary,
          backgroundColor: COLORS.primary, tension: 0.3, borderWidth: 2, pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatBDT(ctx.parsed.y)}` } }
      },
      scales: {
        x: { grid: { display: false } },
        y: { suggestedMin: 0, grid: { color: '#E2E8F0' }, ticks: { callback: (v) => '৳' + Number(v).toLocaleString('bn-BD') } }
      }
    }
  });
}

function renderPending(pending) {
  if (!pending.length) {
    $id('pendingList').replaceChildren(emptyState('কোনো অপেক্ষমান কাস্টমার নেই', 'সব এন্ট্রি যাচাই করা হয়েছে।', '✅'));
    return;
  }
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('কাস্টমার'), th('মোবাইল'), th('তারিখ')])]),
    el('tbody', {}, pending.slice(0, 6).map((c) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'cell-title', text: c.name || '—' }),
        el('div', { class: 'cell-sub mono', text: c.customerId || c.id })
      ]),
      el('td', { class: 'mono', text: c.mobile || '—' }),
      el('td', { text: formatDate(c.createdAt) })
    ])))
  ]);
  const nodes = [el('div', { class: 'table-wrap' }, [table])];
  if (pending.length > 6) {
    nodes.push(el('div', { class: 'cell-sub', style: 'padding:10px 16px', text: `আরও ${bn(pending.length - 6)} জন অপেক্ষায় আছে।` }));
  }
  $id('pendingList').replaceChildren(...nodes);
}

function renderTopDues(dues) {
  const map = new Map();
  dues.forEach((r) => {
    const due = dueOf(r);
    if (due <= 0) return;
    const cur = map.get(r.customerId) || { id: r.customerId, name: r.customerName || '—', due: 0, count: 0 };
    cur.due = round2(cur.due + due);
    cur.count += 1;
    map.set(r.customerId, cur);
  });
  const top = [...map.values()].sort((a, b) => b.due - a.due).slice(0, 6);

  if (!top.length) {
    $id('dueList').replaceChildren(emptyState('কোনো বকেয়া নেই', 'সব বিল পরিশোধিত।', '🎉'));
    return;
  }
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('কাস্টমার'), th('রিসিট', 'num'), th('বকেয়া', 'num')])]),
    el('tbody', {}, top.map((c) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'cell-title', text: c.name }),
        el('div', { class: 'cell-sub mono', text: c.id || '' })
      ]),
      el('td', { class: 'num', text: bn(c.count) }),
      el('td', { class: 'num text-loss', text: formatBDT(c.due) })
    ])))
  ]);
  $id('dueList').replaceChildren(el('div', { class: 'table-wrap' }, [table]));
}

/* ---------- Load ---------- */
async function load() {
  dashboard.classList.add('hidden');
  statusArea.replaceChildren(loadingState('তথ্য লোড হচ্ছে...'));
  setBusy(refreshBtn, true, 'রিফ্রেশ হচ্ছে...');
  try {
    const data = await fetchData();
    statusArea.replaceChildren();
    dashboard.classList.remove('hidden');
    renderMonth(data);
    renderSystem(data);
    renderTrend(data);
    renderPending(data.pending);
    renderTopDues(data.dues);
    shell.setPendingBadge(data.pending.length);
  } catch (err) {
    console.error(err);
    statusArea.replaceChildren(errorState(firebaseErrorMessage(err), load));
  } finally {
    setBusy(refreshBtn, false);
  }
}

refreshBtn.addEventListener('click', load);
load();