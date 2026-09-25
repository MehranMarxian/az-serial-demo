// DEMO MODE ONLY — an in-browser stand-in for the Node API, used by the static GitHub Pages build.
// All data lives in this browser's localStorage. Not secure, not shared: for UI testing only.
import { ApiError } from './api.js';
import { jalaliDateOf, normalizeJalali, toLatinDigits } from './jalali.js';

const TZ = 'Asia/Tehran';
const DB_KEY = 'azs.demo.db';
const SESSION_KEY = 'azs.demo.session';
const DUPLICATE = 'This serial number is already registered. Duplicate serial numbers cannot be registered.';

const nowIso = () => new Date().toISOString();
const today = () => jalaliDateOf(new Date(), TZ);
const fail = (status, code, extra = {}) => { throw new ApiError(status, { code, ...extra }); };

const cleanText = (v, max = 120) => (v == null ? '' : toLatinDigits(String(v)).replace(/\s+/g, ' ').trim().slice(0, max));
const cleanSerial = (v) => cleanText(v, 80).toUpperCase();
const serialKey = (v) => cleanSerial(v).replace(/\s+/g, '');

// ---------------------------------------------------------------- storage

function seed() {
  const db = { seq: 0, users: [], serials: [], audit: [] };
  const id = () => ++db.seq;
  const ago = (days, h = 10) => new Date(Date.now() - days * 86400_000 - h * 3600_000).toISOString();
  const user = (username, fullName, password, role, status, created) => {
    const u = { id: id(), username, fullName, phone: '', password, role, status, createdAt: created, reviewedAt: null, lastLoginAt: null };
    db.users.push(u);
    return u;
  };
  const admin = user('admin', 'Administrator', 'admin12345', 'admin', 'approved', ago(30));
  const demo = user('demo', 'Demo Operator', 'demo12345', 'user', 'approved', ago(20));
  user('newuser', 'Pending Tester', 'newuser123', 'user', 'pending', ago(0, 1));
  const rows = [
    [6, 'AZ-500', 'Online Store', 'ORD-1001', 'P-100', 'AZ5-24000101', 'barcode', demo],
    [6, 'AZ-500', 'Online Store', 'ORD-1001', 'P-100', 'AZ5-24000102', 'barcode', demo],
    [4, 'AZ-700', 'Showroom', 'ORD-1002', 'P-210', 'AZ7-24000311', 'ocr', demo],
    [2, 'AZ-700', 'Wholesale', 'ORD-1003', 'P-210', 'AZ7-24000312', 'manual', admin],
    [1, 'AZ-500', 'Wholesale', 'ORD-1004', 'P-100', 'AZ5-24000103', 'barcode', demo],
    [0, 'AZ-900', 'Online Store', 'ORD-1005', 'P-330', 'AZ9-24000501', 'manual', demo],
  ];
  for (const [d, productModel, salesPanel, orderCode, productCode, serialNumber, source, u] of rows) {
    const createdAt = ago(d, 2);
    const s = { id: id(), jalaliDate: jalaliDateOf(new Date(createdAt), TZ), createdAt, productModel, salesPanel, orderCode, productCode,
      serialNumber, serialKey: serialKey(serialNumber), source, userId: u.id, updatedAt: null, updatedBy: null };
    db.serials.push(s);
    db.audit.push({ id: id(), at: createdAt, actorId: u.id, action: 'serial.create', entityId: s.id, details: { serialNumber, source } });
  }
  return db;
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* fall through */ }
  const db = seed();
  save(db);
  return db;
}
function save(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

export function resetDemo() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(SESSION_KEY);
}

// ---------------------------------------------------------------- DTOs

const userById = (db, id) => db.users.find((u) => u.id === id);
const userRef = (u) => (u ? { id: u.id, username: u.username, fullName: u.fullName, removed: !!u.removedAt } : null);

function serialDto(db, s) {
  return {
    id: s.id, jalaliDate: s.jalaliDate, createdAt: s.createdAt, productModel: s.productModel, salesPanel: s.salesPanel,
    orderCode: s.orderCode, productCode: s.productCode, serialNumber: s.serialNumber, source: s.source,
    user: userRef(userById(db, s.userId)), updatedAt: s.updatedAt, updatedBy: s.updatedBy ? userRef(userById(db, s.updatedBy)) : null,
  };
}

function auditDto(db, a) {
  return { id: a.id, at: a.at, action: a.action, entityId: a.entityId, atJalali: jalaliDateOf(new Date(a.at), TZ), actor: userRef(userById(db, a.actorId)), details: a.details };
}

function audit(db, actorId, action, entityId, details) {
  db.audit.push({ id: ++db.seq, at: nowIso(), actorId, action, entityId, details });
}

// ---------------------------------------------------------------- query helpers

const TEXT = ['productModel', 'salesPanel', 'orderCode', 'productCode', 'serialNumber'];
const SORTS = {
  id: (s) => s.id, date: (s) => s.jalaliDate, productModel: (s) => s.productModel, salesPanel: (s) => s.salesPanel,
  orderCode: (s) => s.orderCode, productCode: (s) => s.productCode, serialNumber: (s) => s.serialNumber,
};

function filterSerials(db, q) {
  const has = (v, needle) => String(v || '').toLowerCase().includes(needle.toLowerCase());
  const from = normalizeJalali(q.dateFrom);
  const to = normalizeJalali(q.dateTo);
  const term = (q.q || '').trim();
  return db.serials.filter((s) => {
    const u = userById(db, s.userId);
    if (term && ![s.productModel, s.salesPanel, s.orderCode, s.productCode, s.serialNumber, s.jalaliDate, u?.username, u?.fullName].some((v) => has(v, term))) return false;
    for (const f of TEXT) if (q[f] && !has(s[f], q[f].trim())) return false;
    if (from && s.jalaliDate < from) return false;
    if (to && s.jalaliDate > to) return false;
    if (q.userId && s.userId !== +q.userId) return false;
    if (q.source && s.source !== q.source) return false;
    return true;
  });
}

function sortAndPage(db, items, q, { paginate = true } = {}) {
  const key = q.sort === 'user' ? (s) => userById(db, s.userId)?.fullName || '' : SORTS[q.sort] || SORTS.id;
  const dir = q.dir === 'asc' ? 1 : -1;
  const sorted = [...items].sort((a, b) => {
    const x = key(a); const y = key(b);
    return (x < y ? -1 : x > y ? 1 : a.id - b.id) * dir;
  });
  if (!paginate) return { total: sorted.length, rows: sorted };
  const page = Math.max(1, +q.page || 1);
  const pageSize = Math.min(200, Math.max(5, +q.pageSize || 25));
  return { total: sorted.length, page, pageSize, rows: sorted.slice((page - 1) * pageSize, page * pageSize) };
}

function validateSerial(body) {
  const data = {
    productModel: cleanText(body.productModel), salesPanel: cleanText(body.salesPanel), orderCode: cleanText(body.orderCode),
    productCode: cleanText(body.productCode), serialNumber: cleanSerial(body.serialNumber),
    source: ['manual', 'barcode', 'ocr'].includes(body.source) ? body.source : 'manual',
  };
  const errors = {};
  if (!data.productModel) errors.productModel = 'REQUIRED';
  if (!data.serialNumber) errors.serialNumber = 'REQUIRED';
  return { data, errors };
}

function csv(db, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['ID', 'Date', 'Product Model', 'Sales Panel', 'Order Code', 'Product Code', 'Serial Number', 'Source', 'Registered By', 'Username', 'Registered At (UTC)'];
  const lines = [head, ...rows.map((s) => {
    const u = userById(db, s.userId);
    return [s.id, s.jalaliDate, s.productModel, s.salesPanel, s.orderCode, s.productCode, s.serialNumber, s.source, u?.fullName, u?.username, s.createdAt];
  })].map((r) => r.map(cell).join(','));
  return `﻿${lines.join('\r\n')}`;
}

// ---------------------------------------------------------------- router

export async function handle(method, fullPath, body = {}) {
  await new Promise((r) => setTimeout(r, 120)); // feel like a network call
  const db = load();
  const [path, query = ''] = fullPath.split('?');
  const q = Object.fromEntries(new URLSearchParams(query));
  const sessionId = +localStorage.getItem(SESSION_KEY) || 0;
  const me = db.users.find((u) => u.id === sessionId && u.status === 'approved') || null;
  const route = `${method} ${path}`;
  const needUser = () => { if (!me) fail(401, 'UNAUTHENTICATED'); };
  const needAdmin = () => { needUser(); if (me.role !== 'admin') fail(403, 'FORBIDDEN'); };
  const done = (result) => { save(db); return result; };
  let m;

  // ---- auth
  if (route === 'GET /health') return { ok: true };
  if (route === 'GET /auth/me') return { user: me ? { id: me.id, username: me.username, fullName: me.fullName, role: me.role } : null, today: today(), timeZone: TZ };
  if (route === 'POST /auth/logout') { localStorage.removeItem(SESSION_KEY); return { ok: true }; }
  if (route === 'POST /auth/login') {
    const u = db.users.find((x) => x.username === cleanText(body.username, 32).toLowerCase());
    if (!u || u.removedAt || u.password !== body.password) fail(401, 'INVALID_CREDENTIALS');
    if (u.status !== 'approved') fail(403, { pending: 'PENDING_APPROVAL', rejected: 'ACCOUNT_REJECTED', disabled: 'ACCOUNT_DISABLED' }[u.status]);
    u.lastLoginAt = nowIso();
    localStorage.setItem(SESSION_KEY, String(u.id));
    return done({ user: { id: u.id, username: u.username, fullName: u.fullName, role: u.role } });
  }
  if (route === 'POST /auth/register') {
    const data = { fullName: cleanText(body.fullName, 80), username: cleanText(body.username, 32).toLowerCase(), phone: cleanText(body.phone, 20), password: body.password || '' };
    const errors = {};
    if (!data.fullName) errors.fullName = 'REQUIRED';
    if (!data.username) errors.username = 'REQUIRED';
    else if (!/^[a-zA-Z0-9._-]{3,32}$/.test(data.username)) errors.username = 'INVALID_USERNAME';
    if (!data.password) errors.password = 'REQUIRED';
    else if (data.password.length < 8) errors.password = 'PASSWORD_TOO_SHORT';
    if (Object.keys(errors).length) fail(400, 'VALIDATION', { errors });
    if (db.users.some((u) => u.username === data.username)) fail(409, 'USERNAME_TAKEN', { errors: { username: 'USERNAME_TAKEN' } });
    const u = { id: ++db.seq, ...data, role: 'user', status: 'pending', createdAt: nowIso(), reviewedAt: null, lastLoginAt: null };
    db.users.push(u);
    audit(db, u.id, 'user.register', u.id, { username: u.username });
    return done({ code: 'PENDING_APPROVAL' });
  }

  // ---- serials (any approved user)
  if (route === 'GET /serials/check') {
    needUser();
    const key = serialKey(q.sn);
    const hit = key && db.serials.find((s) => s.serialKey === key);
    return { exists: !!hit && hit.id !== (+q.excludeId || 0) };
  }
  if (route === 'GET /serials/mine') {
    needUser();
    const date = normalizeJalali(q.date) || today();
    return { date, items: db.serials.filter((s) => s.userId === me.id && s.jalaliDate === date).sort((a, b) => a.id - b.id).map((s) => serialDto(db, s)) };
  }
  if (route === 'GET /serials/history') {
    needUser();
    const mine = filterSerials(db, { q: q.q }).filter((s) => s.userId === me.id);
    const r = sortAndPage(db, mine, { page: q.page, pageSize: q.pageSize || 20 });
    return { total: r.total, page: r.page, pageSize: r.pageSize, items: r.rows.map((s) => serialDto(db, s)) };
  }
  if (route === 'GET /serials/suggestions') {
    needUser();
    const top = (f) => Object.entries(db.serials.reduce((acc, s) => { if (s[f]) acc[s[f]] = (acc[s[f]] || 0) + 1; return acc; }, {}))
      .sort((a, b) => b[1] - a[1]).slice(0, 40).map(([v]) => v);
    return { productModel: top('productModel'), salesPanel: top('salesPanel') };
  }
  if (route === 'GET /me/activity') {
    needUser();
    const page = Math.max(1, +q.page || 1);
    const mine = db.audit.filter((a) => a.actorId === me.id).sort((a, b) => b.id - a.id);
    return { total: mine.length, page, pageSize: 30, items: mine.slice((page - 1) * 30, page * 30).map((a) => auditDto(db, a)) };
  }
  if (route === 'POST /serials') {
    needUser();
    const { data, errors } = validateSerial(body);
    if (Object.keys(errors).length) fail(400, 'VALIDATION', { errors });
    const key = serialKey(data.serialNumber);
    if (db.serials.some((s) => s.serialKey === key)) fail(409, 'DUPLICATE_SERIAL', { errors: { serialNumber: 'DUPLICATE_SERIAL' }, message: DUPLICATE });
    const s = { id: ++db.seq, jalaliDate: today(), createdAt: nowIso(), ...data, serialKey: key, userId: me.id, updatedAt: null, updatedBy: null };
    db.serials.push(s);
    audit(db, me.id, 'serial.create', s.id, { serialNumber: s.serialNumber, source: s.source });
    return done({ item: serialDto(db, s) });
  }

  // ---- admin
  if (path.startsWith('/admin/')) needAdmin();
  if (route === 'GET /admin/stats') {
    const t = today();
    return {
      today: t,
      totalSerials: db.serials.length,
      todaySerials: db.serials.filter((s) => s.jalaliDate === t).length,
      monthSerials: db.serials.filter((s) => s.jalaliDate.startsWith(t.slice(0, 8))).length,
      pendingUsers: db.users.filter((u) => u.status === 'pending').length,
      activeUsers: db.users.filter((u) => u.status === 'approved').length,
    };
  }
  if (route === 'GET /admin/serials') {
    const r = sortAndPage(db, filterSerials(db, q), q);
    return { total: r.total, page: r.page, pageSize: r.pageSize, items: r.rows.map((s) => serialDto(db, s)) };
  }
  if (route === 'GET /admin/serials/export.csv') return { csv: csv(db, sortAndPage(db, filterSerials(db, q), q, { paginate: false }).rows) };
  if ((m = /^GET \/admin\/serials\/(\d+)\/history$/.exec(route))) {
    return { items: db.audit.filter((a) => a.action.startsWith('serial.') && a.entityId === +m[1]).sort((a, b) => b.id - a.id).map((a) => auditDto(db, a)) };
  }
  if ((m = /^PATCH \/admin\/serials\/(\d+)$/.exec(route))) {
    const s = db.serials.find((x) => x.id === +m[1]);
    if (!s) fail(404, 'NOT_FOUND');
    const { data, errors } = validateSerial({ ...body, source: s.source });
    const date = body.jalaliDate === undefined ? s.jalaliDate : normalizeJalali(body.jalaliDate);
    if (!date) errors.jalaliDate = 'INVALID_DATE';
    if (Object.keys(errors).length) fail(400, 'VALIDATION', { errors });
    const key = serialKey(data.serialNumber);
    if (db.serials.some((x) => x.serialKey === key && x.id !== s.id)) fail(409, 'DUPLICATE_SERIAL', { errors: { serialNumber: 'DUPLICATE_SERIAL' }, message: DUPLICATE });
    const map = { jalali_date: ['jalaliDate', date], product_model: ['productModel', data.productModel], sales_panel: ['salesPanel', data.salesPanel],
      order_code: ['orderCode', data.orderCode], product_code: ['productCode', data.productCode], serial_number: ['serialNumber', data.serialNumber] };
    const changes = {};
    for (const [dbField, [field, value]] of Object.entries(map)) if (s[field] !== value) { changes[dbField] = [s[field], value]; s[field] = value; }
    if (Object.keys(changes).length) {
      Object.assign(s, { serialKey: key, updatedAt: nowIso(), updatedBy: me.id });
      audit(db, me.id, 'serial.update', s.id, { serialNumber: s.serialNumber, changes });
    }
    return done({ item: serialDto(db, s) });
  }
  if ((m = /^DELETE \/admin\/serials\/(\d+)$/.exec(route))) {
    const i = db.serials.findIndex((x) => x.id === +m[1]);
    if (i < 0) fail(404, 'NOT_FOUND');
    const [s] = db.serials.splice(i, 1);
    audit(db, me.id, 'serial.delete', s.id, { snapshot: serialDto(db, s) });
    return done({ ok: true });
  }
  if (route === 'GET /admin/users') {
    const counts = db.users.reduce((acc, u) => { const k = u.removedAt ? 'removed' : u.status; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
    const list = db.users.filter((u) => (q.status === 'removed' ? !!u.removedAt
      : q.includeRemoved === '1' && !q.status ? true
        : !u.removedAt && (!q.status || u.status === q.status)))
      .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt));
    return {
      counts,
      items: list.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, phone: u.phone, role: u.role, status: u.removedAt ? 'removed' : u.status, removedAt: u.removedAt || null,
        createdAt: u.createdAt, reviewedAt: u.reviewedAt, lastLoginAt: u.lastLoginAt,
        serialCount: db.serials.filter((s) => s.userId === u.id).length, createdJalali: jalaliDateOf(new Date(u.createdAt), TZ) })),
    };
  }
  if ((m = /^PATCH \/admin\/users\/(\d+)$/.exec(route))) {
    const u = userById(db, +m[1]);
    if (!u) fail(404, 'NOT_FOUND');
    if (u.id === me.id) fail(400, 'CANNOT_CHANGE_SELF');
    if (u.removedAt) fail(404, 'NOT_FOUND');
    if (body.status && body.status !== u.status) {
      audit(db, me.id, `user.${body.status}`, u.id, { username: u.username, from: u.status });
      Object.assign(u, { status: body.status, reviewedAt: nowIso() });
    }
    if (body.role && body.role !== u.role) {
      audit(db, me.id, 'user.role', u.id, { username: u.username, from: u.role, to: body.role });
      u.role = body.role;
    }
    return done({ ok: true });
  }
  if ((m = /^POST \/admin\/users\/(\d+)\/password$/.exec(route))) {
    const u = userById(db, +m[1]);
    if (!u) fail(404, 'NOT_FOUND');
    if (!body.password || body.password.length < 8) fail(400, 'VALIDATION', { errors: { password: 'PASSWORD_TOO_SHORT' } });
    u.password = body.password;
    audit(db, me.id, 'user.password_reset', u.id, { username: u.username });
    return done({ ok: true });
  }
  if (route === 'POST /admin/users') {
    const data = { fullName: cleanText(body.fullName, 80), username: cleanText(body.username, 32).toLowerCase(), phone: cleanText(body.phone, 20), password: body.password || '' };
    const errors = {};
    if (!data.fullName) errors.fullName = 'REQUIRED';
    if (!data.username) errors.username = 'REQUIRED';
    else if (!/^[a-zA-Z0-9._-]{3,32}$/.test(data.username)) errors.username = 'INVALID_USERNAME';
    if (data.password.length < 8) errors.password = data.password ? 'PASSWORD_TOO_SHORT' : 'REQUIRED';
    if (Object.keys(errors).length) fail(400, 'VALIDATION', { errors });
    if (db.users.some((u) => u.username === data.username)) fail(409, 'USERNAME_TAKEN', { errors: { username: 'USERNAME_TAKEN' } });
    const role = body.role === 'admin' ? 'admin' : 'user';
    const u = { id: ++db.seq, ...data, role, status: 'approved', createdAt: nowIso(), reviewedAt: nowIso(), lastLoginAt: null };
    db.users.push(u);
    audit(db, me.id, 'user.created', u.id, { username: u.username, role });
    return done({ id: u.id });
  }
  if ((m = /^DELETE \/admin\/users\/(\d+)$/.exec(route))) {
    const u = userById(db, +m[1]);
    if (!u) fail(404, 'NOT_FOUND');
    if (u.id === me.id) fail(400, 'CANNOT_CHANGE_SELF');
    if (u.removedAt) fail(404, 'NOT_FOUND');
    const kept = db.serials.filter((s) => s.userId === u.id || s.updatedBy === u.id).length;
    if (kept) {
      Object.assign(u, { removedAt: nowIso(), removedBy: me.id, status: 'disabled' });
      if (+localStorage.getItem(SESSION_KEY) === u.id) localStorage.removeItem(SESSION_KEY);
      audit(db, me.id, 'user.removed', u.id, { username: u.username, fullName: u.fullName, keptSerials: kept });
      return done({ ok: true, keptSerials: kept });
    }
    for (const a of db.audit) if (a.actorId === u.id) { a.actorId = null; a.details = { ...(a.details || {}), actorName: u.fullName }; }
    db.users = db.users.filter((x) => x.id !== u.id);
    if (+localStorage.getItem(SESSION_KEY) === u.id) localStorage.removeItem(SESSION_KEY);
    audit(db, me.id, 'user.removed', u.id, { username: u.username, fullName: u.fullName });
    return done({ ok: true });
  }
  if (route === 'GET /admin/activity') {
    const page = Math.max(1, +q.page || 1);
    const pageSize = 30;
    const uid = +q.userId || 0;
    const all = [...db.audit].filter((a) => !uid || a.actorId === uid || (a.action.startsWith('user.') && a.entityId === uid)).sort((a, b) => b.id - a.id);
    return { total: all.length, page, pageSize, items: all.slice((page - 1) * pageSize, page * pageSize).map((a) => auditDto(db, a)) };
  }
  fail(404, 'NOT_FOUND');
}
