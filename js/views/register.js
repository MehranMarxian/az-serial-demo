import { get, post, qs } from '../api.js';
import { errorText, num, t } from '../i18n.js';
import { h, toast, spinner } from '../ui.js';
import { icon } from '../icons.js';
import { fmtDate, fmtDateLong, fmtInstant, skeletonRows } from '../components.js';
import { openScanner } from '../scanner.js';

const FIELDS = ['productModel', 'salesPanel', 'orderCode', 'productCode', 'serialNumber'];
const REQUIRED = new Set(['productModel', 'serialNumber']);
const CARRY = ['productModel', 'salesPanel', 'orderCode', 'productCode'];
const PAGE_ROWS = 5;
const VISIBLE_SAVED = 5;
const AUTOFILL_KEY = 'azs.autofill';

// Sheet state lives at module level so a language/theme re-render never loses typed input.
let sheet = null;
let keySeq = 0;

export function reset() { sheet = null; }

const blankRow = () => ({
  key: ++keySeq, id: null, saved: false, saving: false, jalaliDate: null, createdAt: null,
  data: Object.fromEntries(FIELDS.map((f) => [f, ''])), source: 'manual', scanned: null, errors: {}, touched: false,
});

const savedRow = (item) => ({
  ...blankRow(), id: item.id, saved: true, jalaliDate: item.jalaliDate, createdAt: item.createdAt, source: item.source,
  data: Object.fromEntries(FIELDS.map((f) => [f, item[f]])),
});

const isEmpty = (row) => FIELDS.every((f) => !row.data[f].trim());
const savedCount = () => sheet.rows.filter((r) => r.saved).length;

function padRows() {
  const target = Math.max(PAGE_ROWS, Math.ceil((savedCount() + 1) / PAGE_ROWS) * PAGE_ROWS);
  while (sheet.rows.length < target) sheet.rows.push(blankRow());
}

function loadAutofill() {
  try { return localStorage.getItem(AUTOFILL_KEY) !== '0'; } catch { return true; }
}

export async function mount(main, ctx) {
  const { state } = ctx;
  main.append(h('div.page', skeletonRows(6)));

  if (!sheet || sheet.userId !== state.user.id || sheet.date !== state.today) {
    try {
      const res = await get('/serials/mine');
      sheet = { userId: state.user.id, date: res.date, rows: res.items.map(savedRow), autofill: loadAutofill(), showEarlier: false };
      state.today = res.date;
    } catch (err) {
      main.replaceChildren(h('div.page', h('div.alert.alert-error', icon('alert', 18), h('span', errorText(err.code)))));
      return null;
    }
    padRows();
  }

  const refs = new Map(); // row.key -> { el, inputs, errors, status, num }
  const sheetBody = h('div.sheet-body');
  const countPill = h('span.pill.pill-success');
  const earlierBtn = h('button.btn.ghost.sm.show-earlier', { type: 'button', onclick: () => { sheet.showEarlier = true; renderRows(); } });

  // Datalists feed autocomplete for model / sales panel with the most-used values.
  const dlModel = h('datalist', { id: 'dl-productModel' });
  const dlPanel = h('datalist', { id: 'dl-salesPanel' });
  get('/serials/suggestions').then((s) => {
    dlModel.replaceChildren(...s.productModel.map((v) => h('option', { value: v })));
    dlPanel.replaceChildren(...s.salesPanel.map((v) => h('option', { value: v })));
  }).catch(() => {});

  const autofill = h('input', {
    type: 'checkbox', checked: sheet.autofill,
    onchange: (e) => {
      sheet.autofill = e.target.checked;
      try { localStorage.setItem(AUTOFILL_KEY, sheet.autofill ? '1' : '0'); } catch { /* ignore */ }
    },
  });

  const page = h('div.page.register',
    h('section.page-head',
      h('div',
        h('h1', t('reg.title')),
        h('p.muted', t('reg.subtitle'))),
      h('div.head-pills',
        h('span.pill', icon('calendar', 15), h('span', fmtDateLong(sheet.date))),
        countPill)),
    h('section.card.sheet',
      h('div.sheet-toolbar',
        h('label.switch', autofill, h('span.switch-track', h('span.switch-thumb')), h('span', t('reg.autofill'))),
        h('button.btn.ghost.sm', { type: 'button', onclick: () => addRows(true) }, icon('plus', 16), t('reg.addRows'))),
      h('div.sheet-grid', { role: 'table', 'aria-label': t('reg.title') },
        h('div.sheet-row.sheet-head', { role: 'row' },
          h('div.c-num', { role: 'columnheader' }, t('f.row')),
          h('div.c-date', { role: 'columnheader' }, t('f.date')),
          ...FIELDS.map((f) => h(`div.c-${f}`, { role: 'columnheader' }, t(`f.${f}`), REQUIRED.has(f) ? h('span.req', ' *') : null)),
          h('div.c-act', { role: 'columnheader' }, h('span.sr-only', t('reg.save')))),
        earlierBtn,
        sheetBody)),
    h('p.tip', icon('info', 15), h('span', t('reg.tip'))),
    dlModel, dlPanel);

  main.replaceChildren(page);
  renderRows();
  updateCount();
  focusFirstOpen();

  function updateCount() {
    countPill.replaceChildren(icon('checkCircle', 15), h('span', t('reg.savedToday', { n: num(savedCount()) })));
  }

  function renderRows() {
    const saved = sheet.rows.filter((r) => r.saved);
    const hideCount = !sheet.showEarlier && saved.length > VISIBLE_SAVED * 2 ? saved.length - VISIBLE_SAVED : 0;
    const hidden = new Set(saved.slice(0, hideCount));
    earlierBtn.hidden = !hideCount;
    earlierBtn.replaceChildren(icon('chevronDown', 16), t('reg.showEarlier', { n: num(hideCount) }));
    sheetBody.replaceChildren();
    refs.clear();
    sheet.rows.forEach((row, i) => {
      if (hidden.has(row)) return;
      sheetBody.append(buildRow(row, i));
    });
  }

  function buildRow(row, index) {
    const inputs = {};
    const errors = {};
    const cells = FIELDS.map((f) => {
      const input = h('input.cell-input', {
        type: 'text',
        value: row.data[f],
        dir: 'auto',
        autocomplete: 'off',
        spellcheck: false,
        enterkeyhint: f === 'serialNumber' ? 'done' : 'next',
        list: f === 'productModel' || f === 'salesPanel' ? `dl-${f}` : null,
        'aria-label': `${t(`f.${f}`)} — ${t('reg.row', { n: num(index + 1) })}`,
        'aria-required': REQUIRED.has(f) ? 'true' : null,
        placeholder: REQUIRED.has(f) ? `${t(`f.${f}`)} *` : t(`f.${f}`),
        oninput: (e) => onInput(row, f, e.target.value),
        onkeydown: (e) => onKey(e, row, f),
        onblur: f === 'serialNumber' ? () => checkDuplicate(row) : null,
      });
      if (f === 'serialNumber') input.classList.add('mono');
      inputs[f] = input;
      errors[f] = h('div.cell-error', { role: 'alert' });
      const camBtn = f === 'serialNumber'
        ? h('button.cam-btn', {
          type: 'button', title: t('reg.addCamera'), 'aria-label': t('reg.addCamera'), onclick: () => scanInto(row),
        }, icon('camera', 18), h('span', t('reg.addCamera')))
        : null;
      return h(`div.cell.c-${f}`, { role: 'cell' },
        h('label.cell-label', t(`f.${f}`), REQUIRED.has(f) ? h('span.req', ' *') : null),
        f === 'serialNumber' ? h('div.serial-wrap', input, camBtn) : input,
        errors[f]);
    });
    const numEl = h('div.cell.c-num', { role: 'cell' }, h('span.row-num', num(index + 1)));
    const dateEl = h('div.cell.c-date', { role: 'cell' });
    const status = h('div.cell.c-act', { role: 'cell' });
    const el = h('div.sheet-row', { role: 'row', dataset: { key: row.key } }, numEl, dateEl, ...cells, status);
    refs.set(row.key, { el, inputs, errors, status, dateEl });
    updateRow(row);
    return el;
  }

  function updateRow(row) {
    const r = refs.get(row.key);
    if (!r) return;
    r.el.classList.toggle('saved', row.saved);
    r.el.classList.toggle('saving', row.saving);
    r.el.classList.toggle('invalid', Object.keys(row.errors).length > 0);
    for (const f of FIELDS) {
      r.inputs[f].readOnly = row.saved || row.saving;
      if (r.inputs[f].value !== row.data[f]) r.inputs[f].value = row.data[f];
      r.errors[f].textContent = row.errors[f] || '';
      r.inputs[f].setAttribute('aria-invalid', row.errors[f] ? 'true' : 'false');
      r.inputs[f].closest('.cell').classList.toggle('has-error', !!row.errors[f]);
    }
    r.el.querySelector('.cam-btn').hidden = row.saved;
    r.dateEl.replaceChildren(h('span.cell-label', t('f.date')),
      h(`span.date-text${row.saved ? '' : '.muted'}`, fmtDate(row.jalaliDate || sheet.date)));
    if (row.saved) {
      const at = fmtInstant(row.createdAt);
      r.status.replaceChildren(h('span.saved-badge', { title: `${at.date} ${at.time}` }, icon('check', 16), h('span', t('reg.saved'))));
    } else if (row.saving) {
      r.status.replaceChildren(h('span.saving-badge', spinner()));
    } else {
      r.status.replaceChildren(h('button.btn.save-btn', {
        type: 'button', title: t('reg.save'), 'aria-label': t('reg.save'), onclick: () => saveRow(row),
      }, icon('check', 18), h('span', t('reg.save'))));
    }
  }

  function onInput(row, f, value) {
    row.data[f] = value;
    row.touched = true;
    if (f === 'serialNumber') row.source = row.scanned && value.trim() === row.scanned.value ? row.scanned.source : 'manual';
    if (row.errors[f]) {
      delete row.errors[f];
      updateRow(row);
    }
  }

  function onKey(e, row, f) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (f === 'serialNumber') return saveRow(row);
    const next = FIELDS[FIELDS.indexOf(f) + 1];
    refs.get(row.key)?.inputs[next]?.focus();
  }

  let dupSeq = 0;
  async function checkDuplicate(row) {
    const value = row.data.serialNumber.trim();
    if (!value || row.saved || row.saving) return false;
    const seq = ++dupSeq;
    try {
      const { exists } = await get(`/serials/check${qs({ sn: value })}`);
      if (seq !== dupSeq || row.saved || row.data.serialNumber.trim() !== value) return exists;
      if (exists) {
        row.errors.serialNumber = t('err.DUPLICATE_SERIAL');
        updateRow(row);
      }
      return exists;
    } catch {
      return false;
    }
  }

  async function scanInto(row) {
    const result = await openScanner({
      check: async (value) => (await get(`/serials/check${qs({ sn: value })}`)).exists,
    });
    if (!result) return;
    row.data.serialNumber = result.value;
    row.scanned = { value: result.value, source: result.source };
    row.source = result.source;
    delete row.errors.serialNumber;
    updateRow(row);
    refs.get(row.key)?.inputs.serialNumber.focus();
    checkDuplicate(row);
  }

  async function saveRow(row) {
    if (row.saved || row.saving) return;
    row.errors = {};
    for (const f of REQUIRED) {
      if (!row.data[f].trim()) row.errors[f] = t('err.REQUIRED', { field: t(`f.${f}`) });
    }
    if (Object.keys(row.errors).length) {
      updateRow(row);
      shake(row);
      const first = FIELDS.find((f) => row.errors[f]);
      refs.get(row.key)?.inputs[first].focus();
      toast(row.errors[first], 'error');
      return;
    }
    row.saving = true;
    updateRow(row);
    try {
      const { item } = await post('/serials', { ...row.data, source: row.source });
      Object.assign(row, { id: item.id, saved: true, jalaliDate: item.jalaliDate, createdAt: item.createdAt });
      row.data = Object.fromEntries(FIELDS.map((f) => [f, item[f]]));
      row.saving = false;
      updateRow(row);
      updateCount();
      toast(t('reg.savedToast', { sn: item.serialNumber }), 'success', 1800);
      afterSave(row);
    } catch (err) {
      row.saving = false;
      if (err.errors) {
        for (const [f, code] of Object.entries(err.errors)) row.errors[f] = errorText(code, { field: t(`f.${f}`) });
      }
      updateRow(row);
      shake(row);
      toast(err.code === 'DUPLICATE_SERIAL' ? t('err.DUPLICATE_SERIAL') : errorText(err.code), 'error', 4500);
      if (err.code === 'DUPLICATE_SERIAL') refs.get(row.key)?.inputs.serialNumber.select();
    }
  }

  function afterSave(row) {
    const idx = sheet.rows.indexOf(row);
    if (sheet.rows.slice(idx + 1).every((r) => r.saved)) addRows(false);
    const next = sheet.rows.slice(idx + 1).find((r) => !r.saved);
    if (!next) return;
    if (sheet.autofill && isEmpty(next)) {
      for (const f of CARRY) next.data[f] = row.data[f];
      updateRow(next);
    }
    const target = sheet.autofill && next.data.productModel ? 'serialNumber' : 'productModel';
    const input = refs.get(next.key)?.inputs[target];
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function addRows(manual) {
    const start = sheet.rows.length;
    for (let i = 0; i < PAGE_ROWS; i += 1) sheet.rows.push(blankRow());
    sheet.rows.slice(start).forEach((row, i) => {
      const el = buildRow(row, start + i);
      el.classList.add('appear');
      sheetBody.append(el);
    });
    if (manual) refs.get(sheet.rows[start].key)?.inputs.productModel.focus();
    else toast(t('reg.rowsAdded'), 'info', 1800);
  }

  function shake(row) {
    const el = refs.get(row.key)?.el;
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function focusFirstOpen() {
    if (matchMedia('(pointer: coarse)').matches) return; // don't pop the keyboard on phones
    const first = sheet.rows.find((r) => !r.saved);
    if (first) refs.get(first.key)?.inputs.productModel.focus({ preventScroll: true });
  }

  const beforeUnload = (e) => {
    if (sheet?.rows.some((r) => !r.saved && r.touched && !isEmpty(r))) { e.preventDefault(); e.returnValue = ''; }
  };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}
