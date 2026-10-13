import { db } from './firebase-config.js';
import {
  doc, collection, runTransaction, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { receiptId, round2, calcStatus, MONTH_RE } from './receipt-utils.js';
import { firebaseErrorMessage } from './ui.js';

export class ReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReceiptError';
    this.code = code;
  }
}

export const receiptErrorMessage = (err) =>
  err instanceof ReceiptError ? err.message : firebaseErrorMessage(err);

const money = (n) => '৳' + Number(n).toLocaleString('bn-BD', { maximumFractionDigits: 2 });

/**
 * মাসিক রিসিট তৈরি (ID = customerId_YYYY-MM)। ডুপ্লিকেট হলে ReceiptError('exists')।
 * প্ল্যানের নাম ও দাম রিসিটে কপি হয়।
 */
export async function createReceipt(customerId, ym) {
  if (!MONTH_RE.test(ym)) throw new ReceiptError('bad-month', 'মাসের ফরম্যাট সঠিক নয়।');

  const rRef = doc(db, 'receipts', receiptId(customerId, ym));
  const cRef = doc(db, 'customers', customerId);

  return runTransaction(db, async (tx) => {
    const rSnap = await tx.get(rRef);
    if (rSnap.exists()) {
      throw new ReceiptError('exists', 'এই মাসের রিসিট আগেই তৈরি করা হয়েছে।');
    }

    const cSnap = await tx.get(cRef);
    if (!cSnap.exists()) throw new ReceiptError('no-customer', 'কাস্টমার পাওয়া যায়নি।');
    const c = cSnap.data();
    if (c.status !== 'approved') {
      throw new ReceiptError('not-approved', 'শুধু অনুমোদিত কাস্টমারের রিসিট তৈরি করা যায়।');
    }

    const pSnap = await tx.get(doc(db, 'plans', c.planId));
    if (!pSnap.exists()) throw new ReceiptError('no-plan', 'কাস্টমারের প্ল্যান পাওয়া যায়নি।');
    const plan = pSnap.data();
    const amount = Number(plan.price);
    if (!(amount > 0)) throw new ReceiptError('bad-price', 'প্ল্যানের মূল্য সঠিক নয়।');

    const data = {
      customerId,
      customerName: c.name,
      month: ym,
      planId: c.planId,
      planName: plan.name,
      amount,
      paidAmount: 0,
      status: 'due',
      createdBy: c.createdBy,
      createdAt: serverTimestamp()
    };
    tx.set(rRef, data);
    return { id: rRef.id, ...data };
  });
}

/**
 * পেমেন্ট গ্রহণ: payments সাবকালেকশনে এন্ট্রি + রিসিটের paidAmount/status আপডেট (একই ট্রানজ্যাকশনে)।
 */
export async function collectPayment(id, { amount, method, note }, uid) {
  const rRef = doc(db, 'receipts', id);
  const pRef = doc(collection(rRef, 'payments'));
  const pay = round2(amount);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(rRef);
    if (!snap.exists()) throw new ReceiptError('no-receipt', 'রিসিট পাওয়া যায়নি।');
    const r = snap.data();

    const total = round2(r.amount);
    const paid = round2(r.paidAmount);
    const due = round2(total - paid);

    if (due <= 0) throw new ReceiptError('paid', 'এই রিসিটের সম্পূর্ণ টাকা আগেই পরিশোধ হয়েছে।');
    if (!(pay > 0)) throw new ReceiptError('bad-amount', 'পরিমাণ ০ এর চেয়ে বেশি হতে হবে।');
    if (pay > due) {
      throw new ReceiptError('overpay', `বর্তমান বকেয়া ${money(due)}। এর চেয়ে বেশি নেওয়া যাবে না।`);
    }

    const newPaid = round2(paid + pay);
    const status = calcStatus(newPaid, total);

    tx.set(pRef, { amount: pay, method, note, createdBy: uid, createdAt: serverTimestamp() });
    tx.update(rRef, { paidAmount: newPaid, status, updatedAt: serverTimestamp() });
    return { paidAmount: newPaid, status, due: round2(total - newPaid) };
  });
}
