import { get, qs } from '../api.js';
import { errorText, num, t } from '../i18n.js';
import { h, debounce, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { dataTable, fmtDate, pager, skeletonRows, sourceBadge } from '../components.js';

export function mount(main) {
  const q = { q: '', page: 1, pageSize: 20 };
  const results = h('div', skeletonRows(6));
  const search = h('input.input', {
    type: 'search', placeholder: t('hist.search'), 'aria-label': t('hist.search'),
    oninput: debounce((e) => { q.q = e.target.value; q.page = 1; load(); }, 300),
  });

  main.append(h('div.page',
    h('section.page-head', h('div', h('h1', t('hist.title')), h('p.muted', t('hist.subtitle')))),
    h('section.card',
      h('div.toolbar', h('div.search', icon('search', 18), search)),
      results)));

  let seq = 0;
  async function load() {
    const mine = ++seq;
    try {
      const res = await get(`/serials/history${qs(q)}`);
      if (mine !== seq) return;
      if (!res.total) {
        results.replaceChildren(q.q ? emptyState('search', t('common.noResults'), t('common.noResultsBody')) : emptyState('package', t('hist.empty'), t('hist.emptyBody')));
        return;
      }
      const offset = (res.page - 1) * res.pageSize;
      results.replaceChildren(
        dataTable({
          items: res.items,
          columns: [
            { label: t('f.row'), className: 'col-num', render: (_, i) => h('span.row-num', num(res.total - offset - i)) },
            { label: t('f.date'), render: (it) => h('span.nowrap', fmtDate(it.jalaliDate)) },
            { label: t('f.productModel'), className: 'col-strong', render: (it) => it.productModel },
            { label: t('f.salesPanel'), render: (it) => it.salesPanel || '—' },
            { label: t('f.orderCode'), render: (it) => h('span', { dir: 'ltr' }, it.orderCode || '—') },
            { label: t('f.productCode'), render: (it) => h('span', { dir: 'ltr' }, it.productCode || '—') },
            { label: t('f.serialNumber'), className: 'col-serial', render: (it) => h('div.serial-cell', h('span.mono', { dir: 'ltr' }, it.serialNumber), sourceBadge(it.source)) },
          ],
        }),
        pager({ ...res, onPage: (p) => { q.page = p; load(); } }));
    } catch (err) {
      results.replaceChildren(h('div.alert.alert-error', icon('alert', 18), h('span', errorText(err.code))));
    }
  }
  load();
}
