import './pwa.js';
import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ==========================================================
   Constants
   ========================================================== */
export const LOGIN_PAGE = 'index.html';
export const ROLE_HOME = { admin: 'admin.html', staff: 'staff.html' };
export const VALID_ROLES = ['admin', 'staff'];
export const IDLE_LIMIT_MS = 30 * 60 * 1000; // ৩০ মিনিট

const ACTIVITY_KEY = 'subtrack_last_activity';
const LOCK_KEY = 'subtrack_login_lock';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 1000;
const IDLE_CHECK_MS = 15 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart'];

export const REASON_MESSAGES = {
  idle: 'দীর্ঘক্ষণ নিষ্ক্রিয় থাকায় নিরাপত্তার জন্য স্বয়ংক্রিয়ভাবে লগআউট করা হয়েছে। অনুগ্রহ করে আবার লগইন করুন।',
  logout: 'আপনি সফলভাবে লগআউট করেছেন।',
  inactive: 'আপনার অ্যাকাউন্টটি নিষ্ক্রিয় করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'no-profile': 'আপনার অ্যাকাউন্টের প্রোফাইল পাওয়া যায়নি। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'invalid-role': 'আপনার অ্যাকাউন্টে বৈধ রোল নির্ধারণ করা নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  session: 'সেশন শেষ হয়েছে। অনুগ্রহ করে আবার লগইন করুন।'
};

const FIREBASE_ERRORS = {
  'auth/invalid-credential': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।',
  'auth/wrong-password': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।',
  'auth/user-not-found': 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।',
  'auth/invalid-email': 'ইমেইল ঠিকানাটি সঠিক নয়।',
  'auth/user-disabled': 'এই অ্যাকাউন্টটি নিষ্ক্রিয় করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'auth/too-many-requests': 'অনেকবার ভুল চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।',
  'auth/network-request-failed': 'ইন্টারনেট সংযোগে সমস্যা হচ্ছে। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।',
  'auth/operation-not-allowed': 'লগইন পদ্ধতি চালু করা নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।',
  'auth/requires-recent-login': 'নিরাপত্তার জন্য আবার লগইন করুন।',
  'permission-denied': 'এই কাজের অনুমতি আপনার নেই।',
  unavailable: 'সার্ভার এই মুহূর্তে পাওয়া যাচ্ছে না। কিছুক্ষণ পর চেষ্টা করুন।',
  'failed-precondition': 'অনুরোধটি সম্পন্ন করা যায়নি। আবার চেষ্টা করুন।',
  'not-found': 'প্রয়োজনীয় তথ্য পাওয়া যায়নি।',
  'already-exists': 'এই তথ্য ইতিমধ্যে বিদ্যমান।'
};

/* ==========================================================
   Errors
   ========================================================== */
export class AppAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppAuthError';
    this.code = code;
  }
}

export function authErrorMessage(err) {
  if (!err) return 'অজানা সমস্যা হয়েছে। আবার চেষ্টা করুন।';
  if (err instanceof AppAuthError) return err.message;
  const code = String(err.code || '').replace(/^firestore\//, '');
  return FIREBASE_ERRORS[code] || 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।';
}

/* ==========================================================
   Session state
   ========================================================== */
let session = null; // { user, profile }
let idleTimerId = null;
let idleStarted = false;
let lastWrite = 0;

export function getSession() {
  return session;
}

export function isAdmin() {
  return session?.profile?.role === 'admin';
}

/* ==========================================================
   Activity / Idle handling
   ========================================================== */
function readActivity() {
  const v = Number(sessionStorage.getItem(ACTIVITY_KEY));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function markActivity() {
  const now = Date.now();
  if (now - lastWrite < ACTIVITY_THROTTLE_MS) return;
  lastWrite = now;
  sessionStorage.setItem(ACTIVITY_KEY, String(now));
}

function forceMarkActivity() {
  lastWrite = Date.now();
  sessionStorage.setItem(ACTIVITY_KEY, String(lastWrite));
}

function isIdleExpired() {
  const last = readActivity();
  return last > 0 && Date.now() - last > IDLE_LIMIT_MS;
}

function startIdleWatcher() {
  if (idleStarted) return;
  idleStarted = true;
  forceMarkActivity();

  ACTIVITY_EVENTS.forEach((evt) =>
    window.addEventListener(evt, markActivity, { passive: true })
  );

  const check = () => {
    if (isIdleExpired()) logout('idle');
  };
  idleTimerId = setInterval(check, IDLE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

function stopIdleWatcher() {
  if (idleTimerId) clearInterval(idleTimerId);
  idleTimerId = null;
  idleStarted = false;
  ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActivity));
}

/* ==========================================================
   Login lockout (client-side throttle)
   ========================================================== */
function readLock() {
  try {
    return JSON.parse(sessionStorage.getItem(LOCK_KEY)) || { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

function writeLock(lock) {
  sessionStorage.setItem(LOCK_KEY, JSON.stringify(lock));
}

function assertNotLocked() {
  const lock = readLock();
  if (lock.until > Date.now()) {
    const secs = Math.ceil((lock.until - Date.now()) / 1000);
    throw new AppAuthError('locked', `অনেকবার ভুল চেষ্টা হয়েছে। ${secs} সেকেন্ড পর আবার চেষ্টা করুন।`);
  }
}

function registerFailure() {
  const lock = readLock();
  const count = lock.until > 0 && lock.until <= Date.now() ? 1 : lock.count + 1;
  writeLock({ count, until: count >= MAX_ATTEMPTS ? Date.now() + LOCK_MS : 0 });
  if (count >= MAX_ATTEMPTS) writeLock({ count: 0, until: Date.now() + LOCK_MS });
}

function clearLock() {
  sessionStorage.removeItem(LOCK_KEY);
}

/* ==========================================================
   Profile verification (role + isActive)
   ========================================================== */
async function loadProfile(user) {
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) {
    throw new AppAuthError('no-profile', REASON_MESSAGES['no-profile']);
  }
  const data = snap.data();
  if (data.isActive !== true) {
    throw new AppAuthError('inactive', REASON_MESSAGES.inactive);
  }
  if (!VALID_ROLES.includes(data.role)) {
    throw new AppAuthError('invalid-role', REASON_MESSAGES['invalid-role']);
  }
  return {
    uid: user.uid,
    email: user.email || data.email || '',
    name: data.name || user.email || '',
    role: data.role,
    isActive: true
  };
}

function waitForAuthUser() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      (user) => { unsub(); resolve(user); },
      (err) => { unsub(); reject(err); }
    );
  });
}

/* ==========================================================
   Public API
   ========================================================== */
export async function login(email, password) {
  assertNotLocked();
  try {
    await setPersistence(auth, browserSessionPersistence);
    const cred = await signInWithEmailAndPassword(auth, email, password);

    let profile;
    try {
      profile = await loadProfile(cred.user);
    } catch (err) {
      await signOut(auth);
      throw err;
    }

    clearLock();
    forceMarkActivity();
    session = { user: cred.user, profile };
    return session;
  } catch (err) {
    const code = err?.code || '';
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)) {
      registerFailure();
    }
    throw err;
  }
}

export async function logout(reason = 'logout') {
  stopIdleWatcher();
  session = null;
  try {
    await signOut(auth);
  } catch (err) {
    console.error('Logout error:', err);
  }
  sessionStorage.removeItem(ACTIVITY_KEY);
  window.location.replace(`${LOGIN_PAGE}?reason=${encodeURIComponent(reason)}`);
}

/**
 * Route guard: প্রতিটি সুরক্ষিত পেজের শুরুতে await করুন।
 * @param {string[]} allowedRoles - খালি হলে যেকোনো বৈধ রোল অনুমোদিত
 * @returns {Promise<{user: object, profile: object}>}
 */
export async function requireAuth(allowedRoles = []) {
  const never = new Promise(() => {}); // রিডাইরেক্টের পর কোড আর চলবে না

  let user;
  try {
    user = await waitForAuthUser();
  } catch (err) {
    console.error(err);
    window.location.replace(`${LOGIN_PAGE}?reason=session`);
    return never;
  }

  if (!user) {
    window.location.replace(LOGIN_PAGE);
    return never;
  }

  if (isIdleExpired()) {
    await logout('idle');
    return never;
  }

  let profile;
  try {
    profile = await loadProfile(user);
  } catch (err) {
    await logout(err instanceof AppAuthError ? err.code : 'session');
    return never;
  }

  if (allowedRoles.length && !allowedRoles.includes(profile.role)) {
    window.location.replace(ROLE_HOME[profile.role]);
    return never;
  }

  session = { user, profile };
  startIdleWatcher();

  // অন্য ট্যাবে সাইন-আউট হলে এই ট্যাবও রিডাইরেক্ট হবে
  onAuthStateChanged(auth, (u) => {
    if (!u && session) {
      session = null;
      stopIdleWatcher();
      window.location.replace(LOGIN_PAGE);
    }
  });

  return session;
}

/**
 * লগইন পেজে ব্যবহার: আগে থেকে লগইন থাকলে রোল অনুযায়ী রিডাইরেক্ট করে।
 */
export async function redirectIfAuthenticated() {
  const user = await waitForAuthUser();
  if (!user) return;

  if (isIdleExpired()) {
    await signOut(auth);
    sessionStorage.removeItem(ACTIVITY_KEY);
    return;
  }

  try {
    const profile = await loadProfile(user);
    window.location.replace(ROLE_HOME[profile.role]);
    await new Promise(() => {});
  } catch (err) {
    if (err instanceof AppAuthError || err?.code === 'permission-denied') {
      await signOut(auth);
      throw err;
    }
    throw err;
  }
}

/**
 * লগআউট বাটনে ইভেন্ট বাঁধার হেল্পার
 */
export function bindLogoutButton(button) {
  if (!button) return;
  button.addEventListener('click', () => logout('logout'));
}
