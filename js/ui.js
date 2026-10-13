import { authErrorMessage } from './auth.js';

/* ---------- DOM helpers (textContent-only, XSS-safe) ---------- */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'class') node.className = val;
    else if (key === 'text') node.textContent = val;
    else if (key === 'dataset') Object.assign(node.dataset, val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2).toLowerCase(), val);
    else if (['value', 'checked', 'disabled', 'selected'].includes(key)) node[key] = val;
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  [].concat(children).flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export const $ = (selector, root = document) => root.querySelector(selector);

/* ---------- Formatting ---------- */
export const bn = (n) => Number(n || 0).toLocaleString('bn-BD');

export function formatBDT(n) {
  return '৳' + Number(n || 0).toLocaleString('bn-BD', { maximumFractionDigits: 2 });
}

function toDateObj(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00`);
  return null;
}

export function formatDate(v) {
  const d = toDateObj(v);
  return d ? d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function formatDateTime(v) {
  const d = toDateObj(v);
  return d
    ? d.toLocaleString('bn-BD', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
}

export function normalizeDigits(str) {
  return String(str ?? '').replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
}

export function maskNid(nid) {
  if (!nid) return '—';
  return '•'.repeat(Math.max(nid.length - 3, 0)) + nid.slice(-3);
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const firebaseErrorMessage = authErrorMessage;

export function setBusy(btn, busy, busyText) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    if (busyText) btn.textContent = busyText;
  } else if (btn.dataset.label) {
    btn.textContent = btn.dataset.label;
    delete btn.dataset.label;
  }
  btn.disabled = busy;
  btn.setAttribute('aria-busy', String(busy));
}

/* ---------- Toast ---------- */
let toastBox = null;

export function toast(message, type = 'success', ms = 4000) {
  if (!toastBox) {
    toastBox = el('div', { class: 'toast-container', 'aria-live': 'polite' });
    document.body.append(toastBox);
  }
  const node = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status', text: message });
  toastBox.append(node);
  setTimeout(() => node.remove(), ms);
}

/* ---------- Modal ---------- */
const modalStack = [];
let modalId = 0;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function openModal({ title, content, footer = [], size = '', onClose } = {}) {
  const previouslyFocused = document.activeElement;
  const titleId = `modalTitle${++modalId}`;

  const closeBtn = el('button', { class: 'modal-close', type: 'button', 'aria-label': 'বন্ধ করুন', text: '×' });
  const header = el('div', { class: 'modal-header' }, [
    el('h2', { class: 'modal-title', id: titleId, text: title }),
    closeBtn
  ]);
  const body = el('div', { class: 'modal-body' }, content);
  const parts = [header, body];
  if (footer.length) parts.push(el('div', { class: 'modal-footer' }, footer));

  const modal = el('div', {
    class: `modal ${size}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1'
  }, parts);
  const backdrop = el('div', { class: 'modal-backdrop' }, [modal]);

  let closed = false;
  const api = { close, modal, body };

  function onKey(e) {
    if (modalStack[modalStack.length - 1] !== api) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const items = [...modal.querySelectorAll(FOCUSABLE)];
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    const idx = modalStack.indexOf(api);
    if (idx >= 0) modalStack.splice(idx, 1);
    backdrop.remove();
    if (!modalStack.length) document.body.style.overflow = '';
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    if (onClose) onClose();
  }

  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);

  modalStack.push(api);
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);

  const firstField = body.querySelector(FOCUSABLE);
  (firstField || modal).focus();
  return api;
}

export function confirmDialog({
  title, message, confirmText = 'নিশ্চিত করুন', cancelText = 'বাতিল', danger = false, content = null
}) {
  return new Promise((resolve) => {
    let settled = false;
    let dialog;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (dialog) dialog.close();
    };
    const cancelBtn = el('button', { class: 'btn btn-secondary', type: 'button', text: cancelText, onclick: () => finish(false) });
    const okBtn = el('button', { class: `btn ${danger ? 'btn-danger' : ''}`.trim(), type: 'button', text: confirmText, onclick: () => finish(true) });
    dialog = openModal({
      title,
      size: 'modal-sm',
      content: el('div', { class: 'stack' }, [el('p', { text: message }), content]),
      footer: [cancelBtn, okBtn],
      onClose: () => finish(false)
    });
  });
}

/* ---------- Common state blocks ---------- */
export function loadingState(text = 'লোড হচ্ছে...') {
  return el('div', { class: 'loading-state', role: 'status' }, [
    el('span', { class: 'spinner spinner-dark spinner-lg' }),
    el('span', { text })
  ]);
}

export function emptyState(title, hint = '', icon = '📭') {
  return el('div', { class: 'empty-state' }, [
    el('div', { class: 'empty-icon', 'aria-hidden': 'true', text: icon }),
    el('strong', { text: title }),
    hint ? el('span', { text: hint }) : null
  ]);
}

export function errorState(message, onRetry) {
  return el('div', { class: 'error-state', role: 'alert' }, [
    el('div', { class: 'empty-icon', 'aria-hidden': 'true', text: '⚠️' }),
    el('strong', { text: message }),
    onRetry ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: 'আবার চেষ্টা করুন', onclick: onRetry }) : null
  ]);
}
