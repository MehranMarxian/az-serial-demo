import { api, del, get, isDemo, patch, post, qs } from '../api.js';
import { errorText, localDigits, num, t } from '../i18n.js';
import { addJalaliDays, formatJalali, parseJalali } from '../jalali.js';
import { h, confirmDialog, debounce, emptyState, field, modalHeader, openModal, toast, withBusy } from '../ui.js';
import { icon } from '../icons.js';
import { avatar, dataTable, fmtDate, fmtInstant, pager, skeletonRows, sourceBadge, userCell } from '../components.js';
import { jalaliInput } from '../datepicker.js';

const TEXT_FILTERS = ['productModel', 'salesPanel', 'orderCode', 'productCode', 'serialNumber'];
const DB_FIELD_LABEL = {
  jalali_date: 'f.date', product_model: 'f.productModel', sales_panel: 'f.salesPanel',
  order_code: 'f.orderCode', product_code: 'f.productCode', serial_number: 'f.serialNumber',
};

// Manager console: Overview · Users · Serial numbers · Activity (routes /admin/<tab>).
export function mount(main, ctx) {
  const tab = ctx.path.split('/')[2];
  const body = h('div.admin-body');
  main.append(h('div.page.admin',
    h('section.page-head', h('div', h('h1', t(`adm.tab.${tab}`)), h('p.muted', t(`adm.${tab}.subtitle`)))),
    body));

  const refreshStats = () => get('/admin/stats').then((s) => { ctx.setPending(s.pendingUsers); return s; }).catch(() => null);
  const env = { ...ctx, refreshStats };
  if (tab === 'overview') overviewTab(body, env);
  else if (tab === 'users') usersTab(body, env);
  else if (tab === 'activity') activityTab(body, env);
  else serialsTab(body, env);
}

// ================================================================ Overview

function overviewTab(body, ctx) {
  const statsEl = h('div.stats', Array.from({ length: 4 }, () => h('div.stat.skeleton')));
  const pendingEl = h('div.pending-list', skeletonRows(2));
  const activityEl = h('ol.activity', skeletonRows(4));
  body.append(
    statsEl,
    h('div.overview-grid',
      h('section.card',
        h('header.card-head', h('h2', t('adm.pendingTitle')), h('a.btn.ghost.sm', { href: '#/admin/users' }, t('adm.viewAll'))),
        pendingEl),
      h('section.card',
        h('header.card-head', h('h2', t('adm.recentActivity')), h('a.btn.ghost.sm', { href: '#/admin/activity' }, t('adm.viewAll'))),
        activityEl)));

  async function load() {
    const s = await ctx.refreshStats();
    if (s) {
      statsEl.replaceChildren(
        stat('barcode', t('adm.stat.total'), s.totalSerials, '', () => ctx.navigate('/admin/serials')),
        stat('calendar', t('adm.stat.today'), s.todaySerials, 'accent'),
        stat('users', t('adm.stat.activeUsers'), s.activeUsers, '', () => ctx.navigate('/admin/users')),
        stat('userCheck', t('adm.stat.pending'), s.pendingUsers, s.pendingUsers ? 'warn' : '', () => ctx.navigate('/admin/users')));
    }
    const users = await get('/admin/users?status=pending').catch(() => ({ items: [] }));
    pendingEl.replaceChildren(...(users.items.length ? users.items.map((u) => {
      const decide = (status) => (e) => withBusy(e.currentTarget, async () => {
        try { await patch(`/admin/users/${u.id}`, { status }); toast(t('users.updated'), 'success'); load(); } catch (err) { toast(errorText(err.code), 'error'); }
      });
      return h('div.pending-row', userCell(u),
        h('div.row-actions.always',
          h('button.btn.primary.sm', { type: 'button', onclick: decide('approved') }, icon('userCheck', 15), t('users.approve')),
          h('button.btn.subtle.sm', { type: 'button', onclick: decide('rejected') }, t('users.reject'))));
    }) : [h('p.muted.pad', t('adm.pendingNone'))]));
    const act = await get('/admin/activity').catch(() => ({ items: [] }));
    activityEl.replaceChildren(...(act.items.length ? act.items.slice(0, 8).map(activityItem) : [emptyState('activity', t('act.empty'))]));
  }
  load();
}

function stat(iconName, label, value, tone = '', onclick) {
  return h(`${onclick ? 'button' : 'div'}.stat${tone ? `.${tone}` : ''}`, { type: onclick ? 'button' : null, onclick },
    h('span.stat-icon', icon(iconName, 18)),
    h('div', h('div.stat-value', num(value)), h('div.stat-label', label)));
}

// ================================================================ Serials

function serialsTab(body, ctx) {
  const today = ctx.state.today;
  const q = {
    q: '', dateFrom: '', dateTo: '', userId: '', source: '', sort: 'id', dir: 'desc', page: 1, pageSize: 25,
    ...Object.fromEntries(TEXT_FILTERS.map((f) => [f, ''])),
  };
  for (const [k, v] of ctx.params) if (k in q) q[k] = v;
  let users = [];

  const results = h('div.results', skeletonRows(8));
  const reload = debounce(() => { q.page = 1; load(); }, 280);

  const search = h('input.input', {
    type: 'search', value: q.q, placeholder: t('adm.search'), 'aria-label': t('adm.search'),
    oninput: (e) => { q.q = e.target.value; reload(); },
  });

  // ---- advanced filters
  const inputs = {};
  const textFilter = (f) => {
    inputs[f] = h('input.input', { type: 'text', value: q[f], dir: 'auto', oninput: (e) => { q[f] = e.target.value; reload(); } });
    return field({ label: t(`f.${f}`), input: inputs[f] });
  };
  const dateFrom = jalaliInput({ value: q.dateFrom, today, onChange: (v) => { q.dateFrom = v; markQuick(); reload(); } });
  const dateTo = jalaliInput({ value: q.dateTo, today, onChange: (v) => { q.dateTo = v; markQuick(); reload(); } });
  const userSelect = h('select.input', { onchange: (e) => { q.userId = e.target.value; reload(); } }, h('option', { value: '' }, t('adm.anyUser')));
  const sourceSelect = h('select.input', { onchange: (e) => { q.source = e.target.value; reload(); } },
    h('option', { value: '' }, t('adm.anySource')),
    ['manual', 'barcode', 'ocr'].map((s) => h('option', { value: s, selected: q.source === s }, t(`src.${s}`))));

  const todayP = parseJalali(today);
  const quick = [
    { id: 'today', from: today, to: today },
    { id: 'week', from: formatJalali(addJalaliDays(todayP, -6)), to: today },
    { id: 'month', from: formatJalali({ ...todayP, jd: 1 }), to: today },
    { id: 'all', from: '', to: '' },
  ];
  const quickBtns = quick.map((qq) => h('button.chip', {
    type: 'button', dataset: { id: qq.id },
    onclick: () => {
      q.dateFrom = qq.from; q.dateTo = qq.to;
      dateFrom.setValue(qq.from); dateTo.setValue(qq.to);
      markQuick(); reload();
    },
  }, t(`adm.quick.${qq.id}`)));
  function markQuick() {
    const hit = quick.find((qq) => qq.from === q.dateFrom && qq.to === q.dateTo);
    quickBtns.forEach((b) => b.classList.toggle('active', b.dataset.id === hit?.id));
  }
  markQuick();

  const activeCount = () => [q.dateFrom, q.dateTo, q.userId, q.source, ...TEXT_FILTERS.map((f) => q[f])].filter(Boolean).length;
  const filterBadge = h('span.count-badge');
  const filterPanel = h('div.filter-panel', { hidden: activeCount() === 0 },
    h('div.chips.quick', quickBtns),
    h('div.filter-grid',
      field({ label: t('adm.dateFrom'), input: dateFrom.input, control: dateFrom }),
      field({ label: t('adm.dateTo'), input: dateTo.input, control: dateTo }),
      ...TEXT_FILTERS.map(textFilter),
      field({ label: t('f.registeredBy'), input: userSelect }),
      field({ label: t('f.source'), input: sourceSelect })),
    h('div.filter-foot',
      h('button.btn.ghost.sm', {
        type: 'button',
        onclick: () => {
          Object.assign(q, { dateFrom: '', dateTo: '', userId: '', source: '' }, Object.fromEntries(TEXT_FILTERS.map((f) => [f, ''])));
          TEXT_FILTERS.forEach((f) => { inputs[f].value = ''; });
          dateFrom.setValue(''); dateTo.setValue(''); userSelect.value = ''; sourceSelect.value = '';
          markQuick(); reload();
        },
      }, icon('x', 15), t('adm.resetFilters'))));
  const filterBtn = h('button.btn.subtle', {
    type: 'button', 'aria-expanded': String(!filterPanel.hidden),
    onclick: () => { filterPanel.hidden = !filterPanel.hidden; filterBtn.setAttribute('aria-expanded', String(!filterPanel.hidden)); },
  }, icon('sliders', 17), h('span', t('adm.filters')), filterBadge);
  const exportBtn = h('a.btn.subtle', {
    href: '#', download: '',
    onclick: async (e) => {
      if (!isDemo()) return; // real server streams the file directly
      e.preventDefault();
      const { csv } = await api('GET', exportBtn.getAttribute('href').slice(3));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      h('a', { href: url, download: `az-serial-${today.replace(/\//g, '-')}.csv` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  }, icon('download', 17), h('span', t('adm.export')));

  body.append(h('section.card',
    h('div.toolbar',
      h('div.search', icon('search', 18), search),
      h('div.toolbar-actions', filterBtn, exportBtn)),
    filterPanel,
    results));

  get('/admin/users?includeRemoved=1').then((res) => {
    users = res.items;
    userSelect.append(...users.map((u) => h('option', { value: u.id, selected: String(u.id) === String(q.userId) }, `${u.fullName} (@${u.username})`)));
  }).catch(() => {});

  let seq = 0;
  async function load() {
    const mine = ++seq;
    const n = activeCount();
    filterBadge.textContent = n ? num(n) : '';
    filterBadge.hidden = !n;
    const { page, pageSize, sort, dir, ...filters } = q;
    exportBtn.href = `api/admin/serials/export.csv${qs({ ...filters, sort, dir })}`;
    results.classList.add('loading');
    try {
      const res = await get(`/admin/serials${qs(q)}`);
      if (mine !== seq) return;
      results.classList.remove('loading');
      if (!res.total) {
        const filtered = q.q || activeCount();
        results.replaceChildren(filtered
          ? emptyState('search', t('common.noResults'), t('common.noResultsBody'))
          : emptyState('package', t('hist.empty')));
        return;
      }
      results.replaceChildren(
        dataTable({
          items: res.items,
          sort: { key: q.sort, dir: q.dir },
          onSort: (s) => { q.sort = s.key; q.dir = s.dir; load(); },
          onRowClick: (it) => editSerial(it),
          columns: [
            { label: '#', sortKey: 'id', className: 'col-num', render: (it) => h('span.row-num', num(it.id)) },
            { label: t('f.date'), sortKey: 'date', render: (it) => h('span.nowrap', fmtDate(it.jalaliDate)) },
            { label: t('f.productModel'), sortKey: 'productModel', className: 'col-strong', render: (it) => it.productModel },
            { label: t('f.salesPanel'), sortKey: 'salesPanel', render: (it) => it.salesPanel || '—' },
            { label: t('f.orderCode'), sortKey: 'orderCode', render: (it) => h('span', { dir: 'ltr' }, it.orderCode || '—') },
            { label: t('f.productCode'), sortKey: 'productCode', render: (it) => h('span', { dir: 'ltr' }, it.productCode || '—') },
            { label: t('f.serialNumber'), sortKey: 'serialNumber', className: 'col-serial', render: (it) => h('div.serial-cell', h('span.mono', { dir: 'ltr' }, it.serialNumber), sourceBadge(it.source)) },
            { label: t('f.registeredBy'), sortKey: 'user', render: (it) => userCell(it.user) },
            {
              label: '', className: 'col-actions',
              render: (it) => h('div.row-actions',
                h('button.btn.icon.ghost.sm', { type: 'button', title: t('common.edit'), 'aria-label': t('common.edit'), onclick: () => editSerial(it) }, icon('pencil', 16)),
                h('button.btn.icon.ghost.sm.danger-hover', { type: 'button', title: t('common.delete'), 'aria-label': t('common.delete'), onclick: () => deleteSerial(it) }, icon('trash', 16))),
            },
          ],
        }),
        pager({
          ...res,
          onPage: (p) => { q.page = p; load(); results.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
          onPageSize: (s) => { q.pageSize = s; q.page = 1; load(); },
        }));
    } catch (err) {
      results.classList.remove('loading');
      results.replaceChildren(h('div.alert.alert-error', icon('alert', 18), h('span', errorText(err.code))));
    }
  }

  async function deleteSerial(item) {
    const ok = await confirmDialog({
      title: t('adm.delete.title'), message: t('adm.delete.body', { sn: item.serialNumber }),
      confirmText: t('common.delete'), danger: true, iconName: 'trash',
    });
    if (!ok) return false;
    try {
      await del(`/admin/serials/${item.id}`);
      toast(t('adm.deleted'), 'success');
      load();
      ctx.refreshStats();
      return true;
    } catch (err) {
      toast(errorText(err.code), 'error');
      return false;
    }
  }

  function editSerial(item) {
    return openModal((close) => {
      const fields = {};
      const inputs = {};
      const date = jalaliInput({ value: item.jalaliDate, today });
      fields.jalaliDate = field({ label: t('f.date'), input: date.input, control: date, required: true });
      for (const f of TEXT_FILTERS) {
        inputs[f] = h('input.input', { type: 'text', value: item[f], dir: 'auto', class: f === 'serialNumber' ? 'mono' : '' });
        fields[f] = field({ label: t(`f.${f}`), input: inputs[f], required: f === 'productModel' || f === 'serialNumber' });
      }
      const reg = fmtInstant(item.createdAt);
      const edit = item.updatedAt ? fmtInstant(item.updatedAt) : null;
      const historyEl = h('ol.timeline', h('li.muted', t('common.loading')));
      get(`/admin/serials/${item.id}/history`).then((res) => {
        historyEl.replaceChildren(...res.items.map(historyItem));
      }).catch(() => historyEl.replaceChildren());

      const saveBtn = h('button.btn.primary', { type: 'submit' }, icon('check', 17), t('common.save'));
      return h('form.modal-body', {
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          Object.values(fields).forEach((fl) => fl.setError(''));
          const payload = { jalaliDate: date.input.value, ...Object.fromEntries(TEXT_FILTERS.map((f) => [f, inputs[f].value])) };
          let bad = false;
          for (const f of ['productModel', 'serialNumber']) {
            if (!payload[f].trim()) { fields[f].setError(t('err.REQUIRED', { field: t(`f.${f}`) })); bad = true; }
          }
          if (!parseJalali(payload.jalaliDate)) { fields.jalaliDate.setError(t('err.INVALID_DATE')); bad = true; }
          if (bad) return;
          withBusy(saveBtn, async () => {
            try {
              await patch(`/admin/serials/${item.id}`, payload);
              toast(t('adm.updated'), 'success');
              close(true);
              load();
              ctx.refreshStats();
            } catch (err) {
              if (err.errors) for (const [f, code] of Object.entries(err.errors)) fields[f]?.setError(errorText(code, { field: t(`f.${f}`) }));
              else toast(errorText(err.code), 'error');
            }
          });
        },
      },
      modalHeader(t('adm.edit.title', { id: num(item.id) }), close),
      h('div.meta-card',
        userCell(item.user),
        h('p.small.muted', t('adm.edit.registered', {
          name: item.user.fullName, username: item.user.username, date: reg.date, time: reg.time, source: t(`src.${item.source}`),
        })),
        edit ? h('p.small.muted', t('adm.edit.edited', { name: item.updatedBy.fullName, date: edit.date, time: edit.time })) : null),
      h('div.form-grid', fields.jalaliDate, fields.productModel, fields.salesPanel, fields.orderCode, fields.productCode, fields.serialNumber),
      h('details.history', h('summary', icon('clock', 16), t('adm.edit.history')), historyEl),
      h('div.modal-actions.split',
        h('button.btn.ghost.danger-text', {
          type: 'button', onclick: async () => { if (await deleteSerial(item)) close(true); },
        }, icon('trash', 16), t('common.delete')),
        h('div.modal-actions',
          h('button.btn.subtle', { type: 'button', onclick: () => close(false) }, t('common.cancel')),
          saveBtn)));
    }, { className: 'lg' });
  }

  load();
}

function historyItem(a) {
  const at = fmtInstant(a.at);
  const changes = a.details?.changes ? Object.entries(a.details.changes) : [];
  return h('li',
    h('div.tl-head', h('strong', describe(a)), h('span.muted.small', `${at.date} · ${at.time}`)),
    changes.length ? h('ul.changes', changes.map(([k, [from, to]]) => h('li',
      h('span.muted', `${t(DB_FIELD_LABEL[k] || k)}: `),
      h('del', { dir: 'auto' }, from || '—'), ' → ', h('ins', { dir: 'auto' }, to || '—')))) : null);
}

export function describe(a) {
  const d = a.details || {};
  const actor = a.actor?.fullName || d.actorName || (a.action === 'user.register' ? d.username : null) || t('act.system');
  const sn = d.serialNumber || d.snapshot?.serialNumber || `#${a.entityId}`;
  const key = `act.${a.action}`;
  const vars = { actor, sn, user: d.username || '', role: d.to ? t(`users.role.${d.to}`) : '' };
  const text = t(key, vars);
  return text === key ? t('act.other', { actor, action: a.action }) : text;
}

// ================================================================ Users

function usersTab(body, ctx) {
  let status = ctx.state.pendingUsers ? 'pending' : '';
  const seg = h('div.seg');
  const list = h('div.user-grid', skeletonRows(3));
  const addBtn = h('button.btn.primary', { type: 'button', onclick: () => addUser() }, icon('plus', 17), h('span', t('users.add')));
  body.append(h('section.card', h('div.toolbar', seg, h('div.toolbar-actions.end', addBtn)), list));

  async function load() {
    try {
      const res = await get(`/admin/users${qs({ status })}`);
      ctx.setPending(res.counts.pending || 0);
      const total = Object.entries(res.counts).filter(([k]) => k !== 'removed').reduce((a, [, b]) => a + b, 0);
      seg.replaceChildren(...[['', total], ...['pending', 'approved', 'rejected', 'disabled', 'removed'].map((s) => [s, res.counts[s] || 0])].map(([s, n]) => h(`button.seg-btn${s === status ? '.active' : ''}`, {
        type: 'button', onclick: () => { status = s; load(); },
      }, h('span', s ? t(`users.status.${s}`) : t('common.all')), h('span.seg-count', num(n)))));
      list.replaceChildren(...(res.items.length ? res.items.map(userCard) : [emptyState('users', t('users.empty'))]));
    } catch (err) {
      list.replaceChildren(h('div.alert.alert-error', icon('alert', 18), h('span', errorText(err.code))));
    }
  }

  function userCard(u) {
    const self = u.id === ctx.state.user.id;
    const act = async (changes, btn) => withBusy(btn, async () => {
      try {
        await patch(`/admin/users/${u.id}`, changes);
        toast(t('users.updated'), 'success');
        load();
        ctx.refreshStats();
      } catch (err) { toast(errorText(err.code), 'error'); }
    });
    const btn = (cls, iconName, label, onclick) => {
      const b = h(`button.btn.sm.${cls}`, { type: 'button' }, icon(iconName, 15), h('span', label));
      b.addEventListener('click', () => onclick(b));
      return b;
    };
    const actions = [];
    const removed = u.status === 'removed';
    if (!self && !removed) {
      if (u.status === 'pending') {
        actions.push(btn('primary', 'userCheck', t('users.approve'), (b) => act({ status: 'approved' }, b)));
        actions.push(btn('subtle', 'userX', t('users.reject'), (b) => act({ status: 'rejected' }, b)));
      } else if (u.status === 'approved') {
        actions.push(btn('subtle', 'ban', t('users.disable'), (b) => act({ status: 'disabled' }, b)));
        actions.push(btn('subtle', 'shield', u.role === 'admin' ? t('users.removeAdmin') : t('users.makeAdmin'), async (b) => {
          if (u.role !== 'admin' && !(await confirmDialog({ title: t('users.makeAdmin'), message: t('users.makeAdminConfirm', { name: u.fullName }), iconName: 'shield' }))) return;
          act({ role: u.role === 'admin' ? 'user' : 'admin' }, b);
        }));
      } else {
        actions.push(btn('primary', 'userCheck', u.status === 'disabled' ? t('users.enable') : t('users.approve'), (b) => act({ status: 'approved' }, b)));
      }
      actions.push(btn('ghost', 'key', t('users.resetPassword'), () => resetPassword(u)));
    }
    actions.push(btn('ghost', 'activity', t('users.viewActivity'), () => ctx.navigate(`/admin/activity?userId=${u.id}`)));
    if (u.serialCount) actions.push(btn('ghost', 'barcode', t('users.viewSerials'), () => ctx.navigate(`/admin/serials?userId=${u.id}`)));
    if (!self && !removed) {
      actions.push(btn('ghost.danger-text', 'trash', t('users.remove'), async () => {
        const ok = await confirmDialog({
          title: t('users.removeTitle', { name: u.fullName }),
          message: u.serialCount ? t('users.removeKeepBody', { n: num(u.serialCount) }) : t('users.removeBody'),
          confirmText: t('users.remove'), danger: true, iconName: 'trash',
        });
        if (!ok) return;
        try {
          const r = await del(`/admin/users/${u.id}`);
          toast(r.keptSerials ? t('users.removedKept', { n: num(r.keptSerials) }) : t('users.removed'), 'success', 4000);
          load();
          ctx.refreshStats();
        } catch (err) { toast(errorText(err.code), 'error', 5000); }
      }));
    }

    const last = u.lastLoginAt ? fmtInstant(u.lastLoginAt) : null;
    return h(`article.user-card.status-${u.status}`,
      h('div.user-card-head',
        avatar(u.fullName, 44),
        h('div.grow',
          h('div.user-name', u.fullName, self ? h('span.badge', t('common.you')) : null),
          h('div.user-handle', { dir: 'ltr' }, `@${u.username}`)),
        h('div.badges',
          h(`span.badge.status.${u.status}`, t(`users.status.${u.status}`)),
          u.role === 'admin' ? h('span.badge.role', t('users.role.admin')) : null)),
      h('ul.user-meta',
        u.phone ? h('li', { dir: 'ltr' }, icon('info', 14), localDigits(u.phone)) : null,
        h('li', icon('calendar', 14), t('users.joined', { date: fmtDate(u.createdJalali) })),
        h('li', icon('clock', 14), last ? t('users.lastLogin', { date: last.date }) : t('users.never')),
        h('li', icon('barcode', 14), t('users.serials', { n: num(u.serialCount) }))),
      actions.length ? h('div.user-actions', actions) : null);
  }

  function addUser() {
    openModal((close) => {
      const inputs = {
        fullName: h('input.input', { type: 'text', autocomplete: 'off' }),
        username: h('input.input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: false, dir: 'ltr' }),
        phone: h('input.input', { type: 'tel', dir: 'ltr', autocomplete: 'off' }),
        password: h('input.input', { type: 'text', autocomplete: 'new-password', dir: 'ltr' }),
      };
      const labels = { fullName: 'auth.fullName', username: 'auth.username', phone: 'auth.phone', password: 'auth.password' };
      const fields = {
        fullName: field({ label: t(labels.fullName), input: inputs.fullName, required: true }),
        username: field({ label: t(labels.username), input: inputs.username, hint: t('auth.usernameHint'), required: true }),
        phone: field({ label: t(labels.phone), input: inputs.phone }),
        password: field({ label: t(labels.password), input: inputs.password, hint: t('auth.passwordHint'), required: true }),
      };
      const roleSelect = h('select.input',
        h('option', { value: 'user' }, t('users.role.userDesc')),
        h('option', { value: 'admin' }, t('users.role.adminDesc')));
      const save = h('button.btn.primary', { type: 'submit' }, icon('plus', 16), t('users.add'));
      setTimeout(() => inputs.fullName.focus(), 50);
      return h('form.modal-body', {
        novalidate: true,
        onsubmit: (e) => {
          e.preventDefault();
          Object.values(fields).forEach((f) => f.setError(''));
          const data = { ...Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])), role: roleSelect.value };
          let bad = false;
          for (const k of ['fullName', 'username', 'password']) if (!data[k].trim()) { fields[k].setError(t('err.REQUIRED', { field: t(labels[k]) })); bad = true; }
          if (!bad && data.password.length < 8) { fields.password.setError(t('err.PASSWORD_TOO_SHORT')); bad = true; }
          if (bad) return;
          withBusy(save, async () => {
            try {
              await post('/admin/users', data);
              toast(t('users.added'), 'success');
              close(true);
              status = '';
              load();
              ctx.refreshStats();
            } catch (err) {
              if (err.errors) for (const [k, code] of Object.entries(err.errors)) fields[k]?.setError(errorText(code, { field: t(labels[k]) }));
              else toast(errorText(err.code), 'error');
            }
          });
        },
      },
      modalHeader(t('users.addTitle'), close, t('users.addHint')),
      h('div.form-grid', fields.fullName, fields.username, fields.phone, fields.password),
      field({ label: t('users.role'), input: roleSelect }),
      h('div.modal-actions', h('button.btn.subtle', { type: 'button', onclick: () => close(false) }, t('common.cancel')), save));
    });
  }

  function resetPassword(u) {
    openModal((close) => {
      const input = h('input.input', { type: 'text', autocomplete: 'new-password', dir: 'ltr', minlength: 8 });
      const f = field({ label: t('users.newPassword'), input, hint: t('auth.passwordHint'), required: true });
      const save = h('button.btn.primary', { type: 'submit' }, t('common.save'));
      setTimeout(() => input.focus(), 50);
      return h('form.modal-body', {
        onsubmit: (e) => {
          e.preventDefault();
          if (input.value.length < 8) return f.setError(t('err.PASSWORD_TOO_SHORT'));
          withBusy(save, async () => {
            try {
              await post(`/admin/users/${u.id}/password`, { password: input.value });
              toast(t('users.resetDone'), 'success');
              close(true);
            } catch (err) { f.setError(errorText(err.code)); }
          });
        },
      },
      modalHeader(t('users.resetTitle', { name: u.fullName }), close),
      f,
      h('div.modal-actions', h('button.btn.subtle', { type: 'button', onclick: () => close(false) }, t('common.cancel')), save));
    }, { className: 'sm' });
  }

  load();
}

// ================================================================ Activity

const ACT_ICONS = {
  create: 'plus', update: 'pencil', delete: 'trash', register: 'user', approved: 'userCheck', rejected: 'userX', disabled: 'ban',
  role: 'shield', password_reset: 'key', created: 'userCheck', removed: 'userX', pending: 'clock',
};

export function activityItem(a) {
  const at = fmtInstant(a.at);
  const kind = a.action.split('.')[1];
  return h(`li.act.act-${kind}`,
    h('span.act-icon', icon(ACT_ICONS[kind] || 'info', 15)),
    h('div.grow', h('div', describe(a)), h('div.muted.small', `${at.date} · ${at.time}`)));
}

function activityTab(body, ctx) {
  let page = 1;
  let userId = ctx.params.get('userId') || '';
  const list = h('ol.activity');
  const more = h('button.btn.subtle.block', { type: 'button', hidden: true, onclick: () => { page += 1; load(); } }, t('act.loadMore'));
  const userSelect = h('select.input', {
    'aria-label': t('f.registeredBy'),
    onchange: (e) => { userId = e.target.value; page = 1; history.replaceState(null, '', `#/admin/activity${userId ? `?userId=${userId}` : ''}`); load(); },
  }, h('option', { value: '' }, t('adm.anyUser')));
  body.append(h('section.card', h('div.toolbar', h('div.act-filter', icon('users', 17), userSelect)), list, more));
  list.append(skeletonRows(6));
  get('/admin/users?includeRemoved=1').then((res) => {
    userSelect.append(...res.items.map((u) => h('option', { value: u.id, selected: String(u.id) === String(userId) }, `${u.fullName} (@${u.username})`)));
  }).catch(() => {});

  async function load() {
    try {
      const res = await get(`/admin/activity${qs({ page, userId })}`);
      if (page === 1) list.replaceChildren();
      if (!res.total) list.append(emptyState('activity', t('act.empty')));
      for (const a of res.items) list.append(activityItem(a));
      more.hidden = page * res.pageSize >= res.total;
    } catch (err) {
      list.replaceChildren(h('div.alert.alert-error', icon('alert', 18), h('span', errorText(err.code))));
    }
  }
  load();
}
