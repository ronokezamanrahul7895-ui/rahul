import { db } from './firebase-config.js';
import {
  collection, query, where, getDocs, doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initStaffPage } from './staff-layout.js';
import { el, formatBDT, normalizeDigits, firebaseErrorMessage, setBusy, toast } from './ui.js';

const ID_RE = /^[A-Za-z0-9_-]{1,30}$/;
const MOBILE_RE = /^01[3-9][0-9]{8}$/;
const NID_RE = /^([0-9]{10}|[0-9]{13}|[0-9]{17})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const shell = await initStaffPage({ active: 'customer-new', title: 'নতুন কাস্টমার' });
const uid = shell.profile.uid;

const $id = (id) => document.getElementById(id);
const form = $id('customerForm');
const pageAlert = $id('pageAlert');
const submitBtn = $id('submitBtn');
const planSelect = $id('planId');
const planHint = $id('planHint');

const fields = {
  customerId: $id('customerId'),
  name: $id('name'),
  mobile: $id('mobile'),
  planId: planSelect,
  address: $id('address'),
  nid: $id('nid'),
  birthDate: $id('birthDate')
};

let plans = new Map();
let ownIds = new Set();

/* ---------- Helpers ---------- */
function setError(key, message) {
  const input = fields[key];
  $id(`${key}Error`).textContent = message || '';
  input.classList.toggle('is-invalid', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function showAlert(message, type = 'error') {
  pageAlert.className = `alert alert-${type} mb-2`;
  pageAlert.textContent = message;
}

function hideAlert() {
  pageAlert.className = 'alert hidden mb-2';
  pageAlert.textContent = '';
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

/* ---------- Data ---------- */
async function loadPlans() {
  const snap = await getDocs(collection(db, 'plans'));
  plans = new Map(
    snap.docs
      .filter((d) => d.data().isActive !== false)
      .map((d) => [d.id, { name: d.data().name, price: d.data().price }])
  );
  const sorted = [...plans.entries()].sort((a, b) => (Number(a[1].price) || 0) - (Number(b[1].price) || 0));

  planSelect.replaceChildren(el('option', { value: '', text: 'প্ল্যান নির্বাচন করুন' }));
  sorted.forEach(([id, p]) => {
    planSelect.append(el('option', { value: id, text: `${p.name} — ${formatBDT(p.price)} / মাস` }));
  });
}

async function loadOwnIds() {
  try {
    const snap = await getDocs(query(collection(db, 'customers'), where('createdBy', '==', uid)));
    ownIds = new Set(snap.docs.map((d) => d.id.toLowerCase()));
  } catch (err) {
    console.error(err);
  }
}

/* ---------- Validation ---------- */
function validate() {
  let ok = true;

  const id = fields.customerId.value.trim();
  if (!id) { setError('customerId', 'কাস্টমার আইডি দিন।'); ok = false; }
  else if (!ID_RE.test(id)) { setError('customerId', 'আইডিতে শুধু ইংরেজি অক্ষর, সংখ্যা, - ও _ ব্যবহার করুন (সর্বোচ্চ ৩০)।'); ok = false; }
  else if (ownIds.has(id.toLowerCase())) { setError('customerId', 'এই আইডি আগে থেকেই ব্যবহৃত হয়েছে।'); ok = false; }
  else setError('customerId', '');

  const name = fields.name.value.trim().replace(/\s+/g, ' ');
  if (!name) { setError('name', 'নাম দিন।'); ok = false; }
  else if (name.length < 2) { setError('name', 'নাম কমপক্ষে ২ অক্ষরের হতে হবে।'); ok = false; }
  else if (name.length > 100) { setError('name', 'নাম ১০০ অক্ষরের বেশি হতে পারবে না।'); ok = false; }
  else setError('name', '');

  const mobile = normalizeDigits(fields.mobile.value).replace(/\s|-/g, '');
  if (!mobile) { setError('mobile', 'মোবাইল নম্বর দিন।'); ok = false; }
  else if (!MOBILE_RE.test(mobile)) { setError('mobile', 'সঠিক মোবাইল নম্বর দিন (যেমন: 01712345678)।'); ok = false; }
  else setError('mobile', '');

  const planId = planSelect.value;
  if (!planId) { setError('planId', 'প্ল্যান নির্বাচন করুন।'); ok = false; }
  else if (!plans.has(planId)) { setError('planId', 'নির্বাচিত প্ল্যানটি বৈধ নয়।'); ok = false; }
  else setError('planId', '');

  const address = fields.address.value.trim();
  if (!address) { setError('address', 'ঠিকানা দিন।'); ok = false; }
  else if (address.length < 3) { setError('address', 'ঠিকানা কমপক্ষে ৩ অক্ষরের হতে হবে।'); ok = false; }
  else if (address.length > 300) { setError('address', 'ঠিকানা ৩০০ অক্ষরের বেশি হতে পারবে না।'); ok = false; }
  else setError('address', '');

  const nid = normalizeDigits(fields.nid.value).replace(/\s|-/g, '');
  if (nid && !NID_RE.test(nid)) { setError('nid', 'NID ১০, ১৩ বা ১৭ ডিজিটের হতে হবে।'); ok = false; }
  else setError('nid', '');

  const birth = fields.birthDate.value;
  if (birth && !isRealDate(birth)) { setError('birthDate', 'সঠিক জন্ম তারিখ দিন।'); ok = false; }
  else if (birth && (birth > todayStr() || birth < '1900-01-01')) { setError('birthDate', 'জন্ম তারিখ বৈধ সীমার মধ্যে হতে হবে।'); ok = false; }
  else setError('birthDate', '');

  return ok;
}

/* ---------- Events ---------- */
Object.keys(fields).forEach((key) => {
  const evt = key === 'planId' || key === 'birthDate' ? 'change' : 'input';
  fields[key].addEventListener(evt, () => setError(key, ''));
});

fields.mobile.addEventListener('blur', () => { fields.mobile.value = normalizeDigits(fields.mobile.value).trim(); });
fields.nid.addEventListener('blur', () => { fields.nid.value = normalizeDigits(fields.nid.value).trim(); });

planSelect.addEventListener('change', () => {
  const p = plans.get(planSelect.value);
  planHint.textContent = p ? `মাসিক মূল্য: ${formatBDT(p.price)}` : '';
});

$id('resetBtn').addEventListener('click', () => {
  Object.keys(fields).forEach((k) => setError(k, ''));
  planHint.textContent = '';
  hideAlert();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  if (!validate()) {
    form.querySelector('.is-invalid')?.focus();
    return;
  }

  const id = fields.customerId.value.trim();
  const nid = normalizeDigits(fields.nid.value).replace(/\s|-/g, '');
  const birth = fields.birthDate.value;

  const data = {
    customerId: id,
    name: fields.name.value.trim().replace(/\s+/g, ' '),
    mobile: normalizeDigits(fields.mobile.value).replace(/\s|-/g, ''),
    address: fields.address.value.trim(),
    planId: planSelect.value,
    status: 'pending',
    createdBy: uid,
    createdAt: serverTimestamp()
  };
  if (nid) data.nid = nid;
  if (birth) data.birthDate = birth;

  setBusy(submitBtn, true, 'সংরক্ষণ হচ্ছে...');
  try {
    await setDoc(doc(db, 'customers', id), data);
    ownIds.add(id.toLowerCase());
    toast(`"${data.name}" এন্ট্রি হয়েছে। অ্যাডমিনের অনুমোদনের অপেক্ষায় আছে।`);
    form.reset();
    planHint.textContent = '';
    showAlert('কাস্টমার সফলভাবে সংরক্ষিত হয়েছে। আরেকজনের তথ্য দিতে পারেন।', 'success');
    fields.customerId.focus();
  } catch (err) {
    console.error(err);
    if (err?.code === 'permission-denied') {
      setError('customerId', 'এই আইডি আগে থেকেই ব্যবহৃত হতে পারে। অন্য আইডি দিন।');
      showAlert('সংরক্ষণ করা যায়নি। আইডি ডুপ্লিকেট অথবা নির্বাচিত প্ল্যান নিষ্ক্রিয় হতে পারে।');
    } else {
      showAlert(firebaseErrorMessage(err));
    }
  } finally {
    setBusy(submitBtn, false);
  }
});

/* ---------- Init ---------- */
fields.birthDate.max = todayStr();

try {
  await Promise.all([loadPlans(), loadOwnIds()]);
  if (!plans.size) {
    showAlert('কোনো সক্রিয় প্ল্যান নেই। অ্যাডমিনকে প্ল্যান তৈরি করতে বলুন।', 'warning');
    form.querySelectorAll('input, select, textarea, button').forEach((n) => { n.disabled = true; });
  } else {
    fields.customerId.focus();
  }
} catch (err) {
  console.error(err);
  showAlert(`প্ল্যান লোড করা যায়নি। ${firebaseErrorMessage(err)}`);
  form.querySelectorAll('input, select, textarea, button').forEach((n) => { n.disabled = true; });
}