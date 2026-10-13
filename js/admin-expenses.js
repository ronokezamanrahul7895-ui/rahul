import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, formatDate, normalizeDigits, debounce, firebaseErrorMessage,
  setBusy, toast, openModal, confirmDialog, loadingState, emptyState, errorState
} from './ui.js';
import { round2, currentMonth, isValidMonth, monthLabel } from './receipt-utils.js';

const PAGE_SIZE = 15;
const CATEGORIES = ['বেতন', 'ভাড়া', 'বিদ্যুৎ ও ইউটিলিটি', 'ইন্টারনেট ও সংযোগ', 'যন্ত্রপাতি ও মেরামত', 'মার্কেটিং', 'পরিবহন', 'অন্যান্য'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/*
  expenses ডকুমেন্ট: { title, category, amount, date: 'YYYY-MM-DD', note?, createdBy, createdAt, updatedAt }
  (analytics পেজ এই কাঠামোই পড়ে)
*/

const state = { month: currentMonth(), category: '', search: '', page: 1, items: [] };

const shell = await initAdminPage({ active: 'expenses', title: 'খরচ' });
const adminUid = shell.profile.uid;

const $id = (id) => document.getElementById(id);
const listArea = $id('listArea');
const pagination = $id('pagination');
const monthFilter = $id('monthFilter');
const categoryFilter = $id('categoryFilter');

monthFilter.value = state.month;

categoryFilter.append(el('option', { value: '', text: 'সব খাত' }));
CATEGORIES.forEach((c) => categoryFilter.append(el('option', { value: c, text: c })));

const toNum = (v) => Number(v) || 0;
const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

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

/* ---------- Data ---------- */
async function loadList() {
  listArea.replaceChildren(loadingState('খরচের তালিকা লোড হচ্ছে...'));
  pagination.classList.add('hidden');
  try {
    const snap = isValidMonth(state.month)
      ? await getDocs(query(
        collection(db, 'expenses'),
        where('date', '>=', `${state.month}-01`),
        where('date', '<=', `${state.month}-31`)
      ))
      : await getDocs(collection(db, 'expenses'));
    state.items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) ||
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
    state.page = 1;
    render();
  } catch (err) {
    console.error(err);
    listArea.replaceChildren(errorState(firebaseErrorMessage(err), loadList));
  }
}

/* ---------- Render ---------- */
function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.items.filter((e) => {
    if (state.category && e.category !== state.category) return false;
    if (!q) return true;
    return String(e.title || '').toLowerCase().includes(q) || String(e.note || '').toLowerCase().includes(q);
  });
}

function renderStats(rows) {
  const total = round2(rows.reduce((s, e) => s + toNum(e.amount), 0));
  $id('statTotal').textContent = formatBDT(total);
  $id('statPeriod').textContent = isValidMonth(state.month) ? monthLabel(state.month) : 'সব মাস';
  $id('statCount').textContent = bn(rows.length);

  const byCat = new Map();
  rows.forEach((e) => byCat.set(e.category || 'অন্যান্য', (byCat.get(e.category || 'অন্যান্য') || 0) + toNum(e.amount)));
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
  $id('statTop').textContent = top ? top[0] : '—';
  $id('statTopNote').textContent = top ? formatBDT(round2(top[1])) : '';
}

function render() {
  const rows = filtered();
  renderStats(rows);

  if (!rows.length) {
    const searching = state.search || state.category;
    listArea.replaceChildren(searching
      ? emptyState('কোনো ফলাফল পাওয়া যায়নি', 'ফিল্টার বা সার্চ পরিবর্তন করে দেখুন।', '🔍')
      : emptyState('কোনো খরচ নেই', '"নতুন খরচ" বাটনে ক্লিক করে খরচ যোগ করুন।', '💸'));
    pagination.classList.add('hidden');
    return;
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [th('তারিখ'), th('শিরোনাম'), th('খাত'), th('পরিমাণ', 'num'), th('অ্যাকশন')])]),
    el('tbody', {}, pageRows.map(buildRow))
  ]);
  listArea.replaceChildren(el('div', { class: 'table-wrap' }, [table]));

  const end = start + pageRows.length;
  const prev = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: '← আগের', disabled: state.page <= 1, onclick: () => { state.page--; render(); } });
  const next = el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'পরের →', disabled: state.page >= pages, onclick: () => { state.page++; render(); } });
  pagination.replaceChildren(
    el('span', { text: `দেখানো হচ্ছে ${bn(start + 1)}–${bn(end)} / মোট ${bn(rows.length)}টি` }),
    el('div', { class: 'flex items-center gap-1' }, [prev, el('span', { text: `${bn(state.page)} / ${bn(pages)}` }), next])
  );
  pagination.classList.remove('hidden');
}

function buildRow(e) {
  return el('tr', {}, [
    el('td', { text: formatDate(e.date) }),
    el('td', {}, [
      el('div', { class: 'cell-title', text: e.title || '—' }),
      e.note ? el('div', { class: 'cell-sub cell-clip', text: e.note, title: e.note }) : null
    ]),
    el('td', {}, [el('span', { class: 'badge badge-role', text: e.category || 'অন্যান্য' })]),
    el('td', { class: 'num', text: formatBDT(e.amount) }),
    el('td', {}, [el('div', { class: 'row-actions' }, [
      el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'এডিট', onclick: () => openForm(e) }),
      el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'ডিলিট', onclick: () => removeExpense(e) })
    ])])
  ]);
}

/* ---------- Form ---------- */
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

function openForm(expense = null) {
  const isEdit = Boolean(expense);

  const titleF = field({
    id: 'exTitle', label: 'শিরোনাম', required: true,
    input: el('input', { class: 'form-control', id: 'exTitle', type: 'text', maxlength: '100', autocomplete: 'off', placeholder: 'যেমন: অফিস ভাড়া', value: expense?.title ?? '' })
  });

  const catSelect = el('select', { class: 'form-control', id: 'exCategory' }, [el('option', { value: '', text: 'খাত নির্বাচন করুন' })]);
  const cats = expense?.category && !CATEGORIES.includes(expense.category) ? [...CATEGORIES, expense.category] : CATEGORIES;
  cats.forEach((c) => catSelect.append(el('option', { value: c, text: c })));
  catSelect.value = expense?.category ?? '';
  const catF = field({ id: 'exCategory', label: 'খাত', required: true, input: catSelect });

  const amountF = field({
    id: 'exAmount', label: 'পরিমাণ (৳)', required: true,
    input: el('input', { class: 'form-control', id: 'exAmount', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '০', value: expense ? String(expense.amount) : '' })
  });
  const dateF = field({
    id: 'exDate', label: 'তারিখ', required: true,
    input: el('input', { class: 'form-control', id: 'exDate', type: 'date', max: todayStr(), value: expense?.date ?? todayStr() })
  });

  const noteInput = el('textarea', { class: 'form-control', id: 'exNote', maxlength: '200', rows: '2', placeholder: 'মন্তব্য (ঐচ্ছিক)' });
  noteInput.value = expense?.note ?? '';
  const noteF = field({ id: 'exNote', label: 'নোট', input: noteInput });

  const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const form = el('form', { id: 'expenseForm', novalidate: true, class: 'stack' }, [
    formAlert, titleF.group, catF.group, amountF.group, dateF.group, noteF.group
  ]);

  [titleF, amountF].forEach((f) => f.input.addEventListener('input', () => setError(f, '')));
  catSelect.addEventListener('change', () => setError(catF, ''));
  dateF.input.addEventListener('change', () => setError(dateF, ''));

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
  const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'expenseForm', text: isEdit ? 'আপডেট করুন' : 'সংরক্ষণ করুন' });
  const dialog = openModal({ title: isEdit ? 'খরচ এডিট' : 'নতুন খরচ', content: form, footer: [cancelBtn, saveBtn] });
  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    formAlert.classList.add('hidden');
    let ok = true;

    const title = titleF.input.value.trim().replace(/\s+/g, ' ');
    if (!title) { setError(titleF, 'শিরোনাম দিন।'); ok = false; }
    else if (title.length < 2) { setError(titleF, 'শিরোনাম কমপক্ষে ২ অক্ষরের হতে হবে।'); ok = false; }
    else setError(titleF, '');

    const category = catSelect.value;
    if (!category) { setError(catF, 'খাত নির্বাচন করুন।'); ok = false; }
    else setError(catF, '');

    const raw = normalizeDigits(amountF.input.value).replace(/,/g, '').trim();
    if (!raw) { setError(amountF, 'পরিমাণ দিন।'); ok = false; }
    else if (!/^\d{1,9}(\.\d{1,2})?$/.test(raw)) { setError(amountF, 'সঠিক সংখ্যা দিন (সর্বোচ্চ ২ দশমিক ঘর)।'); ok = false; }
    else if (Number(raw) <= 0) { setError(amountF, 'পরিমাণ ০ এর চেয়ে বেশি হতে হবে।'); ok = false; }
    else setError(amountF, '');

    const date = dateF.input.value;
    if (!date) { setError(dateF, 'তারিখ দিন।'); ok = false; }
    else if (!isRealDate(date)) { setError(dateF, 'সঠিক তারিখ দিন।'); ok = false; }
    else if (date > todayStr()) { setError(dateF, 'ভবিষ্যতের তারিখ দেওয়া যাবে না।'); ok = false; }
    else setError(dateF, '');

    if (!ok) return;

    const data = {
      title, category, amount: round2(Number(raw)), date,
      note: noteInput.value.trim().slice(0, 200)
    };

    setBusy(saveBtn, true, 'সংরক্ষণ হচ্ছে...');
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'expenses', expense.id), { ...data, updatedAt: serverTimestamp() });
        toast('খরচ আপডেট হয়েছে।');
      } else {
        await addDoc(collection(db, 'expenses'), {
          ...data, createdBy: adminUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        toast('নতুন খরচ যোগ হয়েছে।');
      }
      dialog.close();
      const m = date.slice(0, 7);
      if (isValidMonth(state.month) && state.month !== m) {
        state.month = m;
        monthFilter.value = m;
      }
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
async function removeExpense(e) {
  const ok = await confirmDialog({
    title: 'খরচ ডিলিট',
    message: `"${e.title}" (${formatBDT(e.amount)}) ডিলিট করবেন? এটি লাভ-ক্ষতির হিসাবে প্রভাব ফেলবে।`,
    confirmText: 'ডিলিট করুন',
    danger: true
  });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, 'expenses', e.id));
    toast('খরচ ডিলিট হয়েছে।');
    await loadList();
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
  }
}

/* ---------- Events & Init ---------- */
$id('addExpenseBtn').addEventListener('click', () => openForm());

monthFilter.addEventListener('change', () => {
  const v = monthFilter.value;
  if (v && !isValidMonth(v)) {
    toast('সঠিক মাস দিন (YYYY-MM)।', 'warning');
    return;
  }
  state.month = v;
  loadList();
});

$id('allMonthsBtn').addEventListener('click', () => {
  state.month = '';
  monthFilter.value = '';
  loadList();
});

categoryFilter.addEventListener('change', () => {
  state.category = categoryFilter.value;
  state.page = 1;
  render();
});

$id('searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  state.page = 1;
  render();
}, 200));

loadList();