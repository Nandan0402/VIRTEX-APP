/** Virtex Trainer Hub — trainer-general.html: your GENERAL-training members and their times.
 *  The admin gives each member a general trainer and a time (Admin → Training Times). Personal-training
 *  clients and their times are on the My Clients tab. Approved member time changes show here automatically.
 *  Data: GET /api/v1/trainer/general-members (own members only).
 */
import { api } from './trainer-api.js';
import { initShell, esc, emptyState, renderError } from './trainer-navigation.js';

const shell = await initShell({ page: 'general-members', title: 'General Training', subtitle: 'Members the admin gave you for general training, by time' });
const to12 = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

if (shell) {
  const { content } = shell;
  content.innerHTML = '<div class="card"><div id="gm"><div class="tp-muted tp-loading">Loading…</div></div></div>';
  const box = content.querySelector('#gm');
  try {
    const d = (await api.get('/general-members')).data;
    if (!d.available) { box.innerHTML = emptyState('Not switched on yet', 'General training needs a database update by the admin.'); }
    else if (!d.members.length) { box.innerHTML = emptyState('No general-training members yet', 'The admin assigns members and times to you in Admin → Training Times.'); }
    else {
      const byTime = new Map();
      for (const m of d.members) { const k = `${m.start_time}-${m.end_time}`; if (!byTime.has(k)) byTime.set(k, []); byTime.get(k).push(m); }
      box.innerHTML = [...byTime.entries()].map(([k, list]) => {
        const [s, e] = k.split('-');
        return `<section class="tg-slot"><h2>⏰ ${esc(to12(s))} – ${esc(to12(e))} <span class="tp-muted">· ${list.length} member${list.length === 1 ? '' : 's'}</span></h2>
          <ul class="tp-list">${list.map((m) => `<li class="tp-row"><div class="tp-row-main"><div class="tp-row-title">${esc(m.member_name)}
            ${m.gender === 'female' ? '<span class="tp-chip">👧 Girl</span>' : m.gender === 'male' ? '<span class="tp-chip">👦 Boy</span>' : ''}</div>
            <div class="tp-row-sub">${esc(m.member_code || '')}${m.notes ? ` · ${esc(m.notes)}` : ''}</div></div></li>`).join('')}</ul></section>`;
      }).join('');
    }
  } catch (err) { renderError(box, err, 'General training'); }
}
