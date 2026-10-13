import { requireAuth, bindLogoutButton } from './auth.js';
import { el } from './ui.js';

export const STAFF_NAV = [
  { href: 'staff.html', icon: '📊', label: 'ড্যাশবোর্ড', key: 'dashboard' },
  { section: 'কাস্টমার' },
  { href: 'staff-customers.html', icon: '👥', label: 'আমার কাস্টমার', key: 'customers' },
  { section: 'বিলিং' },
  { href: 'staff-receipts.html', icon: '🧾', label: 'রিসিট ও পেমেন্ট', key: 'receipts' }
];

export async function initStaffPage({ active, title, templateId = 'pageTemplate' }) {
  const session = await requireAuth(['staff']);
  const { profile } = session;
  document.title = `${title} | SubTrack Pro`;

  const app = document.getElementById('app');

  const nav = el('nav', { class: 'nav', 'aria-label': 'প্রধান মেনু' });
  STAFF_NAV.forEach((item) => {
    if (item.section) {
      nav.append(el('div', { class: 'nav-title', text: item.section }));
      return;
    }
    nav.append(el('a', {
      class: `nav-item${item.key === active ? ' active' : ''}`,
      href: item.href,
      'aria-current': item.key === active ? 'page' : null
    }, [
      el('span', { class: 'nav-icon', 'aria-hidden': 'true', text: item.icon }),
      el('span', { text: item.label })
    ]));
  });

  const logoutBtn = el('button', { class: 'btn btn-light btn-block', type: 'button', text: 'লগআউট' });
  const sidebar = el('aside', { class: 'sidebar', id: 'sidebar' }, [
    el('div', { class: 'sidebar-brand' }, [
      el('div', { class: 'brand-logo', text: 'S' }),
      el('div', {}, [
        el('div', { class: 'brand-name', text: 'SubTrack Pro' }),
        el('div', { class: 'brand-sub', text: 'স্টাফ প্যানেল' })
      ])
    ]),
    nav,
    el('div', { class: 'sidebar-footer' }, [logoutBtn])
  ]);
  const overlay = el('div', { class: 'sidebar-overlay' });

  const menuBtn = el('button', {
    class: 'menu-toggle', type: 'button', 'aria-label': 'মেনু খুলুন',
    'aria-controls': 'sidebar', 'aria-expanded': 'false', text: '☰'
  });
  const displayName = profile.name || profile.email || 'স্টাফ';
  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'flex items-center gap-1' }, [menuBtn, el('div', { class: 'topbar-title', text: title })]),
    el('div', { class: 'user-chip' }, [
      el('div', { class: 'avatar', 'aria-hidden': 'true', text: displayName.trim().charAt(0).toUpperCase() || 'S' }),
      el('div', { class: 'user-meta' }, [
        el('div', { class: 'user-name', text: displayName }),
        el('div', { class: 'user-role', text: 'স্টাফ' })
      ])
    ])
  ]);

  const content = el('main', { class: 'content', id: 'content' });
  app.replaceChildren(sidebar, overlay, el('div', { class: 'main' }, [topbar, content]));

  const setSidebar = (open) => {
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('show', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
  overlay.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSidebar(false); });
  bindLogoutButton(logoutBtn);

  const tpl = document.getElementById(templateId);
  if (tpl) content.append(tpl.content.cloneNode(true));

  document.getElementById('pageLoader')?.classList.add('hidden');
  return { session, profile, content };
}
