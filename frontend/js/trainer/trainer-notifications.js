/** Virtex Trainer Hub — trainer-notifications.html page logic.
 *  1. Gym announcements & polls from the admin (GET /api/v1/trainer/announcements) — trainers can vote here.
 *  2. The trainer's own notification inbox (GET /api/v1/trainer/notifications, Trainer Hub migration 009).
 */
import { api, ApiError } from './trainer-api.js';
import { initShell, esc, fmtDateTime, emptyState, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'notifications', title: 'Notifications', subtitle: 'Gym announcements, polls and your alerts', requireProfile: false });

const CATEGORY = { indoor_sport: '🏟️ Indoor sport', outdoor_sport: '🌳 Outdoor sport', event: '🏆 Event', fitness: '💪 Fitness' };

if (shell) {
  const { content } = shell;
  content.innerHTML = `
    <section class="card tn-section" aria-labelledby="tn-ann-h">
      <div class="tn-head"><h2 id="tn-ann-h">📢 Gym announcements &amp; polls</h2><span class="tp-muted" id="tn-ann-count"></span></div>
      <div id="tn-ann"><div class="tp-muted tp-loading">Loading…</div></div>
    </section>
    <section class="tn-section" aria-labelledby="tn-inbox-h">
      <div class="tn-head"><h2 id="tn-inbox-h">🔔 Your alerts</h2>
        <label class="tp-muted"><input type="checkbox" id="unread"> Unread only</label></div>
      <div id="list"></div>
    </section>`;
  const list = content.querySelector('#list');
  const annBox = content.querySelector('#tn-ann');
  let data = { announcements: [], canVote: false };
  const picks = {};
  let busy = false;

  function pollHtml(a) {
    const p = a.poll; const voted = p.myOptionIds.length > 0;
    const sel = picks[a.id] || new Set(p.myOptionIds);
    const changed = p.multiple && picks[a.id] && [...picks[a.id]].sort().join() !== [...p.myOptionIds].sort().join();
    return `<div class="tn-poll">
      <p class="tp-muted tn-hint">${p.multiple ? 'Pick every option you are interested in.' : 'Pick one option.'}${voted ? '' : ' Results show after you vote.'}</p>
      <ul class="tn-opts">${p.options.map((o) => {
        const pct = p.totalVoters ? Math.round((o.votes / p.totalVoters) * 100) : 0;
        const on = p.multiple ? sel.has(o.id) : o.mine;
        return `<li><button type="button" class="tn-opt${on ? ' on' : ''}" data-poll="${a.id}" data-opt="${o.id}" aria-pressed="${on}" ${data.canVote ? '' : 'disabled'}>
          <span class="tn-bar" style="width:${voted ? pct : 0}%"></span>
          <span class="tn-mark" aria-hidden="true">${p.multiple ? (on ? '☑' : '☐') : (on ? '◉' : '○')}</span>
          <span class="tn-label">${esc(o.label)}</span>${voted ? `<span class="tn-count">${o.votes} · ${pct}%</span>` : ''}</button></li>`;
      }).join('')}</ul>
      <div class="tn-foot"><span class="tp-muted">${p.totalVoters} vote${p.totalVoters === 1 ? '' : 's'}${voted ? ' · ✓ you voted' : ''}</span>
        ${p.multiple && data.canVote && (!voted || changed) ? `<button type="button" class="btn btn-green" data-submit="${a.id}" ${changed && sel.size ? '' : 'disabled'}>${voted ? 'Update vote' : 'Submit vote'}</button>` : ''}
        ${voted && data.canVote ? `<button type="button" class="btn btn-outline" data-undo="${a.id}">Take back my vote</button>` : ''}</div>
    </div>`;
  }

  function renderAnnouncements() {
    const rows = data.announcements || [];
    content.querySelector('#tn-ann-count').textContent = rows.length ? `${rows.length} active` : '';
    if (!rows.length) { annBox.innerHTML = emptyState('No announcements', 'Notices and polls from the gym admin appear here.'); return; }
    annBox.innerHTML = `<ul class="tn-anns">${rows.map((a) => {
      const needsVote = a.poll && !a.poll.myOptionIds.length && data.canVote;
      return `<li class="tn-ann${needsVote ? ' tn-needs' : ''}">
        <div class="tn-ann-top"><b>${a.poll ? '📊 ' : ''}${esc(a.title)}</b>
          ${CATEGORY[a.category] ? `<span class="tp-chip">${CATEGORY[a.category]}</span>` : ''}
          ${a.audience === 'trainers' ? '<span class="tp-chip">Trainers only</span>' : ''}
          ${needsVote ? '<span class="tn-new">Vote now</span>' : ''}</div>
        <p class="tn-msg">${esc(a.message).replace(/\n/g, '<br>')}</p>
        ${a.poll ? pollHtml(a) : ''}
        <small class="tp-muted">Posted ${esc(fmtDateTime(a.postedAt))}</small>
      </li>`;
    }).join('')}</ul>${data.canVote ? '' : '<p class="tp-muted tn-hint">Voting is available to trainers.</p>'}`;
  }

  async function loadAnnouncements() {
    try { data = (await api.get('/announcements')).data; renderAnnouncements(); }
    catch (err) { annBox.innerHTML = `<p class="tp-muted">Announcements could not be loaded: ${esc(err.message || 'network error')}</p>`; }
  }

  async function vote(id, optionIds) {
    if (busy) return; busy = true;
    try {
      const poll = optionIds === null ? (await api.del(`/announcements/${id}/vote`)).data : (await api.post(`/announcements/${id}/vote`, { optionIds })).data;
      const a = data.announcements.find((x) => x.id === id); if (a) a.poll = poll;
      delete picks[id];
      toast(optionIds === null ? 'Vote removed.' : 'Vote saved.');
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not save your vote.', { error: true }); }
    finally { busy = false; renderAnnouncements(); }
  }

  annBox.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      const id = Number(opt.dataset.poll); const o = Number(opt.dataset.opt);
      const a = data.announcements.find((x) => x.id === id); if (!a?.poll) return;
      if (!a.poll.multiple) { if (!a.poll.myOptionIds.includes(o)) vote(id, [o]); return; }
      const set = picks[id] || new Set(a.poll.myOptionIds);
      if (set.has(o)) set.delete(o); else set.add(o);
      picks[id] = set; renderAnnouncements(); return;
    }
    const sub = e.target.closest('[data-submit]'); if (sub) { const id = Number(sub.dataset.submit); vote(id, [...(picks[id] || [])]); return; }
    const undo = e.target.closest('[data-undo]'); if (undo) vote(Number(undo.dataset.undo), null);
  });

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const rows = (await api.get('/notifications', { unread: content.querySelector('#unread').checked ? 'true' : undefined })).data;
      if (!rows.length) { list.innerHTML = emptyState('No alerts', 'You are all caught up.'); return; }
      list.innerHTML = `<div class="card"><div class="tp-list">${rows.map((n) => `<div class="tp-row${n.read_at ? ' tp-read' : ''}">
        <div class="tp-row-main"><div class="tp-row-title">${esc(n.title)} <span class="tp-chip">${esc(n.type)}</span></div>
        ${n.body ? `<div class="tp-notif-body">${esc(n.body)}</div>` : ''}
        <div class="tp-row-sub">${fmtDateTime(n.created_at)}</div></div>
        ${n.link_url && n.link_url.startsWith('/') ? `<a class="btn btn-outline" href="${esc(n.link_url)}">Open</a>` : ''}
        ${n.read_at ? '' : `<button class="btn btn-outline" data-id="${esc(n.public_id)}">Mark read</button>`}</div>`).join('')}</div></div>`;
      list.querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', async () => {
        try { await api.patch(`/notifications/${encodeURIComponent(b.dataset.id)}/read`); window.dispatchEvent(new Event('tp:notifications-changed')); load(); }
        catch (err) { toast(err.message, { error: true }); }
      }));
    } catch (err) {
      // The alert inbox needs Trainer Hub migration 009; announcements above still work without it.
      list.innerHTML = `<p class="tp-muted">${err?.status === 503 || /migration|not available|pending/i.test(err?.message || '') ? 'Personal alerts are not switched on yet.' : `Alerts could not be loaded: ${esc(err?.message || 'network error')}`}</p>`;
    }
  }
  content.querySelector('#unread').addEventListener('change', load);
  loadAnnouncements();
  load();
}
