import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, firebaseErrorMessage, setBusy, toast,
  loadingState, emptyState, errorState
} from './ui.js';
import { STATUS_LABEL, round2, currentMonth, isValidMonth, monthLabel } from './receipt-utils.js';

/*
  Expenses ডকুমেন্টের প্রত্যাশিত ফিল্ড:
  { title, category, amount (number), date: 'YYYY-MM-DD', createdBy, createdAt }
*/

const MAX_MONTHS = 24;
const COLORS = {
  primary: '#1E40AF', success: '#059669', danger: '#DC2626', warning: '#D97706',
  info: '#0369A1', slate: '#64748B'
};
const PALETTE = ['#1E40AF', '#059669', '#D97706', '#DC2626', '#0369A1', '#7C3AED', '#DB2777', '#64748B'];

const state = { from: '', to: '', receipts: [], expenses: [], months: [], summary: [] };
const charts = {};

await initAdminPage({ active: 'analytics', title: 'অ্যানালিটিক্স' });

const $id = (id) => document.getElementById(id);
const statusArea = $id('statusArea');
const dashboard = $id('dashboard');
const fromInput = $id('fromMonth');
const toInput = $id('toMonth');
const rangeError = $id('rangeError');
const applyBtn = $id('applyBtn');
const csvSummaryBtn = $id('csvSummaryBtn');
const csvDetailBtn = $id('csvDetailBtn');

/* ---------- Month helpers ---------- */
function shiftMonth(m, delta) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsBetween(from, to) {
  const list = [];
  let m = from;
  while (m <= to && list.length <= MAX_MONTHS) {
    list.push(m);
    m = shiftMonth(m, 1);
  }
  return list;
}

const toNum = (v) => Number(v) || 0;

function expenseMonth(e) {
  if (typeof e.date === 'string' && /^\d{4}-\d{2}/.test(e.date)) return e.date.slice(0, 7);
  const d = e.createdAt?.toDate?.();
  return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : '';
}

/* ---------- Data ---------- */
async function fetchData(from, to) {
  const [rSnap, eSnap] = await Promise.all([
    getDocs(query(collection(db, 'receipts'), where('month', '>=', from), where('month', '<=', to))),
    getDocs(query(collection(db, 'expenses'), where('date', '>=', `${from}-01`), where('date', '<=', `${to}-31`)))
  ]);
  state.receipts = rSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  state.expenses = eSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function compute() {
  state.months = monthsBetween(state.from, state.to);
  const map = new Map(state.months.map((m) => [m, { month: m, count: 0, billed: 0, paid: 0, due: 0, expense: 0, profit: 0 }]));

  state.receipts.forEach((r) => {
    const row = map.get(r.month);
    if (!row) return;
    row.count += 1;
    row.billed += toNum(r.amount);
    row.paid += toNum(r.paidAmount);
  });
  state.expenses.forEach((e) => {
    const row = map.get(expenseMonth(e));
    if (row) row.expense += toNum(e.amount);
  });
  map.forEach((row) => {
    row.billed = round2(row.billed);
    row.paid = round2(row.paid);
    row.expense = round2(row.expense);
    row.due = round2(row.billed - row.paid);
    row.profit = round2(row.paid - row.expense);
  });
  state.summary = [...map.values()];
}

/* ---------- Charts ---------- */
function drawChart(key, canvasId, config) {
  charts[key]?.destroy();
  charts[key] = new Chart($id(canvasId), config);
}

const fmtTick = (v) => '৳' + Number(v).toLocaleString('bn-BD');
const tooltipMoney = { callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${formatBDT(ctx.parsed.y ?? ctx.parsed)}` } };
const pieTooltip = { callbacks: { label: (ctx) => ` ${ctx.label}: ${formatBDT(ctx.parsed)}` } };

function axisOptions() {
  return {
    x: { grid: { display: false } },
    y: { beginAtZero: true, ticks: { callback: fmtTick }, grid: { color: '#E2E8F0' } }
  };
}

function renderCharts() {
  Chart.defaults.font.family = "'Noto Sans Bengali','Hind Siliguri',system-ui,sans-serif";
  Chart.defaults.color = '#334155';

  const labels = state.summary.map((s) => monthLabel(s.month));

  drawChart('monthly', 'chartMonthly', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'আয়', data: state.summary.map((s) => s.paid), backgroundColor: COLORS.success, borderRadius: 4 },
        { label: 'খরচ', data: state.summary.map((s) => s.expense), backgroundColor: COLORS.danger, borderRadius: 4 },
        {
          type: 'line', label: 'লাভ/ক্ষতি', data: state.summary.map((s) => s.profit),
          borderColor: COLORS.primary, backgroundColor: COLORS.primary, tension: 0.3, borderWidth: 2, pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipMoney },
      scales: { x: axisOptions().x, y: { ...axisOptions().y, beginAtZero: false, suggestedMin: 0 } }
    }
  });

  drawChart('collection', 'chartCollection', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'বিল', data: state.summary.map((s) => s.billed), backgroundColor: COLORS.primary, borderRadius: 4 },
        { label: 'আদায়', data: state.summary.map((s) => s.paid), backgroundColor: COLORS.success, borderRadius: 4 },
        { label: 'বকেয়া', data: state.summary.map((s) => s.due), backgroundColor: COLORS.warning, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: tooltipMoney },
      scales: axisOptions()
    }
  });

  // প্ল্যানভিত্তিক আয়
  const byPlan = new Map();
  state.receipts.forEach((r) => {
    const k = r.planName || 'অজানা';
    byPlan.set(k, (byPlan.get(k) || 0) + toNum(r.paidAmount));
  });
  drawDoughnut('plans', 'chartPlans', [...byPlan.entries()]);

  // খরচের খাত
  const byCat = new Map();
  state.expenses.forEach((e) => {
    const k = e.category || 'অন্যান্য';
    byCat.set(k, (byCat.get(k) || 0) + toNum(e.amount));
  });
  drawDoughnut('expenses', 'chartExpenses', [...byCat.entries()]);

  // স্ট্যাটাস অনুযায়ী বিল
  const byStatus = { paid: 0, partial: 0, due: 0 };
  state.receipts.forEach((r) => {
    if (r.status in byStatus) byStatus[r.status] += toNum(r.amount);
  });
  charts.status?.destroy();
  charts.status = new Chart($id('chartStatus'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(byStatus).map((k) => STATUS_LABEL[k]),
      datasets: [{ data: Object.values(byStatus), backgroundColor: [COLORS.success, COLORS.info, COLORS.danger], borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: pieTooltip }
    }
  });
}

function drawDoughnut(key, canvasId, entries) {
  charts[key]?.destroy();
  const canvas = $id(canvasId);
  const sorted = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    charts[key] = new Chart(canvas, {
      type: 'doughnut',
      data: { labels: ['তথ্য নেই'], datasets: [{ data: [1], backgroundColor: ['#E2E8F0'], borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { enabled: false } } }
    });
    return;
  }
  charts[key] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([k]) => k),
      datasets: [{ data: sorted.map(([, v]) => round2(v)), backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: pieTooltip }
    }
  });
}

/* ---------- KPI & tables ---------- */
function renderKpis() {
  const t = state.summary.reduce((a, s) => ({
    count: a.count + s.count, billed: a.billed + s.billed, paid: a.paid + s.paid,
    due: a.due + s.due, expense: a.expense + s.expense
  }), { count: 0, billed: 0, paid: 0, due: 0, expense: 0 });
  const profit = round2(t.paid - t.expense);
  const rate = t.billed > 0 ? Math.round((t.paid / t.billed) * 100) : 0;

  $id('kBilled').textContent = formatBDT(t.billed);
  $id('kCount').textContent = `${bn(t.count)}টি রিসিট`;
  $id('kPaid').textContent = formatBDT(t.paid);
  $id('kRate').textContent = `আদায়ের হার ${bn(rate)}%`;
  $id('kDue').textContent = formatBDT(round2(t.due));
  $id('kExpense').textContent = formatBDT(t.expense);

  const isLoss = profit < 0;
  $id('kProfitLabel').textContent = isLoss ? 'নেট ক্ষতি' : 'নেট লাভ';
  $id('kProfit').textContent = formatBDT(Math.abs(profit));
  $id('kProfitCard').className = `stat-card ${isLoss ? 'loss' : 'profit'}`;
}

const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

function profitCell(v) {
  return el('td', { class: `num ${v < 0 ? 'text-loss' : 'text-profit'}`, text: (v < 0 ? '−' : '') + formatBDT(Math.abs(v)) });
}

function renderMonthlyTable() {
  const tot = state.summary.reduce((a, s) => ({
    billed: a.billed + s.billed, paid: a.paid + s.paid, due: a.due + s.due, expense: a.expense + s.expense
  }), { billed: 0, paid: 0, due: 0, expense: 0 });
  const totProfit = round2(tot.paid - tot.expense);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('মাস'), th('বিল', 'num'), th('আয়', 'num'), th('বকেয়া', 'num'), th('খরচ', 'num'), th('লাভ/ক্ষতি', 'num')])]),
    el('tbody', {}, state.summary.map((s) => el('tr', {}, [
      el('td', { text: monthLabel(s.month) }),
      el('td', { class: 'num', text: formatBDT(s.billed) }),
      el('td', { class: 'num', text: formatBDT(s.paid) }),
      el('td', { class: 'num', text: formatBDT(s.due) }),
      el('td', { class: 'num', text: formatBDT(s.expense) }),
      profitCell(s.profit)
    ]))),
    el('tfoot', {}, [el('tr', {}, [
      el('td', { text: 'মোট' }),
      el('td', { class: 'num', text: formatBDT(round2(tot.billed)) }),
      el('td', { class: 'num', text: formatBDT(round2(tot.paid)) }),
      el('td', { class: 'num', text: formatBDT(round2(tot.due)) }),
      el('td', { class: 'num', text: formatBDT(round2(tot.expense)) }),
      profitCell(totProfit)
    ])])
  ]);
  $id('monthlyTable').replaceChildren(el('div', { class: 'table-wrap' }, [table]));
}

function renderDueTable() {
  const map = new Map();
  state.receipts.forEach((r) => {
    const due = round2(toNum(r.amount) - toNum(r.paidAmount));
    if (due <= 0) return;
    const cur = map.get(r.customerId) || { id: r.customerId, name: r.customerName || '—', due: 0, count: 0 };
    cur.due = round2(cur.due + due);
    cur.count += 1;
    map.set(r.customerId, cur);
  });
  const top = [...map.values()].sort((a, b) => b.due - a.due).slice(0, 10);

  if (!top.length) {
    $id('dueTable').replaceChildren(emptyState('কোনো বকেয়া নেই', 'নির্বাচিত সময়ে সব বিল পরিশোধিত।', '🎉'));
    return;
  }
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('কাস্টমার'), th('মাস', 'num'), th('বকেয়া', 'num')])]),
    el('tbody', {}, top.map((c) => el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'cell-title', text: c.name }),
        el('div', { class: 'cell-sub mono', text: c.id || '' })
      ]),
      el('td', { class: 'num', text: bn(c.count) }),
      el('td', { class: 'num text-loss', text: formatBDT(c.due) })
    ])))
  ]);
  $id('dueTable').replaceChildren(el('div', { class: 'table-wrap' }, [table]));
}

/* ---------- CSV ---------- */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV injection প্রতিরোধ
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const text = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

csvSummaryBtn.addEventListener('click', () => {
  const rows = [['মাস', 'রিসিট সংখ্যা', 'বিল', 'আয়', 'বকেয়া', 'খরচ', 'লাভ/ক্ষতি']];
  state.summary.forEach((s) => rows.push([s.month, s.count, s.billed, s.paid, s.due, s.expense, s.profit]));
  const sum = (k) => round2(state.summary.reduce((a, s) => a + s[k], 0));
  rows.push(['মোট', sum('count'), sum('billed'), sum('paid'), sum('due'), sum('expense'), sum('profit')]);
  downloadCsv(`subtrack-summary_${state.from}_${state.to}.csv`, rows);
});

csvDetailBtn.addEventListener('click', () => {
  const rows = [['রিসিট নং', 'কাস্টমার আইডি', 'কাস্টমার', 'মাস', 'প্ল্যান', 'বিল', 'পরিশোধিত', 'বকেয়া', 'স্ট্যাটাস']];
  [...state.receipts]
    .sort((a, b) => String(a.month).localeCompare(String(b.month)) || String(a.customerName).localeCompare(String(b.customerName)))
    .forEach((r) => rows.push([
      r.id, r.customerId, r.customerName, r.month, r.planName,
      toNum(r.amount), toNum(r.paidAmount), round2(toNum(r.amount) - toNum(r.paidAmount)),
      STATUS_LABEL[r.status] || r.status
    ]));
  downloadCsv(`subtrack-receipts_${state.from}_${state.to}.csv`, rows);
});

/* ---------- Load ---------- */
function validateRange(from, to) {
  if (!isValidMonth(from) || !isValidMonth(to)) return 'শুরু ও শেষ মাস সঠিকভাবে দিন (YYYY-MM)।';
  if (from > to) return 'শুরুর মাস শেষ মাসের পরে হতে পারবে না।';
  if (monthsBetween(from, to).length > MAX_MONTHS) return `সর্বোচ্চ ${bn(MAX_MONTHS)} মাসের তথ্য দেখা যাবে।`;
  return '';
}

async function load() {
  const from = fromInput.value;
  const to = toInput.value;
  const err = validateRange(from, to);
  rangeError.textContent = err;
  if (err) return;

  if (typeof Chart === 'undefined') {
    statusArea.replaceChildren(errorState('চার্ট লাইব্রেরি লোড হয়নি। ইন্টারনেট সংযোগ দেখে পাতা রিফ্রেশ করুন।'));
    return;
  }

  state.from = from;
  state.to = to;
  dashboard.classList.add('hidden');
  csvSummaryBtn.disabled = true;
  csvDetailBtn.disabled = true;
  statusArea.replaceChildren(loadingState('তথ্য বিশ্লেষণ হচ্ছে...'));
  setBusy(applyBtn, true, 'লোড হচ্ছে...');

  try {
    await fetchData(from, to);
    compute();

    if (!state.receipts.length && !state.expenses.length) {
      statusArea.replaceChildren(emptyState('কোনো তথ্য পাওয়া যায়নি', 'নির্বাচিত সময়ে কোনো রিসিট বা খরচ নেই।', '📊'));
      return;
    }

    statusArea.replaceChildren();
    dashboard.classList.remove('hidden');
    renderKpis();
    renderCharts();
    renderMonthlyTable();
    renderDueTable();
    csvSummaryBtn.disabled = false;
    csvDetailBtn.disabled = false;
  } catch (e) {
    console.error(e);
    statusArea.replaceChildren(errorState(firebaseErrorMessage(e), load));
    toast(firebaseErrorMessage(e), 'error');
  } finally {
    setBusy(applyBtn, false);
  }
}

/* ---------- Events & Init ---------- */
applyBtn.addEventListener('click', load);

document.querySelectorAll('[data-range]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const n = Number(btn.dataset.range);
    toInput.value = currentMonth();
    fromInput.value = shiftMonth(currentMonth(), -(n - 1));
    load();
  });
});

toInput.max = currentMonth();
toInput.value = currentMonth();
fromInput.value = shiftMonth(currentMonth(), -5);
load();