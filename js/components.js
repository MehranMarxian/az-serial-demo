import { MONTHS_AR, MONTHS_EN, MONTHS_FA, jalaliDateOf, jalaliTimeOf, parseJalali } from './jalali.js';
import { LANGUAGES, getLang, localDigits, num, setLang, t } from './i18n.js';
import { h, initials } from './ui.js';
import { icon } from './icons.js';

// ---------------------------------------------------------------- formatting

export const tz = { value: 'Asia/Tehran' };

export const fmtDate = (jalali) => localDigits(jalali || '');

export function fmtDateLong(jalali) {
  const p = parseJalali(jalali);
  if (!p) return '';
  const months = { en: MONTHS_EN, fa: MONTHS_FA, ar: MONTHS_AR }[getLang()];
  return localDigits(`${p.jd} ${months[p.jm - 1]} ${p.jy}`);
}

export function fmtInstant(iso) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  return { date: fmtDate(jalaliDateOf(d, tz.value)), time: localDigits(jalaliTimeOf(d, tz.value)) };
}

export const SOURCE_ICON = { manual: 'keyboard', barcode: 'barcode', ocr: 'text' };

export function sourceBadge(source) {
  return h('span.src-badge', { title: t(`src.${source}`) }, icon(SOURCE_ICON[source] || 'keyboard', 13), h('span', t(`src.${source}`)));
}

export function avatar(name, size = 32) {
  const hue = [...(name || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return h('span.avatar', { style: { width: `${size}px`, height: `${size}px`, '--hue': hue, fontSize: `${Math.round(size * 0.38)}px` } }, initials(name));
}

export function userCell(user) {
  return h('div.user-cell', avatar(user.fullName, 28), h('div',
    h('div.user-name', user.fullName, user.removed ? h('span.badge.status.removed', t('users.status.removed')) : null),
    h('div.user-handle', { dir: 'ltr' }, `@${user.username}`)));
}

// ---------------------------------------------------------------- language menu

export function languageMenu(onChange, { compact = false } = {}) {
  const current = LANGUAGES.find((l) => l.code === getLang());
  const menu = h('div.menu', { role: 'menu', hidden: true },
    LANGUAGES.map((l) => h(`button.menu-item${l.code === current.code ? '.active' : ''}`, {
      type: 'button', role: 'menuitemradio', 'aria-checked': String(l.code === current.code), lang: l.code,
      onclick: () => { close(); if (l.code !== getLang()) { setLang(l.code); onChange(); } },
    }, h('span.menu-lang-code', l.short), h('span', l.label), l.code === current.code ? icon('check', 16) : null)));
  const btn = h('button.btn.ghost.lang-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': t('nav.lang'), title: t('nav.lang') },
    icon('globe', 18), h(compact ? 'span.lang-short' : 'span', compact ? current.short : current.label), icon('chevronDown', 14));
  const wrap = h('div.menu-wrap', btn, menu);
  const { close } = menuToggle(wrap, btn, menu);
  return wrap;
}

/** Wires a button to show/hide a dropdown, closing it on outside click or Escape. */
export function menuToggle(wrap, btn, menu) {
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
  function open() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey);
  }
  function close() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey);
  }
  btn.addEventListener('click', () => (menu.hidden ? open() : close()));
  return { open, close };
}

// ---------------------------------------------------------------- theme

const THEME_KEY = 'azs.theme';
function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  document.querySelectorAll('.theme-btn').forEach((b) => b.replaceChildren(icon(next === 'dark' ? 'sun' : 'moon', 18)));
}
export function themeButton() {
  return h('button.btn.icon.ghost.theme-btn', { type: 'button', 'aria-label': t('nav.theme'), title: t('nav.theme'), onclick: toggleTheme },
    icon(effectiveTheme() === 'dark' ? 'sun' : 'moon', 18));
}

// ---------------------------------------------------------------- data table (cards on mobile)

/**
 * columns: [{ key, label, render(item), sortKey?, className? }]
 */
export function dataTable({ columns, items, sort, onSort, onRowClick, rowClass }) {
  const head = h('thead', h('tr', columns.map((c) => {
    if (!c.sortKey || !onSort) return h('th', { class: c.className }, c.label);
    const active = sort?.key === c.sortKey;
    return h('th', { class: c.className, 'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      h(`button.th-sort${active ? '.active' : ''}`, {
        type: 'button',
        onclick: () => onSort({ key: c.sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' }),
      }, c.label, icon(active ? (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'arrowUpDown', 13)));
  })));
  const body = h('tbody', items.map((item, i) => h('tr', {
    class: [onRowClick ? 'clickable' : '', rowClass?.(item) || ''].join(' '),
    onclick: onRowClick ? (e) => { if (!e.target.closest('button, a')) onRowClick(item); } : null,
  }, columns.map((c) => h('td', { class: c.className, 'data-label': c.label }, c.render(item, i))))));
  return h('div.table-wrap', h('table.data-table', head, body));
}

export function pager({ page, pageSize, total, onPage, onPageSize, sizes = [10, 25, 50, 100] }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return h('div.pager',
    h('span.muted', t('common.results', { n: num(total) })),
    h('div.pager-ctrl',
      onPageSize ? h('select.input.sm', { 'aria-label': t('common.perPage', { n: '' }), onchange: (e) => onPageSize(+e.target.value) },
        sizes.map((s) => h('option', { value: s, selected: s === pageSize }, t('common.perPage', { n: num(s) })))) : null,
      h('button.btn.icon.subtle.sm', { type: 'button', disabled: page <= 1, 'aria-label': t('common.prev'), onclick: () => onPage(page - 1) }, icon('chevronLeft', 18)),
      h('span.pager-label', t('common.page', { p: num(page), total: num(pages) })),
      h('button.btn.icon.subtle.sm', { type: 'button', disabled: page >= pages, 'aria-label': t('common.next'), onclick: () => onPage(page + 1) }, icon('chevronRight', 18))));
}

export function skeletonRows(n = 5) {
  return h('div.skeleton-list', Array.from({ length: n }, () => h('div.skeleton')));
}

// ---------------------------------------------------------------- footer

export const APP_VERSION = '0.1.1';

export function siteFooter() {
  return h('footer.site-footer', { dir: 'ltr' }, `v${APP_VERSION} Developed by Mehran Ahmadi © 2026`);
}
