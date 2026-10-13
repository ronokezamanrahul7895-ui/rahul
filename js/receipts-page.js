import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  el, bn, formatBDT, formatDateTime, normalizeDigits, debounce,
  setBusy, toast, openModal, confirmDialog, loadingState, emptyState, errorState
} from './ui.js';
import {
  MONTHS_BN, STATUS_LABEL, METHODS, METHOD_LABEL,
  toBn, monthKey, monthLabel, round2, printUrl
} from './receipt-utils.js';
import { createReceipt, collectPayment, receiptErrorMessage } from './receipt-service.js';

const PAGE_SIZE = 20;

export async function mountReceiptsPage({ shell, role }) {
  const isAdmin = role === 'admin';
  const uid = shell.profile.uid;
  const now = new Date();

  const state = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    customers: [],
    plans: new Map(),
    receipts: [],
    status: 'all',
    search: '',
    page: 1
  };
  let loadSeq = 0;
  const currentYm = () => monthKey(state.year, state.month);

  /* ---------- Page skeleton ---------- */
  const subtitle = el('p', { class: 'page-sub' });
  const refreshBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: '↻ রিফ্রেশ' });
  const bulkBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: '⚡ মাসের সব রিসিট তৈরি' });
  const addBtn = el('button', { class: 'btn', type: 'button', text: '+ নতুন রিসিট' });

  const header = el('div', { class: 'page-header' }, [
    el('div', {}, [el('h1', { class: 'page-title', text: 'রিসিট ও পেমেন্ট' }), subtitle]),
    el('div', { class: 'flex gap-1 wrap' }, [refreshBtn, bulkBtn, addBtn])
  ]);

  const yearSel = el('select', { class: 'form-control', id: 'yearSel', 'aria-label': 'বছর' });
  for (let y = state.year - 2; y <= state.year + 1; y++) {
    yearSel.append(el('option', { value: String(y), text: toBn(y) }));
  }
  const monthSel = el('select', { class: 'form-control', id: 'monthSel', 'aria-label': 'মাস' });
  MONTHS_BN.forEach((m, i) => monthSel.append(el('option', { value: String(i + 1), text: m })));
  yearSel.value = String(state.year);
  monthSel.value = String(state.month);

  const statCard = (label, cls = '') => {
    const value = el('div', { class: 'stat-value', text: '—' });
    return { value, node: el('div', { class: `stat-card ${cls}`.trim() }, [el('div', { class: 'stat-label', text: label }), value]) };
  };
  const sCount = statCard('মোট রিসিট');
  const sBilled = statCard('মোট বিল');
  const sPaid = statCard('আদায়', 'success');
  const sDue = statCard('বকেয়া', 'danger');
  const stats = el('section', { class: 'stats-grid', 'aria-label': 'সারসংক্ষেপ' }, [sCount.node, sBilled.node, sPaid.node, sDue.node]);

  const TAB_DEFS = [['all', 'সব'], ['due', 'বকেয়া'], ['partial', 'আংশিক'], ['paid', 'পরিশোধিত']];
  const tabs = TAB_DEFS.map(([key, label]) => el('button', {
    type: 'button', role: 'tab', class: `tab${key === state.status ? ' active' : ''}`,
    'aria-selected': String(key === state.status), dataset: { status: key }, text: label
  }));
  const searchInput = el('input', {
    type: 'search', class: 'form-control search-box', autocomplete: 'off',
    placeholder: 'নাম বা আইডি দিয়ে খুঁজুন', 'aria-label': 'রিসিট খুঁজুন'
  });
  const listArea = el('div', { 'aria-live': 'polite' });
  const pagination = el('div', { class: 'pagination hidden' });

  const card = el('section', { class: 'card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'স্ট্যাটাস ফিল্টার' }, tabs),
      searchInput
    ]),
    listArea,
    pagination
  ]);

  const filterBar = el('div', { class: 'card mb-2' }, [
    el('div', { class: 'card-body flex items-center gap-2 wrap' }, [
      el('label', { class: 'form-label', for: 'monthSel', text: 'মাস:' }),
      monthSel,
      el('label', { class: 'form-label sr-only', for: 'yearSel', text: 'বছর' }),
      yearSel
    ])
  ]);

  shell.content.replaceChildren(header, filterBar, stats, card);

  /* ---------- Data ---------- */
  async function loadPlans() {
    const snap = await getDocs(collection(db, 'plans'));
    state.plans = new Map(snap.docs.map((d) => [d.id, { name: d.data().name, price: d.data().price }]));
  }

  async function loadCustomers() {
    const q = isAdmin
      ? query(collection(db, 'customers'), where('status', '==', 'approved'))
      : query(collection(db, 'customers'), where('createdBy', '==', uid), where('status', '==', 'approved'));
    const snap = await getDocs(q);
    state.customers = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'bn'));
  }

  async function loadReceipts() {
    const seq = ++loadSeq;
    subtitle.textContent = `${monthLabel(currentYm())} মাসের রিসিট`;
    listArea.replaceChildren(loadingState('রিসিট লোড হচ্ছে...'));
    pagination.classList.add('hidden');
    try {
      const filters = [where('month', '==', currentYm())];
      if (!isAdmin) filters.push(where('createdBy', '==', uid));
      const snap = await getDocs(query(collection(db, 'receipts'), ...filters));
      if (seq !== loadSeq) return;
      state.receipts = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.customerName || '').localeCompare(String(b.customerName || ''), 'bn'));
      state.page = 1;
      renderStats();
      render();
    } catch (err) {
      if (seq !== loadSeq) return;
      console.error(err);
      state.receipts = [];
      renderStats();
      listArea.replaceChildren(errorState(receiptErrorMessage(err), loadReceipts));
    }
  }

  /* ---------- Render ---------- */
  function renderStats() {
    const billed = state.receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const paid = state.receipts.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);
    sCount.value.textContent = bn(state.receipts.length);
    sBilled.value.textContent = formatBDT(billed);
    sPaid.value.textContent = formatBDT(paid);
    sDue.value.textContent = formatBDT(round2(billed - paid));
  }

  function filtered() {
    const q = normalizeDigits(state.search).trim().toLowerCase();
    return state.receipts.filter((r) => {
      if (state.status !== 'all' && r.status !== state.status) return false;
      if (!q) return true;
      return String(r.customerName || '').toLowerCase().includes(q)
        || String(r.customerId || '').toLowerCase().includes(q)
        || String(r.id).toLowerCase().includes(q);
    });
  }

  const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });

  function render() {
    const rows = filtered();
    if (!rows.length) {
      const [title, hint, icon] = state.search || state.status !== 'all'
        ? ['কোনো ফলাফল পাওয়া যায়নি', 'ফিল্টার বা সার্চ বদলে দেখুন।', '🔍']
        : [`${monthLabel(currentYm())} মাসে কোনো রিসিট নেই`, '"নতুন রিসিট" বা "মাসের সব রিসিট তৈরি" ব্যবহার করুন।', '🧾'];
      listArea.replaceChildren(emptyState(title, hint, icon));
      pagination.classList.add('hidden');
      return;
    }

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    const table = el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        th('রিসিট নং'), th('কাস্টমার'), th('প্ল্যান'), th('মোট', 'num'),
        th('জমা', 'num'), th('বকেয়া', 'num'), th('স্ট্যাটাস'), th('অ্যাকশন')
      ])]),
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

  function buildRow(r) {
    const due = round2(r.amount - r.paidAmount);
    const actions = el('div', { class: 'row-actions' });
    if (due > 0) {
      actions.append(el('button', { class: 'btn btn-success btn-sm', type: 'button', text: 'পেমেন্ট', onclick: () => openPayment(r) }));
    }
    actions.append(el('a', { class: 'btn btn-secondary btn-sm link-btn', href: printUrl(r.id), text: 'প্রিন্ট' }));

    return el('tr', {}, [
      el('td', { class: 'mono', text: r.id }),
      el('td', {}, [
        el('div', { class: 'cell-title', text: r.customerName || '—' }),
        el('div', { class: 'cell-sub mono', text: r.customerId || '' })
      ]),
      el('td', { text: r.planName || '—' }),
      el('td', { class: 'num', text: formatBDT(r.amount) }),
      el('td', { class: 'num', text: formatBDT(r.paidAmount) }),
      el('td', { class: 'num', text: formatBDT(due) }),
      el('td', {}, [el('span', { class: `badge badge-${r.status}`, text: STATUS_LABEL[r.status] || r.status })]),
      el('td', {}, [actions])
    ]);
  }

  /* ---------- Create receipt ---------- */
  function openCreate() {
    const ym = currentYm();
    const existing = new Set(state.receipts.map((r) => r.customerId));

    const search = el('input', {
      type: 'search', class: 'form-control', autocomplete: 'off',
      placeholder: 'নাম, মোবাইল বা আইডি দিয়ে খুঁজুন', 'aria-label': 'কাস্টমার খুঁজুন'
    });
    const select = el('select', { class: 'form-control select-list', id: 'custSelect', size: '7', 'aria-label': 'কাস্টমার নির্বাচন' });
    const info = el('div', { class: 'alert alert-info', text: 'তালিকা থেকে একজন কাস্টমার নির্বাচন করুন।' });
    const err = el('div', { class: 'form-error', role: 'alert' });
    const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });

    const form = el('form', { id: 'createForm', novalidate: true, class: 'stack' }, [
      formAlert,
      el('div', { class: 'alert alert-warning', text: `মাস: ${monthLabel(ym)} — মাস বদলাতে পেজের উপরের মাস নির্বাচন ব্যবহার করুন।` }),
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label required', for: 'custSelect', text: 'কাস্টমার' }),
        search, select, err
      ]),
      info
    ]);

    function updateInfo() {
      const c = state.customers.find((x) => x.id === select.value);
      if (!c) { info.textContent = 'তালিকা থেকে একজন কাস্টমার নির্বাচন করুন।'; return; }
      const plan = state.plans.get(c.planId);
      info.textContent = plan
        ? `প্ল্যান: ${plan.name} — ${formatBDT(plan.price)} | মোবাইল: ${c.mobile || '—'}`
        : 'এই কাস্টমারের প্ল্যান পাওয়া যায়নি।';
    }

    function fill() {
      const q = normalizeDigits(search.value).trim().toLowerCase();
      const prev = select.value;
      const list = state.customers.filter((c) => !q
        || String(c.name || '').toLowerCase().includes(q)
        || String(c.mobile || '').includes(q)
        || String(c.customerId || c.id).toLowerCase().includes(q));

      if (!list.length) {
        select.replaceChildren(el('option', { value: '', disabled: true, text: 'কোনো অনুমোদিত কাস্টমার পাওয়া যায়নি' }));
        select.selectedIndex = -1;
        updateInfo();
        return;
      }
      select.replaceChildren(...list.map((c) => {
        const has = existing.has(c.id);
        return el('option', {
          value: c.id, disabled: has,
          text: `${c.name} — ${c.customerId || c.id}${has ? ' (রিসিট আছে)' : ''}`
        });
      }));
      if (list.some((c) => c.id === prev && !existing.has(c.id))) select.value = prev;
      else select.selectedIndex = -1;
      updateInfo();
    }

    search.addEventListener('input', debounce(fill, 150));
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    select.addEventListener('change', () => { err.textContent = ''; updateInfo(); });
    fill();

    const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
    const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'createForm', text: 'রিসিট তৈরি করুন' });
    const dialog = openModal({ title: 'নতুন রিসিট', content: form, footer: [cancelBtn, saveBtn] });
    cancelBtn.addEventListener('click', () => dialog.close());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      formAlert.classList.add('hidden');
      const id = select.value;
      if (!id) { err.textContent = 'একজন কাস্টমার নির্বাচন করুন।'; return; }

      setBusy(saveBtn, true, 'তৈরি হচ্ছে...');
      try {
        await createReceipt(id, ym);
        toast('রিসিট তৈরি হয়েছে।');
        dialog.close();
        await loadCustomers().catch(console.error);
        await loadReceipts();
      } catch (error) {
        console.error(error);
        formAlert.textContent = receiptErrorMessage(error);
        formAlert.classList.remove('hidden');
      } finally {
        setBusy(saveBtn, false);
      }
    });
  }

  /* ---------- Bulk generate ---------- */
  async function generateAll() {
    const ym = currentYm();
    if (!state.customers.length) { toast('কোনো অনুমোদিত কাস্টমার নেই।', 'warning'); return; }
    const existing = new Set(state.receipts.map((r) => r.customerId));
    const eligible = state.customers.filter((c) => !existing.has(c.id));
    if (!eligible.length) { toast('এই মাসের সব কাস্টমারের রিসিট আগেই তৈরি করা আছে।', 'warning'); return; }

    const ok = await confirmDialog({
      title: 'মাসের সব রিসিট তৈরি',
      message: `${monthLabel(ym)} মাসের জন্য ${bn(eligible.length)} জন অনুমোদিত কাস্টমারের রিসিট তৈরি হবে। চালিয়ে যাবেন?`,
      confirmText: 'তৈরি করুন'
    });
    if (!ok) return;

    let cancelled = false;
    const counters = { done: 0, created: 0, skipped: 0, failed: 0 };
    const text = el('p', { text: `০ / ${bn(eligible.length)} সম্পন্ন` });
    const bar = el('progress', { class: 'progress', max: eligible.length, value: 0 });
    const dialog = openModal({
      title: 'রিসিট তৈরি হচ্ছে',
      size: 'modal-sm',
      content: el('div', { class: 'stack' }, [text, bar]),
      onClose: () => { cancelled = true; }
    });

    const update = () => {
      bar.value = counters.done;
      text.textContent = `${bn(counters.done)} / ${bn(eligible.length)} সম্পন্ন`;
    };

    const queue = [...eligible];
    const worker = async () => {
      while (queue.length && !cancelled) {
        const c = queue.shift();
        try {
          await createReceipt(c.id, ym);
          counters.created++;
        } catch (error) {
          if (error.code === 'exists') counters.skipped++;
          else { counters.failed++; console.error(c.id, error); }
        }
        counters.done++;
        update();
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    if (!cancelled) {
      text.textContent = `সম্পন্ন: ${bn(counters.created)}টি তৈরি, ${bn(counters.skipped)}টি আগে থেকেই ছিল, ${bn(counters.failed)}টি ব্যর্থ।`;
      bar.value = eligible.length;
    }
    toast(`${bn(counters.created)}টি রিসিট তৈরি হয়েছে।`, counters.failed ? 'warning' : 'success');
    await loadReceipts();
  }

  /* ---------- Payment ---------- */
  function openPayment(r) {
    const total = round2(r.amount);
    const due = round2(total - round2(r.paidAmount));

    const alertBox = el('div', { class: 'alert alert-error hidden', role: 'alert' });
    const amountInput = el('input', {
      class: 'form-control', id: 'payAmount', type: 'text', inputmode: 'decimal',
      autocomplete: 'off', value: String(due)
    });
    const amountErr = el('div', { class: 'form-error', role: 'alert' });
    const methodSel = el('select', { class: 'form-control', id: 'payMethod' },
      METHODS.map((m) => el('option', { value: m.value, text: m.label })));
    const noteInput = el('input', {
      class: 'form-control', id: 'payNote', type: 'text', maxlength: '100',
      placeholder: 'ট্রানজ্যাকশন আইডি / মন্তব্য (ঐচ্ছিক)', autocomplete: 'off'
    });
    const history = el('div', { class: 'text-muted', text: 'পেমেন্টের ইতিহাস লোড হচ্ছে...' });

    const row = (label, value) => [el('dt', { text: label }), el('dd', {}, [value])];
    const summary = el('dl', { class: 'detail-grid' }, [
      ...row('কাস্টমার', r.customerName || '—'),
      ...row('মাস', monthLabel(r.month)),
      ...row('মোট বিল', formatBDT(total)),
      ...row('এ পর্যন্ত জমা', formatBDT(r.paidAmount)),
      ...row('বকেয়া', el('strong', { text: formatBDT(due) }))
    ]);

    const form = el('form', { id: 'payForm', novalidate: true, class: 'stack' }, [
      alertBox,
      summary,
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label required', for: 'payAmount', text: 'গ্রহণের পরিমাণ (৳)' }),
        el('div', { class: 'amount-row' }, [
          amountInput,
          el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: 'পূর্ণ বকেয়া', onclick: () => { amountInput.value = String(due); amountErr.textContent = ''; } })
        ]),
        amountErr
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label required', for: 'payMethod', text: 'পেমেন্ট মাধ্যম' }),
        methodSel
      ]),
      el('div', { class: 'form-group' }, [
        el('label', { class: 'form-label', for: 'payNote', text: 'নোট' }),
        noteInput
      ]),
      el('div', { class: 'form-group' }, [el('div', { class: 'form-label', text: 'পূর্বের পেমেন্ট' }), history])
    ]);

    amountInput.addEventListener('input', () => {
      amountErr.textContent = '';
      amountInput.classList.remove('is-invalid');
    });

    const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
    const saveBtn = el('button', { class: 'btn btn-success', type: 'submit', form: 'payForm', text: 'পেমেন্ট গ্রহণ' });
    const dialog = openModal({ title: 'পেমেন্ট গ্রহণ', content: form, footer: [cancelBtn, saveBtn] });
    cancelBtn.addEventListener('click', () => dialog.close());

    getDocs(collection(db, 'receipts', r.id, 'payments'))
      .then((snap) => {
        const items = snap.docs.map((d) => d.data())
          .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        if (!items.length) { history.textContent = 'এখনো কোনো পেমেন্ট নেই।'; return; }
        history.replaceChildren(el('div', { class: 'mini-box table-wrap' }, [
          el('table', { class: 'mini-table' }, [
            el('thead', {}, [el('tr', {}, [th('তারিখ'), th('মাধ্যম'), th('পরিমাণ', 'num')])]),
            el('tbody', {}, items.map((p) => el('tr', {}, [
              el('td', { text: formatDateTime(p.createdAt) }),
              el('td', { text: METHOD_LABEL[p.method] || p.method || '—' }),
              el('td', { class: 'num', text: formatBDT(p.amount) })
            ])))
          ])
        ]));
      })
      .catch((error) => {
        console.error(error);
        history.textContent = 'ইতিহাস লোড করা যায়নি।';
      });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.classList.add('hidden');

      const raw = normalizeDigits(amountInput.value).replace(/,/g, '').trim();
      let msg = '';
      if (!raw) msg = 'টাকার পরিমাণ দিন।';
      else if (!/^\d{1,8}(\.\d{1,2})?$/.test(raw)) msg = 'সঠিক পরিমাণ দিন (সর্বোচ্চ ২ দশমিক ঘর)।';
      else if (Number(raw) <= 0) msg = 'পরিমাণ ০ এর চেয়ে বেশি হতে হবে।';
      else if (round2(Number(raw)) > due) msg = `বকেয়ার (${formatBDT(due)}) চেয়ে বেশি নেওয়া যাবে না।`;
      if (msg) {
        amountErr.textContent = msg;
        amountInput.classList.add('is-invalid');
        amountInput.focus();
        return;
      }

      const amount = round2(Number(raw));
      setBusy(saveBtn, true, 'সংরক্ষণ হচ্ছে...');
      try {
        const res = await collectPayment(
          r.id,
          { amount, method: methodSel.value, note: noteInput.value.trim().slice(0, 100) },
          uid
        );
        r.paidAmount = res.paidAmount;
        r.status = res.status;
        dialog.close();
        renderStats();
        render();
        showPaymentSuccess(r, amount, res.due);
      } catch (error) {
        console.error(error);
        alertBox.textContent = receiptErrorMessage(error);
        alertBox.classList.remove('hidden');
        setBusy(saveBtn, false);
      }
    });
  }

  function showPaymentSuccess(r, amount, due) {
    const closeBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বন্ধ করুন' });
    const printLink = el('a', { class: 'btn link-btn', href: printUrl(r.id, true), text: '🖨 রিসিট প্রিন্ট করুন' });
    const dialog = openModal({
      title: 'পেমেন্ট সফল',
      size: 'modal-sm',
      content: el('div', { class: 'stack' }, [
        el('div', { class: 'alert alert-success', text: `${formatBDT(amount)} গ্রহণ করা হয়েছে।` }),
        el('p', { text: due > 0 ? `বর্তমান বকেয়া: ${formatBDT(due)}` : 'রিসিটটি সম্পূর্ণ পরিশোধিত।' })
      ]),
      footer: [closeBtn, printLink]
    });
    closeBtn.addEventListener('click', () => dialog.close());
  }

  /* ---------- Events ---------- */
  const onPeriodChange = () => {
    state.year = Number(yearSel.value);
    state.month = Number(monthSel.value);
    loadReceipts();
  };
  yearSel.addEventListener('change', onPeriodChange);
  monthSel.addEventListener('change', onPeriodChange);

  tabs.forEach((tab) => tab.addEventListener('click', () => {
    state.status = tab.dataset.status;
    state.page = 1;
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    render();
  }));

  searchInput.addEventListener('input', debounce((e) => {
    state.search = e.target.value;
    state.page = 1;
    render();
  }, 200));

  addBtn.addEventListener('click', openCreate);
  bulkBtn.addEventListener('click', async () => {
    setBusy(bulkBtn, true);
    try { await generateAll(); } finally { setBusy(bulkBtn, false); }
  });
  refreshBtn.addEventListener('click', async () => {
    setBusy(refreshBtn, true, 'রিফ্রেশ হচ্ছে...');
    try {
      await Promise.all([loadCustomers().catch(console.error), loadPlans().catch(console.error), loadReceipts()]);
    } finally {
      setBusy(refreshBtn, false);
    }
  });

  /* ---------- Init ---------- */
  const [plansResult, customersResult] = await Promise.allSettled([loadPlans(), loadCustomers()]);
  if (plansResult.status === 'rejected' || customersResult.status === 'rejected') {
    console.error(plansResult.reason, customersResult.reason);
    toast('প্ল্যান বা কাস্টমারের তালিকা লোড করা যায়নি। রিফ্রেশ করুন।', 'warning');
  }
  loadReceipts();
}
