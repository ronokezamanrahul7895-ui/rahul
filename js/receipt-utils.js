export const MONTHS_BN = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
  'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
];

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const RECEIPT_ID_RE = /^[A-Za-z0-9_-]{1,30}_\d{4}-(0[1-9]|1[0-2])$/;

export const STATUS_LABEL = { due: 'বকেয়া', partial: 'আংশিক', paid: 'পরিশোধিত' };

export const METHODS = [
  { value: 'cash', label: 'নগদ টাকা (ক্যাশ)' },
  { value: 'bkash', label: 'বিকাশ' },
  { value: 'nagad', label: 'নগদ (Nagad)' },
  { value: 'rocket', label: 'রকেট' },
  { value: 'bank', label: 'ব্যাংক' }
];
export const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label]));

export const toBn = (v) => String(v ?? '').replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export function monthLabel(ym) {
  if (!MONTH_RE.test(ym || '')) return ym || '—';
  const [y, m] = ym.split('-');
  return `${MONTHS_BN[Number(m) - 1]} ${toBn(y)}`;
}

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function calcStatus(paid, amount) {
  const p = round2(paid);
  const a = round2(amount);
  if (p <= 0) return 'due';
  if (p >= a) return 'paid';
  return 'partial';
}

export const receiptId = (customerId, ym) => `${customerId}_${ym}`;

export const printUrl = (id, auto = false) =>
  `receipt-print.html?id=${encodeURIComponent(id)}${auto ? '&auto=1' : ''}`;
