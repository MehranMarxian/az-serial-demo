// Jalali (Persian calendar) date input with a popover month grid.
import {
  MONTHS_AR, MONTHS_EN, MONTHS_FA, formatJalali, jalaliMonthLength, jalaliWeekday, normalizeJalali, parseJalali, toLatinDigits,
} from './jalali.js';
import { getLang, localDigits, t } from './i18n.js';
import { h } from './ui.js';
import { icon } from './icons.js';

const WEEKDAYS = {
  en: ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'],
  fa: ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'],
  ar: ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'],
};
const MONTHS = { en: MONTHS_EN, fa: MONTHS_FA, ar: MONTHS_AR };

/**
 * Creates a Jalali date input. `today` is the canonical "YYYY/MM/DD" of the business day.
 * The input's value is always the canonical Latin-digit form; onChange receives it (or '').
 */
export function jalaliInput({ value = '', today, placeholder = '1405/07/03', onChange, id }) {
  const input = h('input.input.date-input', {
    id, type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder, value, dir: 'ltr',
  });
  const pop = h('div.datepop', { hidden: true, role: 'dialog' });
  const wrap = h('div.date-wrap', input, h('span.date-ico', icon('calendar', 16)), pop);

  const todayP = parseJalali(today);
  let view = parseJalali(value) || todayP;

  function commit(v) {
    input.value = v;
    input.classList.remove('bad');
    onChange?.(v);
  }

  function render() {
    const lang = getLang();
    const sel = parseJalali(input.value);
    const len = jalaliMonthLength(view.jy, view.jm);
    const offset = jalaliWeekday(view.jy, view.jm, 1);
    const cells = [];
    for (let i = 0; i < offset; i += 1) cells.push(h('span.dp-blank'));
    for (let d = 1; d <= len; d += 1) {
      const isSel = sel && sel.jy === view.jy && sel.jm === view.jm && sel.jd === d;
      const isToday = todayP.jy === view.jy && todayP.jm === view.jm && todayP.jd === d;
      cells.push(h(`button.dp-day${isSel ? '.sel' : ''}${isToday ? '.today' : ''}`, {
        type: 'button',
        onclick: () => { commit(formatJalali({ jy: view.jy, jm: view.jm, jd: d })); close(); },
      }, localDigits(d)));
    }
    const shift = (delta) => {
      let { jy, jm } = view;
      jm += delta;
      if (jm < 1) { jm = 12; jy -= 1; }
      if (jm > 12) { jm = 1; jy += 1; }
      view = { jy, jm, jd: 1 };
      render();
    };
    pop.replaceChildren(
      h('div.dp-head',
        h('button.btn.icon.ghost.sm', { type: 'button', 'aria-label': t('dp.prev'), onclick: () => shift(-1) }, icon('chevronLeft', 18)),
        h('strong', `${MONTHS[lang][view.jm - 1]} ${localDigits(view.jy)}`),
        h('button.btn.icon.ghost.sm', { type: 'button', 'aria-label': t('dp.next'), onclick: () => shift(1) }, icon('chevronRight', 18))),
      h('div.dp-grid', WEEKDAYS[lang].map((w) => h('span.dp-wd', w)), cells),
      h('div.dp-foot',
        h('button.btn.ghost.sm', { type: 'button', onclick: () => { commit(''); close(); } }, t('dp.clear')),
        h('button.btn.subtle.sm', { type: 'button', onclick: () => { commit(today); close(); } }, t('dp.today'))),
    );
  }

  function open() {
    view = parseJalali(input.value) || todayP;
    render();
    pop.hidden = false;
    document.addEventListener('pointerdown', outside, true);
  }
  function close() {
    pop.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
  }
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };

  input.addEventListener('focus', open);
  input.addEventListener('click', () => { if (pop.hidden) open(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Tab') close(); });
  input.addEventListener('input', () => {
    input.value = toLatinDigits(input.value);
    const p = parseJalali(input.value);
    if (p) { view = p; render(); }
  });
  input.addEventListener('change', () => {
    if (!input.value.trim()) return commit('');
    const norm = normalizeJalali(input.value);
    if (norm) commit(norm);
    else input.classList.add('bad');
  });

  wrap.input = input;
  wrap.setValue = (v) => { input.value = v || ''; input.classList.remove('bad'); };
  return wrap;
}
