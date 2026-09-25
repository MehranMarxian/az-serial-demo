import { get, qs } from '../api.js';
import { errorText, t } from '../i18n.js';
import { h, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { skeletonRows } from '../components.js';
import { activityItem } from './admin.js';

// User Panel: the signed-in person's own actions only.
export function mount(main) {
  let page = 1;
  const list = h('ol.activity', skeletonRows(5));
  const more = h('button.btn.subtle.block', { type: 'button', hidden: true, onclick: () => { page += 1; load(); } }, t('act.loadMore'));
  main.append(h('div.page',
    h('section.page-head', h('div', h('h1', t('nav.myActivity')), h('p.muted', t('act.mine.subtitle')))),
    h('section.card', list, more)));

  async function load() {
    try {
      const res = await get(`/me/activity${qs({ page })}`);
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
