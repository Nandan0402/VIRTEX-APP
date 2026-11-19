/**
 * adminSidebarNav.js - Virtex Admin navigation (flat, no sub-menus)
 * - One link per admin page, in a single list. Thin spacing separates related links (people, money,
 *   training, messages, gym) — nothing expands or collapses.
 * - Tabs inside a page (e.g. Add Member / Attendance on Members, Expenses / Payouts on Billing,
 *   Trainers / Groups on Messages) are opened from that page.
 * - The current page is highlighted; on admin.html the Dashboard / Plans / Reports tabs switch in place.
 * - Closes the sidebar on mobile after a click.
 */

export const ADMIN_NAVIGATION_ITEMS = [
  { label: 'Dashboard', href: 'admin.html#tab-overview', tab: 'tab-overview', icon: '🏠' },

  { label: 'Members', href: 'admin-members.html', icon: '👥', gap: true },
  { label: 'Member Menu', href: 'admin-member-menu.html', icon: '🧩' },
  { label: 'Logins & Access', href: 'admin-logins.html', icon: '🔐' },
  { label: 'Trainers', href: 'admin-personaltraniner.html', icon: '🏋️' },
  { label: 'Assign Trainer', href: 'admin-assign-membertopersonal-trainer.html', icon: '🤝' },
  { label: 'Training Times', href: 'admin-training-times.html', icon: '⏰' },
  { label: 'Birthdays', href: 'admin-birthdayalert.html', icon: '🎂' },

  { label: 'Fees Alert', href: 'admin-feessalert.html', icon: '💳', gap: true },
  { label: 'Fees & Plans', href: 'admin.html#tab-plans', tab: 'tab-plans', icon: '🏷️' },
  { label: 'Billing & Expenses', href: 'admin-finance-billing.html', icon: '🧾' },
  { label: 'Reports', href: 'admin.html#tab-analytics', tab: 'tab-analytics', icon: '📈' },

  { label: 'Classes', href: 'admin-calander.html', icon: '📅', gap: true },
  { label: 'Workouts', href: 'admin-workout-management.html', icon: '📝' },
  { label: 'Diet Guide', href: 'admin-diet-nutrition.html', icon: '🥗' },
  { label: 'Client Progress', href: 'admin-client-performance.html', icon: '🏃' },
  { label: 'Events', href: 'admin-events-competitions.html', icon: '🏆' },

  { label: 'Messages', href: 'admin-messages.html', icon: '💬', gap: true },
  { label: 'Announcements', href: 'admin-notification.html', icon: '📢' },

  { label: 'Working Hours', href: 'admin-working-hours.html', icon: '🕒', gap: true },
  { label: 'Rush Hours', href: 'admin-rush-hours.html', icon: '🔥' },
  { label: 'Staff Routine', href: 'admin-routine-tracker.html', icon: '⏱️' },

  { label: 'My Profile', href: 'admin-profile.html', icon: '👤', gap: true },
];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

class AdminSidebarNav {
  getCurrentContext() {
    const fullPath = window.location.pathname;
    let fileName = fullPath.substring(fullPath.lastIndexOf('/') + 1) || 'admin.html';
    if (!fileName.endsWith('.html')) fileName += '.html';
    const hash = window.location.hash ? window.location.hash.toLowerCase() : '';
    return { fileName: fileName.toLowerCase(), hash };
  }

  /** Index of the link for the page being shown (exact tab/section first, then the page itself). */
  activeIndex() {
    const { fileName, hash } = this.getCurrentContext();
    const file = (i) => i.href.toLowerCase().split('#')[0];
    if (fileName === 'admin.html') {
      const tab = hash.replace('#', '') || 'tab-overview';
      const exact = ADMIN_NAVIGATION_ITEMS.findIndex((i) => i.tab && i.tab.toLowerCase() === tab);
      return exact >= 0 ? exact : 0; // other dashboard tabs belong to Dashboard
    }
    const exact = ADMIN_NAVIGATION_ITEMS.findIndex((i) => hash && i.href.toLowerCase() === `${fileName}${hash}`);
    if (exact >= 0) return exact;
    return ADMIN_NAVIGATION_ITEMS.findIndex((i) => file(i) === fileName);
  }

  init() {
    const nav = document.querySelector('#admin-sidebar .sidebar-nav');
    if (!nav) return;
    this.render(nav);
    this.bindEvents(nav);
  }

  render(nav) {
    const onDashboard = this.getCurrentContext().fileName === 'admin.html';
    const active = this.activeIndex();
    nav.innerHTML = ADMIN_NAVIGATION_ITEMS.map((item, i) => {
      const on = i === active;
      const tabAttr = onDashboard && item.tab ? `data-tab="${esc(item.tab)}"` : '';
      return `<a href="${esc(item.href)}" class="nav-flat-item${on ? ' active' : ''}${item.gap ? ' nav-gap' : ''}" ${tabAttr} ${on ? 'aria-current="page"' : ''}>
          <span class="nav-icon" aria-hidden="true">${item.icon}</span><span class="nav-flat-label">${esc(item.label)}</span>
        </a>`;
    }).join('');
  }

  bindEvents(nav) {
    nav.addEventListener('click', (e) => {
      const link = e.target.closest('a.nav-flat-item');
      if (!link) return;
      const tab = link.dataset.tab;
      if (tab && window.adminApp && typeof window.adminApp.switchTab === 'function') {
        e.preventDefault();
        window.adminApp.switchTab(tab, true);
        nav.querySelectorAll('.nav-flat-item.active').forEach((a) => { a.classList.remove('active'); a.removeAttribute('aria-current'); });
        link.classList.add('active'); link.setAttribute('aria-current', 'page');
      }
      if (window.innerWidth <= 768) document.getElementById('admin-sidebar')?.classList.remove('open');
    });
    // Keep the highlight right when the dashboard tab or a page section changes.
    window.addEventListener('hashchange', () => this.render(nav));
  }
}

export const adminSidebarNav = new AdminSidebarNav();

/**
 * All portals share one browser session. If a member signed in on this browser (Member Portal),
 * admin pages would just fail with "access denied" — go to the admin sign-in instead and say why.
 */
function guardWrongRole() {
  try {
    const role = String(JSON.parse(localStorage.getItem('virtex_admin_user_profile') || 'null')?.role || '').toLowerCase();
    if (role !== 'member') return false;
    const here = location.pathname + location.search + location.hash;
    location.replace(`/admin-auth.html?${new URLSearchParams({ next: here, wrongRole: role })}`);
    return true;
  } catch { return false; }
}

if (typeof document !== 'undefined' && !guardWrongRole()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => adminSidebarNav.init());
  } else {
    adminSidebarNav.init();
  }
}
