// Jalali (Persian / Shamsi) calendar helpers.
// Shared by the browser and the Node server (plain ES module, no dependencies).
// Conversion algorithm: Borkowski / jalaali-js (MIT).

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;

function jalCal(jy, withoutLeap) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) throw new RangeError(`Invalid Jalali year ${jy}`);
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (withoutLeap) return { gy, march };
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy, jm, jd) {
  const r = jalCal(jy, true);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn) {
  const { gy } = d2g(jdn);
  let jy = gy - 621;
  const r = jalCal(jy, false);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function toJalali(gy, gm, gd) {
  return d2j(g2d(gy, gm, gd));
}

export function toGregorian(jy, jm, jd) {
  return d2g(j2d(jy, jm, jd));
}

export function isLeapJalaliYear(jy) {
  return jalCal(jy, false).leap === 0;
}

export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaliYear(jy) ? 30 : 29;
}

/** Day of week for a Jalali date, 0 = Saturday … 6 = Friday (Persian week order). */
export function jalaliWeekday(jy, jm, jd) {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  const js = new Date(Date.UTC(gy, gm - 1, gd)).getUTCDay(); // 0 = Sunday
  return (js + 1) % 7;
}

const pad = (n) => String(n).padStart(2, '0');

export function formatJalali({ jy, jm, jd }) {
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/** Parses "1405/7/3", "1405-07-03" or Persian digits into {jy,jm,jd}; returns null when invalid. */
export function parseJalali(text) {
  if (!text) return null;
  const s = toLatinDigits(String(text)).trim();
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const jy = +m[1];
  const jm = +m[2];
  const jd = +m[3];
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > jalaliMonthLength(jy, jm)) return null;
  return { jy, jm, jd };
}

/** Normalises any accepted Jalali input to the canonical "YYYY/MM/DD" string (or null). */
export function normalizeJalali(text) {
  const p = parseJalali(text);
  return p ? formatJalali(p) : null;
}

/** Gregorian calendar parts of an instant in a given IANA time zone. */
export function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => +parts.find((p) => p.type === t).value;
  return { gy: get('year'), gm: get('month'), gd: get('day'), hh: get('hour'), mi: get('minute') };
}

/** Jalali date string ("1405/07/03") of an instant, as seen in the given time zone. */
export function jalaliDateOf(date = new Date(), timeZone = 'Asia/Tehran') {
  const { gy, gm, gd } = zonedParts(date, timeZone);
  return formatJalali(toJalali(gy, gm, gd));
}

export function jalaliTimeOf(date = new Date(), timeZone = 'Asia/Tehran') {
  const { hh, mi } = zonedParts(date, timeZone);
  return `${pad(hh)}:${pad(mi)}`;
}

/** Shifts a Jalali date by a number of days. */
export function addJalaliDays({ jy, jm, jd }, days) {
  return d2j(j2d(jy, jm, jd) + days);
}

export const MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
export const MONTHS_EN = ['Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar', 'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand'];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function toLatinDigits(s) {
  return String(s).replace(/[۰-۹٠-٩]/g, (c) => {
    const i = FA_DIGITS.indexOf(c);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(c));
  });
}

export function toPersianDigits(s) {
  return String(s).replace(/\d/g, (d) => FA_DIGITS[+d]);
}

export function toArabicDigits(s) {
  return String(s).replace(/\d/g, (d) => AR_DIGITS[+d]);
}

export const MONTHS_AR = ['فروردين', 'أرديبهشت', 'خرداد', 'تير', 'مرداد', 'شهريور', 'مهر', 'آبان', 'آذر', 'دي', 'بهمن', 'إسفند'];
