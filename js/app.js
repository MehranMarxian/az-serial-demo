import { get, isDemo, post } from './api.js';
import { applyLang, t } from './i18n.js';
import { h, clear, toast } from './ui.js';
import { icon, logo } from './icons.js';
import { avatar, languageMenu, menuToggle, siteFooter, themeButton, tz } from './components.js';
import * as authView from './views/auth.js';
import * as registerView from './views/register.js';
import * as historyView from './views/history.js';
import * as adminView from './views/admin.js';
import * as myActivityView from './views/my-activity.js';

const state = { user: null, today: null, pendingUsers: 0 };
const root = document.getElementById('app');
let cleanup = null;

// ---------------------------------------------------------------- routing

function route() {
  const [path, query = ''] = (location.hash.slice(1) || '/').split('?');
  return { path, params: new URLSearchParams(query) };
}

export function navigate(path) {
  if (location.hash === `#${path}`) render();
  else location.hash = path;
}

const ctx = {
  state,
  navigate,
  rerender: () => render(),
  async signedIn() {
    await loadMe();
    navigate(state.user.role === 'admin' ? '/admin/overview' : '/register');
  },
  setPending(n) {
    state.pendingUsers = n;
    document.querySelectorAll('.pending-dot').forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n); });
  },
};

async function loadMe() {
  try {
    const me = await get('/auth/me');
    state.user = me.user || null;
    state.today = me.today;
    tz.value = me.timeZone;
  } catch {
    state.user = null;
  }
}

function render() {
  cleanup?.();
  cleanup = null;
  const { path, params } = route();
  applyLang();
  document.title = t('app.name');

  if (!state.user) {
    const mode = path === '/signup' ? 'signup' : 'login';
    if (path !== `/${mode}`) history.replaceState(null, '', `#/${mode}`);
    clear(root, demoBanner(), authView.mount(mode, ctx));
    return;
  }

  // Two panels: the Admin Panel (full control) and the User Panel (a person's own work only).
  const isAdmin = state.user.role === 'admin';
  const allowed = isAdmin ? ADMIN_ROUTES : USER_ROUTES;
  const target = allowed.includes(path) ? path : allowed[0];
  if (target !== path) history.replaceState(null, '', `#${target}${params.size ? `?${params}` : ''}`);

  const main = h('main.main', { id: 'main' });
  clear(root, demoBanner(), shell(target), main, siteFooter());
  const view = target === '/register' ? registerView : target === '/history' ? historyView : target === '/activity' ? myActivityView : adminView;
  cleanup = view.mount(main, { ...ctx, path: target, params }) || null;
  if (cleanup instanceof Promise) cleanup.then((fn) => { cleanup = fn || null; });
  window.scrollTo({ top: 0 });
}

const USER_ROUTES = ['/register', '/history', '/activity'];
const ADMIN_ROUTES = ['/admin/overview', '/register', '/admin/users', '/admin/serials', '/admin/activity'];

function shell(active) {
  const isAdmin = state.user.role === 'admin';
  const links = isAdmin
    ? [
      { path: '/admin/overview', label: t('adm.tab.overview'), icon: 'activity' },
      { path: '/register', label: t('nav.register'), icon: 'table' },
      { path: '/admin/users', label: t('adm.tab.users'), icon: 'users', badge: true },
      { path: '/admin/serials', label: t('adm.tab.serials'), icon: 'barcode' },
      { path: '/admin/activity', label: t('adm.tab.activity'), icon: 'clock' },
    ]
    : [
      { path: '/register', label: t('nav.register'), icon: 'table' },
      { path: '/history', label: t('nav.history'), icon: 'list' },
      { path: '/activity', label: t('nav.myActivity'), icon: 'clock' },
    ];
  const isActive = (l) => active === l.path;
  const navLink = (l, cls) => h(`a.${cls}${isActive(l) ? '.active' : ''}`, { href: `#${l.path}`, 'aria-current': isActive(l) ? 'page' : null },
    icon(l.icon, 18), h('span', l.label),
    l.badge ? h('span.pending-dot', { hidden: !state.pendingUsers }, String(state.pendingUsers)) : null);

  const userMenu = h('div.menu', { role: 'menu', hidden: true },
    h('div.menu-head', avatar(state.user.fullName, 36),
      h('div', h('strong', state.user.fullName), h('div.muted.small', { dir: 'ltr' }, `@${state.user.username}`),
        h('span.badge.role', t(`users.role.${state.user.role}`)))),
    h('button.menu-item.danger', { type: 'button', onclick: logout }, icon('logout', 16), h('span', t('nav.logout'))));
  const userBtn = h('button.user-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': state.user.fullName }, avatar(state.user.fullName, 32));
  const userWrap = h('div.menu-wrap', userBtn, userMenu);
  menuToggle(userWrap, userBtn, userMenu);

  return [
    h(`header.topbar${isAdmin ? '.manager' : ''}`,
      h('div.topbar-inner',
        h('a.brand', { href: '#/' }, logo(34), h('span.brand-text', h('strong', 'AZ SERIAL'),
          isAdmin
            ? h('small.console-tag', icon('shieldCheck', 12), t('app.adminPanel'))
            : h('small.console-tag.user-tag', icon('user', 12), t('app.userPanel')))),
        h('nav.topnav', { 'aria-label': 'Main' }, links.map((l) => navLink(l, 'topnav-link'))),
        h('div.top-actions', languageMenu(render, { compact: true }), themeButton(), userWrap))),
    h('nav.bottomnav', { 'aria-label': 'Main' }, links.map((l) => navLink(l, 'bottomnav-link'))),
  ];
}

function demoBanner() {
  if (!isDemo()) return null;
  return h('div.demo-banner', { role: 'note' },
    icon('info', 15), h('span', t('demo.banner')),
    h('button.demo-reset', {
      type: 'button',
      onclick: async () => {
        const { resetDemo } = await import('./demo-api.js');
        resetDemo();
        registerView.reset();
        state.user = null;
        location.hash = '#/login';
        location.reload();
      },
    }, t('demo.reset')));
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  registerView.reset();
  navigate('/login');
}

// ---------------------------------------------------------------- boot

window.addEventListener('hashchange', render);
window.addEventListener('azs:unauthorized', () => {
  if (!state.user) return;
  state.user = null;
  toast(t('err.SESSION_EXPIRED'), 'error');
  navigate('/login');
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

applyLang();
await loadMe();
render();
if (state.user?.role === 'admin') get('/admin/stats').then((s) => ctx.setPending(s.pendingUsers)).catch(() => {});
