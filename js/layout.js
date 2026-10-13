import { requireAuth, bindLogoutButton } from './auth.js';
import { db } from './firebase-config.js';
import {
  collection, query, where, getCountFromServer
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { el } from './ui.js';

export const ADMIN_NAV = [
  { href: 'admin.html', icon: '📊', label: 'ড্যাশবোর্ড', key: 'dashboard' },
  { section: 'কাস্টমার' },
  { href: 'admin-approvals.html', icon: '✅', label: 'অনুমোদন', key: 'approvals', badge: true },
  { href: 'admin-customers.html', icon: '👥', label: 'সব কাস্টমার', key: 'customers' },
  { href: 'admin-plans.html', icon: '📦', label: 'প্ল্যান', key: 'plans' },
  { section: 'আর্থিক' },
  { href: 'admin-receipts.html', icon: '🧾', label: 'রিসিট', key: 'receipts' },
  { href: 'admin-expenses.html', icon: '💸', label: 'খরচ', key: 'expenses' },
  { href: 'admin-analytics.html', icon: '📈', label: 'অ্যানালিটিক্স', key: 'analytics' },
  { section: 'সিস্টেম' },
  { href: 'admin-users.html', icon: '🔐', label: 'ইউজার ম্যানেজমেন্ট', key: 'users' }
];

export async function initAdminPage({ active, title, templateId = 'pageTemplate' }) {
  const session = await requireAuth(['admin']);
  const { profile } = session;
  document.title = `${title} | SubTrack Pro`;

  const app = document.getElementById('app');
  const badgeEls = {};

  /* ----- Sidebar ----- */
  const nav = el('nav', { class: 'nav', 'aria-label': 'প্রধান মেনু' });
  ADMIN_NAV.forEach((item) => {
    if (item.section) {
      nav.append(el('div', { class: 'nav-title', text: item.section }));
      return;
    }
    const link = el('a', {
      class: `nav-item${item.key === active ? ' active' : ''}`,
      href: item.href,
      'aria-current': item.key === active ? 'page' : null
    }, [
      el('span', { class: 'nav-icon', 'aria-hidden': 'true', text: item.icon }),
      el('span', { text: item.label })
    ]);
    if (item.badge) {
      const badge = el('span', { class: 'nav-badge hidden', 'aria-label': 'অপেক্ষমান সংখ্যা' });
      badgeEls[item.key] = badge;
      link.append(badge);
    }
    nav.append(link);
  });

  const logoutBtn = el('button', { class: 'btn btn-light btn-block', type: 'button', text: 'লগআউট' });
  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' }, [
    el('div', { class: 'sidebar-brand' }, [
      el('div', { class: 'brand-logo', text: 'S' }),
      el('div', {}, [
        el('div', { class: 'brand-name', text: 'SubTrack Pro' }),
        el('div', { class: 'brand-sub', text: 'অ্যাডমিন প্যানেল' })
      ])
    ]),
    nav,
    el('div', { class: 'sidebar-footer' }, [logoutBtn])
  ]);
  const overlay = el('div', { class: 'sidebar-overlay' });

  /* ----- Topbar ----- */
  const menuBtn = el('button', { class: 'menu-toggle', type: 'button', 'aria-label': 'মেনু খুলুন', 'aria-controls': 'sidebar', 'aria-expanded': 'false', text: '☰' });
  const displayName = profile.name || profile.email || 'অ্যাডমিন';
  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'flex items-center gap-1' }, [menuBtn, el('div', { class: 'topbar-title', text: title })]),
    el('div', { class: 'user-chip' }, [
      el('div', { class: 'avatar', 'aria-hidden': 'true', text: displayName.trim().charAt(0).toUpperCase() || 'A' }),
      el('div', { class: 'user-meta' }, [
        el('div', { class: 'user-name', text: displayName }),
        el('div', { class: 'user-role', text: 'অ্যাডমিন' })
      ])
    ])
  ]);

  const content = el('main', { class: 'content', id: 'content' });
  app.replaceChildren(sidebar, overlay, el('div', { class: 'main' }, [topbar, content]));

  /* ----- Mobile sidebar ----- */
  const setSidebar = (open) => {
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('show', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
  overlay.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSidebar(false); });
  bindLogoutButton(logoutBtn);

  /* ----- Page content ----- */
  const tpl = document.getElementById(templateId);
  if (tpl) content.append(tpl.content.cloneNode(true));

  /* ----- Pending badge ----- */
  const setPendingBadge = (count) => {
    const badge = badgeEls.approvals;
    if (!badge) return;
    badge.textContent = Number(count).toLocaleString('bn-BD');
    badge.classList.toggle('hidden', !count);
  };
  const refreshPendingBadge = async () => {
    try {
      const snap = await getCountFromServer(query(collection(db, 'customers'), where('status', '==', 'pending')));
      setPendingBadge(snap.data().count);
    } catch (err) {
      console.error('Badge error:', err);
    }
  };
  refreshPendingBadge();

  document.getElementById('pageLoader')?.classList.add('hidden');
  return { session, profile, content, setPendingBadge, refreshPendingBadge };
}
