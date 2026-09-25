import { icon } from './icons.js';
import { t } from './i18n.js';

/**
 * Minimal hyperscript helper. Text children become text nodes (never parsed as HTML).
 *   h('button.btn.primary', { onclick, type: 'submit' }, 'Save')
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

// ---------------------------------------------------------------- Toasts

export function toast(message, type = 'info', ms = 3200) {
  const host = document.getElementById('toasts');
  const ico = { success: 'checkCircle', error: 'alert', info: 'info' }[type] || 'info';
  const el = h(`div.toast.toast-${type}`, { role: type === 'error' ? 'alert' : 'status' }, icon(ico, 18), h('span', message));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}

// ---------------------------------------------------------------- Modal dialogs (native <dialog>)

/**
 * Opens a modal. `build(close)` returns the dialog content. Resolves with the value passed to close().
 */
export function openModal(build, { className = '', dismissible = true } = {}) {
  return new Promise((resolve) => {
    const dlg = h(`dialog.modal${className ? `.${className}` : ''}`);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (dlg.open) dlg.close();
      dlg.remove();
      resolve(value);
    };
    const close = (value) => {
      if (settled || dlg.classList.contains('closing')) return;
      dlg.classList.add('closing');
      setTimeout(() => finish(value), 160); // let the exit animation play
    };
    dlg.addEventListener('close', () => finish(undefined));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      if (dismissible) close(undefined);
    });
    dlg.addEventListener('click', (e) => {
      if (dismissible && e.target === dlg) close(undefined);
    });
    dlg.append(build(close));
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function modalHeader(title, close, subtitle) {
  return h('header.modal-head',
    h('div', h('h2', title), subtitle ? h('p.muted', subtitle) : null),
    h('button.btn.icon.ghost', { type: 'button', 'aria-label': t('common.close'), onclick: () => close(undefined) }, icon('x', 20)));
}

export function confirmDialog({ title, message, confirmText = t('common.confirm'), danger = false, iconName = 'alert' }) {
  return openModal((close) => h('div.modal-body.confirm',
    h(`div.confirm-icon${danger ? '.danger' : ''}`, icon(iconName, 24)),
    h('h2', title),
    message ? h('p.muted', message) : null,
    h('div.modal-actions',
      h('button.btn.subtle', { type: 'button', onclick: () => close(false) }, t('common.cancel')),
      h(`button.btn.${danger ? 'danger' : 'primary'}`, { type: 'button', onclick: () => close(true), autofocus: true }, confirmText))), { className: 'sm' });
}

/** Busy state for async buttons. */
export async function withBusy(btn, fn) {
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

export function field({ label, input, control = input, error, hint, required }) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const err = h('div.field-error', { id: `${id}-err`, role: 'alert' }, error || '');
  input.setAttribute('aria-describedby', `${id}-err`);
  const wrap = h('div.field',
    h('label', { for: id }, label, required ? h('span.req', { 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('div.field-hint', hint) : null,
    err);
  wrap.setError = (msg) => {
    err.textContent = msg || '';
    wrap.classList.toggle('invalid', !!msg);
    input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  return wrap;
}

export function emptyState(iconName, title, body) {
  return h('div.empty', h('div.empty-icon', icon(iconName, 28)), h('h3', title), body ? h('p.muted', body) : null);
}

export function spinner() {
  return h('span.spinner', { 'aria-hidden': 'true' });
}
