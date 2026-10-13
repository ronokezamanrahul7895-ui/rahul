import { requireAuth } from './auth.js';
import { db } from './firebase-config.js';
import {
  doc, getDoc, getDocs, collection
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  el, formatBDT, formatDate, formatDateTime, loadingState, emptyState, errorState, firebaseErrorMessage
} from './ui.js';
import {
  RECEIPT_ID_RE, STATUS_LABEL, METHOD_LABEL, monthLabel, round2, toBn
} from './receipt-utils.js';

const { profile } = await requireAuth([]);

const area = document.getElementById('receiptArea');
const printBtn = document.getElementById('printBtn');
const params = new URLSearchParams(window.location.search);
const id = params.get('id') || '';

document.getElementById('backLink').href = profile.role === 'admin' ? 'admin-receipts.html' : 'staff-receipts.html';
printBtn.addEventListener('click', () => window.print());
document.getElementById('pageLoader').classList.add('hidden');

const th = (text, cls = '') => el('th', { class: cls, scope: 'col', text });
const infoRow = (label, value) => [el('dt', { text: label }), el('dd', { text: value || '—' })];

function buildReceipt(r, payments, customer, company) {
  const total = round2(r.amount);
  const paid = round2(r.paidAmount);
  const due = round2(total - paid);

  const companyName = company?.name || 'SubTrack Pro';
  const companySub = [company?.address, company?.phone].filter(Boolean).join(' | ');

  const parts = [
    el('div', { class: 'receipt-head' }, [
      el('div', {}, [
        el('div', { class: 'receipt-company', text: companyName }),
        companySub ? el('div', { class: 'receipt-company-sub', text: companySub }) : null
      ]),
      el('div', { class: 'receipt-meta' }, [
        el('div', { class: 'receipt-title', text: 'মানি রিসিট' }),
        el('div', { class: 'mono', text: `রিসিট নং: ${r.id}` }),
        el('div', { class: 'cell-sub', text: `তারিখ: ${formatDate(r.createdAt)}` }),
        el('div', { class: 'mt-1' }, [el('span', { class: `badge badge-${r.status}`, text: STATUS_LABEL[r.status] || r.status })])
      ])
    ]),

    el('section', { class: 'receipt-section' }, [
      el('h3', { text: 'কাস্টমারের তথ্য' }),
      el('dl', { class: 'receipt-info' }, [
        ...infoRow('কাস্টমার আইডি', r.customerId),
        ...infoRow('নাম', customer?.name || r.customerName),
        ...infoRow('মোবাইল', customer?.mobile),
        ...infoRow('ঠিকানা', customer?.address)
      ])
    ]),

    el('section', { class: 'receipt-section' }, [
      el('h3', { text: 'বিলের বিবরণ' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'receipt-table' }, [
          el('thead', {}, [el('tr', {}, [th('বিবরণ'), th('মাস'), th('পরিমাণ', 'num')])]),
          el('tbody', {}, [el('tr', {}, [
            el('td', { text: `${r.planName || '—'} — মাসিক সাবক্রিপশন` }),
            el('td', { text: monthLabel(r.month) }),
            el('td', { class: 'num', text: formatBDT(total) })
          ])])
        ])
      ])
    ])
  ];

  if (payments.length) {
    parts.push(el('section', { class: 'receipt-section' }, [
      el('h3', { text: 'পেমেন্টের বিবরণ' }),
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'receipt-table' }, [
          el('thead', {}, [el('tr', {}, [th('#'), th('তারিখ'), th('মাধ্যম'), th('নোট'), th('পরিমাণ', 'num')])]),
          el('tbody', {}, payments.map((p, i) => el('tr', {}, [
            el('td', { text: toBn(i + 1) }),
            el('td', { text: formatDateTime(p.createdAt) }),
            el('td', { text: METHOD_LABEL[p.method] || p.method || '—' }),
            el('td', { text: p.note || '—' }),
            el('td', { class: 'num', text: formatBDT(p.amount) })
          ])))
        ])
      ])
    ]));
  }

  parts.push(el('div', { class: 'receipt-summary' }, [
    el('div', { class: 'receipt-row' }, [el('span', { text: 'মোট বিল' }), el('span', { text: formatBDT(total) })]),
    el('div', { class: 'receipt-row' }, [el('span', { text: 'মোট জমা' }), el('span', { text: formatBDT(paid) })]),
    el('div', { class: 'receipt-row receipt-total' }, [el('span', { text: 'বকেয়া' }), el('span', { text: formatBDT(due) })])
  ]));

  parts.push(el('div', { class: 'receipt-sign' }, [
    el('div', { text: 'গ্রাহকের স্বাক্ষর' }),
    el('div', { text: 'কর্তৃপক্ষের স্বাক্ষর' })
  ]));

  parts.push(el('div', { class: 'receipt-foot', text: `প্রিন্টের সময়: ${formatDateTime(new Date())} — এটি কম্পিউটার-জেনারেটেড রিসিট।` }));

  if (r.status === 'paid') parts.unshift(el('div', { class: 'receipt-stamp', text: 'পরিশোধিত' }));

  return el('article', { class: 'receipt' }, parts);
}

async function load() {
  if (!RECEIPT_ID_RE.test(id)) {
    area.replaceChildren(emptyState('অবৈধ রিসিট লিংক', 'রিসিট তালিকা থেকে আবার চেষ্টা করুন।', '⚠️'));
    return;
  }

  area.replaceChildren(loadingState('রিসিট লোড হচ্ছে...'));
  try {
    const rSnap = await getDoc(doc(db, 'receipts', id));
    if (!rSnap.exists()) {
      area.replaceChildren(emptyState('রিসিট পাওয়া যায়নি', 'রিসিটটি মুছে ফেলা হয়েছে বা আপনার এটি দেখার অনুমতি নেই।', '🧾'));
      return;
    }
    const r = { id: rSnap.id, ...rSnap.data() };

    const [pRes, cRes, sRes] = await Promise.allSettled([
      getDocs(collection(db, 'receipts', id, 'payments')),
      getDoc(doc(db, 'customers', r.customerId)),
      getDoc(doc(db, 'settings', 'company'))
    ]);

    const payments = pRes.status === 'fulfilled'
      ? pRes.value.docs.map((d) => d.data())
        .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
      : [];
    const customer = cRes.status === 'fulfilled' && cRes.value.exists() ? cRes.value.data() : null;
    const company = sRes.status === 'fulfilled' && sRes.value.exists() ? sRes.value.data() : null;

    document.title = `রিসিট-${r.id}`;
    area.replaceChildren(buildReceipt(r, payments, customer, company));
    printBtn.disabled = false;

    if (params.get('auto') === '1') setTimeout(() => window.print(), 500);
  } catch (err) {
    console.error(err);
    area.replaceChildren(errorState(firebaseErrorMessage(err), load));
  }
}

load();
