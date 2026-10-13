import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, getCountFromServer,
  addDoc, updateDoc, deleteDoc, doc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initAdminPage } from './layout.js';
import {
  el, bn, formatBDT, normalizeDigits, debounce, firebaseErrorMessage,
  setBusy, toast, openModal, confirmDialog, loadingState, emptyState, errorState
} from './ui.js';

const state = { plans: [], counts: new Map(), search: '' };

const shell = await initAdminPage({ active: 'plans', title: 'প্ল্যান ম্যানেজমেন্ট' });
const adminUid = shell.profile.uid;

const listArea = document.getElementById('listArea');
const statTotal = document.getElementById('statTotal');
const statActive = document.getElementById('statActive');
const statCustomers = document.getElementById('statCustomers');

/* ---------- Data ---------- */
async function countBy(collectionName, planId) {
  const snap = await getCountFromServer(
    query(collection(db, collectionName), where('planId', '==', planId))
  );
  return snap.data().count;
}

async function loadPlans() {
  listArea.replaceChildren(loadingState('প্ল্যান লোড হচ্ছে...'));
  try {
    const snap = await getDocs(collection(db, 'plans'));
    state.plans = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));

    const results = await Promise.allSettled(state.plans.map((p) => countBy('customers', p.id)));
    state.counts = new Map(
      state.plans.map((p, i) => [p.id, results[i].status === 'fulfilled' ? results[i].value : null])
    );
    renderStats();
    render();
  } catch (err) {
    console.error(err);
    listArea.replaceChildren(errorState(firebaseErrorMessage(err), loadPlans));
  }
}

function renderStats() {
  statTotal.textContent = bn(state.plans.length);
  statActive.textContent = bn(state.plans.filter((p) => p.isActive !== false).length);
  const total = [...state.counts.values()].reduce((sum, n) => sum + (n || 0), 0);
  statCustomers.textContent = bn(total);
}

/* ---------- Render ---------- */
function th(text, cls = '') {
  return el('th', { class: cls, scope: 'col', text });
}

function render() {
  if (!state.plans.length) {
    listArea.replaceChildren(emptyState('এখনো কোনো প্ল্যান তৈরি করা হয়নি', '"নতুন প্ল্যান" বাটনে ক্লিক করে প্রথম প্ল্যান যোগ করুন।', '📦'));
    return;
  }
  const q = state.search.trim().toLowerCase();
  const rows = q ? state.plans.filter((p) => String(p.name || '').toLowerCase().includes(q)) : state.plans;
  if (!rows.length) {
    listArea.replaceChildren(emptyState('কোনো ফলাফল পাওয়া যায়নি', 'অন্য নাম দিয়ে খুঁজে দেখুন।', '🔍'));
    return;
  }

  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      th('প্ল্যান'), th('বিবরণ'), th('মাসিক মূল্য', 'num'), th('কাস্টমার', 'num'), th('স্ট্যাটাস'), th('অ্যাকশন')
    ])]),
    el('tbody', {}, rows.map(buildRow))
  ]);
  listArea.replaceChildren(el('div', { class: 'table-wrap' }, [table]));
}

function buildRow(p) {
  const active = p.isActive !== false;
  const count = state.counts.get(p.id);

  const actions = el('div', { class: 'row-actions' }, [
    el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'এডিট', onclick: () => openPlanForm(p) }),
    el('button', {
      class: 'btn btn-secondary btn-sm', type: 'button', text: active ? 'নিষ্ক্রিয়' : 'সক্রিয়',
      onclick: (e) => toggleActive(p, e.currentTarget)
    }),
    el('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'ডিলিট', onclick: (e) => removePlan(p, e.currentTarget) })
  ]);

  return el('tr', {}, [
    el('td', {}, [el('div', { class: 'cell-title', text: p.name || '—' })]),
    el('td', {}, [el('div', { class: 'cell-clip', text: p.description || '—', title: p.description || '' })]),
    el('td', { class: 'num', text: formatBDT(p.price) }),
    el('td', { class: 'num', text: count === null || count === undefined ? '—' : bn(count) }),
    el('td', {}, [el('span', { class: `badge ${active ? 'badge-active' : 'badge-inactive'}`, text: active ? 'সক্রিয়' : 'নিষ্ক্রিয়' })]),
    el('td', {}, [actions])
  ]);
}

/* ---------- Form modal ---------- */
function field({ id, label, input, required = false, hint = '' }) {
  const error = el('div', { class: 'form-error', id: `${id}Error`, role: 'alert' });
  const group = el('div', { class: 'form-group' }, [
    el('label', { class: `form-label${required ? ' required' : ''}`, for: id, text: label }),
    input,
    hint ? el('div', { class: 'form-hint', text: hint }) : null,
    error
  ]);
  return { group, error, input };
}

function setError(f, message) {
  f.error.textContent = message || '';
  f.input.classList.toggle('is-invalid', Boolean(message));
  f.input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function openPlanForm(plan = null) {
  const isEdit = Boolean(plan);

  const name = field({
    id: 'planName', label: 'প্ল্যানের নাম', required: true,
    input: el('input', { class: 'form-control', id: 'planName', type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'যেমন: বেসিক ১০ এমবিপিএস', value: plan?.name ?? '' })
  });
  const price = field({
    id: 'planPrice', label: 'মাসিক মূল্য (৳)', required: true, hint: 'শুধু সংখ্যা লিখুন, যেমন: ৫০০',
    input: el('input', { class: 'form-control', id: 'planPrice', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '০', value: plan?.price !== undefined ? String(plan.price) : '' })
  });
  const desc = field({
    id: 'planDesc', label: 'বিবরণ', hint: 'সর্বোচ্চ ২০০ অক্ষর (ঐচ্ছিক)',
    input: el('textarea', { class: 'form-control', id: 'planDesc', maxlength: '200', rows: '3', placeholder: 'প্ল্যান সম্পর্কে সংক্ষিপ্ত বিবরণ' })
  });
  desc.input.value = plan?.description ?? '';

  const activeInput = el('input', { type: 'checkbox', id: 'planActive', checked: plan ? plan.isActive !== false : true });
  const activeRow = el('label', { class: 'check-row', for: 'planActive' }, [activeInput, el('span', { text: 'সক্রিয় (নতুন কাস্টমারের জন্য নির্বাচনযোগ্য)' })]);

  const formAlert = el('div', { class: 'alert alert-error hidden', role: 'alert' });
  const priceNote = isEdit
    ? el('div', { class: 'alert alert-info', text: 'দাম পরিবর্তন শুধু নতুন রিসিটে প্রযোজ্য হবে। আগের রিসিটের দাম অপরিবর্তিত থাকবে।' })
    : null;

  const form = el('form', { id: 'planForm', novalidate: true, class: 'stack' }, [
    formAlert, priceNote, name.group, price.group, desc.group, activeRow
  ]);

  const normalizedName = () => name.input.value.trim().replace(/\s+/g, ' ');
  const parsedPrice = () => normalizeDigits(price.input.value).replace(/,/g, '').trim();

  function validate() {
    let ok = true;

    const n = normalizedName();
    const dup = state.plans.some((p) => p.id !== plan?.id && String(p.name || '').trim().toLowerCase() === n.toLowerCase());
    if (!n) { setError(name, 'প্ল্যানের নাম দিন।'); ok = false; }
    else if (n.length < 2) { setError(name, 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); ok = false; }
    else if (dup) { setError(name, 'এই নামে একটি প্ল্যান আগে থেকেই আছে।'); ok = false; }
    else setError(name, '');

    const raw = parsedPrice();
    if (!raw) { setError(price, 'মাসিক মূল্য দিন।'); ok = false; }
    else if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) { setError(price, 'সঠিক সংখ্যা দিন (সর্বোচ্চ ২ দশমিক ঘর)।'); ok = false; }
    else if (Number(raw) <= 0) { setError(price, 'মূল্য ০ এর চেয়ে বেশি হতে হবে।'); ok = false; }
    else setError(price, '');

    if (desc.input.value.length > 200) { setError(desc, 'বিবরণ ২০০ অক্ষরের বেশি হতে পারবে না।'); ok = false; }
    else setError(desc, '');

    return ok;
  }

  name.input.addEventListener('input', () => setError(name, ''));
  price.input.addEventListener('input', () => setError(price, ''));

  const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: 'বাতিল' });
  const saveBtn = el('button', { class: 'btn', type: 'submit', form: 'planForm', text: isEdit ? 'আপডেট করুন' : 'সংরক্ষণ করুন' });
  const dialog = openModal({
    title: isEdit ? 'প্ল্যান এডিট' : 'নতুন প্ল্যান',
    content: form,
    footer: [cancelBtn, saveBtn]
  });
  cancelBtn.addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formAlert.classList.add('hidden');
    if (!validate()) return;

    const data = {
      name: normalizedName(),
      price: Number(parsedPrice()),
      description: desc.input.value.trim(),
      isActive: activeInput.checked
    };

    setBusy(saveBtn, true, 'সংরক্ষণ হচ্ছে...');
    try {
      if (isEdit) {
        await updateDoc(doc(db, 'plans', plan.id), { ...data, updatedAt: serverTimestamp() });
        toast('প্ল্যান আপডেট হয়েছে।');
      } else {
        await addDoc(collection(db, 'plans'), {
          ...data, createdBy: adminUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        toast('নতুন প্ল্যান যোগ হয়েছে।');
      }
      dialog.close();
      await loadPlans();
    } catch (err) {
      console.error(err);
      formAlert.textContent = firebaseErrorMessage(err);
      formAlert.classList.remove('hidden');
    } finally {
      setBusy(saveBtn, false);
    }
  });
}

/* ---------- Row actions ---------- */
async function toggleActive(p, btn) {
  const active = p.isActive !== false;
  if (active) {
    const ok = await confirmDialog({
      title: 'প্ল্যান নিষ্ক্রিয় করুন',
      message: `"${p.name}" নিষ্ক্রিয় করলে নতুন কাস্টমারের জন্য এই প্ল্যান নির্বাচন করা যাবে না। বিদ্যমান কাস্টমার অপরিবর্তিত থাকবে।`,
      confirmText: 'নিষ্ক্রিয় করুন'
    });
    if (!ok) return;
  }
  setBusy(btn, true, '...');
  try {
    await updateDoc(doc(db, 'plans', p.id), { isActive: !active, updatedAt: serverTimestamp() });
    toast(active ? 'প্ল্যান নিষ্ক্রিয় করা হয়েছে।' : 'প্ল্যান সক্রিয় করা হয়েছে।');
    await loadPlans();
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
    setBusy(btn, false);
  }
}

async function removePlan(p, btn) {
  setBusy(btn, true, '...');
  let customers = 0;
  let receipts = 0;
  try {
    [customers, receipts] = await Promise.all([countBy('customers', p.id), countBy('receipts', p.id)]);
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
    setBusy(btn, false);
    return;
  }
  setBusy(btn, false);

  if (customers > 0 || receipts > 0) {
    toast(`এই প্ল্যানে ${bn(customers)} জন কাস্টমার ও ${bn(receipts)}টি রিসিট আছে, তাই ডিলিট করা যাবে না। বদলে নিষ্ক্রিয় করুন।`, 'error', 6000);
    return;
  }

  const ok = await confirmDialog({
    title: 'প্ল্যান ডিলিট',
    message: `"${p.name}" স্থায়ীভাবে ডিলিট করবেন? এটি আর ফেরানো যাবে না।`,
    confirmText: 'ডিলিট করুন',
    danger: true
  });
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'plans', p.id));
    toast('প্ল্যান ডিলিট হয়েছে।');
    await loadPlans();
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err), 'error');
  }
}

/* ---------- Events & Init ---------- */
document.getElementById('addPlanBtn').addEventListener('click', () => openPlanForm());
document.getElementById('searchInput').addEventListener('input', debounce((e) => {
  state.search = e.target.value;
  render();
}, 200));

loadPlans();
