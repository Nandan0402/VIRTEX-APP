/** Virtex Member Portal — member-announcements.html.
 *  Uses: GET /api/v1/member/announcements — active announcements published by the gym (for everyone or in
 *  my language), upcoming events (Events & Competitions) and classes the gym has cancelled.
 *        POST/DELETE /api/v1/member/announcements/:id/vote — vote on (or take back my vote on) a poll announcement.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'announcements', title: 'Announcements', subtitle: 'Gym notices, events and schedule changes' });

const SECTIONS = [
  ['poll', '📊', 'Polls'], ['important', '⚠️', 'Important updates'], ['notice', '📌', 'Gym notices'], ['event', '🏆', 'Events'], ['schedule', '🗓️', 'Schedule changes'],
];
const dDate = (d) => new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dTime = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

if (shell) {
  const { content } = shell;
  let data = null; let filter = 'all';

  const picks = {}; // multiple-choice polls: choices ticked but not yet submitted
  function pollHtml(a) {
    const p = a.poll; const voted = p.myOptionIds.length > 0;
    const sel = picks[a.id] || new Set(p.myOptionIds);
    const opts = p.options.map((o) => {
      const pct = p.totalVoters ? Math.round((o.votes / p.totalVoters) * 100) : 0;
      const on = p.multiple ? sel.has(o.id) : o.mine;
      return `<li><button type="button" class="pl-opt${on ? ' on' : ''}" data-poll="${a.id}" data-opt="${o.id}" aria-pressed="${on}">
          <span class="pl-bar" style="width:${voted ? pct : 0}%"></span>
          <span class="pl-mark" aria-hidden="true">${p.multiple ? (on ? '☑' : '☐') : (on ? '◉' : '○')}</span>
          <span class="pl-label">${esc(o.label)}</span>
          ${voted ? `<span class="pl-count">${o.votes} · ${pct}%</span>` : ''}</button></li>`;
    }).join('');
    const changed = p.multiple && picks[a.id] && [...picks[a.id]].sort().join() !== [...p.myOptionIds].sort().join();
    return `<div class="pl-box" role="group" aria-label="Vote: ${esc(a.title)}">
        <p class="pl-hint">${p.multiple ? 'Pick every option you are interested in.' : 'Pick one option.'}${voted ? '' : ' Results show after you vote.'}</p>
        <ul class="pl-list">${opts}</ul>
        <div class="pl-foot"><small>${p.totalVoters} member${p.totalVoters === 1 ? '' : 's'} voted${voted ? ' · ✓ you voted' : ''}</small>
          ${p.multiple && (!voted || changed) ? `<button type="button" class="btn btn-green pl-submit" data-submit="${a.id}" ${changed && sel.size ? '' : 'disabled'}>${voted ? 'Update vote' : 'Submit vote'}</button>` : ''}
          ${voted ? `<button type="button" class="btn btn-outline pl-undo" data-undo="${a.id}">Take back my vote</button>` : ''}</div>
      </div>`;
  }
  const SPORT_TAG = { indoor_sport: '🏟️ Indoor sport', outdoor_sport: '🌳 Outdoor sport' };
  const annItem = (a) => `<li class="an-item an-${esc(a.category)}"><b>${esc(a.title)}</b>${a.sport ? ` <span class="an-sport">${SPORT_TAG[a.sport]}</span>` : ''}<p>${esc(a.message).replace(/\n/g, '<br>')}</p>
      ${a.poll ? pollHtml(a) : ''}
      <small>Posted ${esc(dDate(a.postedAt))} · shown until ${esc(dDate(a.endDate))}</small></li>`;

  let busy = false;
  async function vote(id, optionIds) {
    if (busy) return; busy = true;
    try {
      const poll = optionIds === null
        ? (await api.del(`/announcements/${id}/vote`)).data
        : (await api.post(`/announcements/${id}/vote`, { optionIds })).data;
      const a = data.announcements.find((x) => x.id === id); if (a) a.poll = poll;
      delete picks[id];
    } catch (e) { alert(e instanceof ApiError ? e.message : 'Could not save your vote — please try again.'); }
    finally { busy = false; render(); }
  }

  function section(key) {
    const anns = data.announcements.filter((a) => a.category === key);
    let extra = '';
    if (key === 'event' && data.events.length) {
      extra = data.events.map((e) => `<li class="an-item an-event"><b>${esc(e.title)}</b><p>${esc(e.type)} · ${esc(dDate(e.startDate))}${e.endDate && e.endDate !== e.startDate ? ` – ${esc(dDate(e.endDate))}` : ''}${e.status === 'in_progress' ? ' · in progress' : ''}</p>
        <small><a href="member-events.html">See event &amp; register</a></small></li>`).join('');
    }
    if (key === 'schedule' && data.scheduleChanges.length) {
      extra = data.scheduleChanges.map((c) => `<li class="an-item an-schedule${c.youWereBooked ? ' an-mine' : ''}"><b>Cancelled: ${esc(c.title)}</b>
        <p>${esc(dTime(c.scheduledAt))} · ${c.type === 'live' ? 'live online class' : 'class at the gym'}${c.youWereBooked ? ' · <strong>you were booked</strong>' : ''}</p>
        <small><a href="member-classes.html">View timetable</a></small></li>`).join('');
    }
    if (!anns.length && !extra) return '';
    const [, icon, label] = SECTIONS.find(([k]) => k === key);
    return `<section class="pg-card"><h2 class="pg-h">${icon} ${esc(label)}</h2><ul class="an-list">${anns.map(annItem).join('')}${extra}</ul></section>`;
  }

  function render() {
    const counts = Object.fromEntries(SECTIONS.map(([k]) => [k, data.announcements.filter((a) => a.category === k).length + (k === 'event' ? data.events.length : 0) + (k === 'schedule' ? data.scheduleChanges.length : 0)]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const body = (filter === 'all' ? SECTIONS.map(([k]) => section(k)) : [section(filter)]).join('');
    content.innerHTML = `<div class="pg-wrap">
      <div class="ac-chips" role="group" aria-label="Filter announcements">${[['all', '', 'All'], ...SECTIONS].filter(([k]) => k === 'all' || counts[k]).map(([k, i, l]) => `<button type="button" class="ac-chip${filter === k ? ' on' : ''}" data-f="${k}" aria-pressed="${filter === k}">${i} ${esc(l)} (${k === 'all' ? total : counts[k]})</button>`).join('')}</div>
      ${total ? body : '<section class="pg-card"><p class="pg-muted">No announcements right now. Gym notices, events and schedule changes appear here.</p></section>'}</div>`;
    content.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; render(); }));
    content.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.poll); const opt = Number(b.dataset.opt);
      const a = data.announcements.find((x) => x.id === id); if (!a?.poll) return;
      if (!a.poll.multiple) { if (!a.poll.myOptionIds.includes(opt)) vote(id, [opt]); return; }
      const set = picks[id] || new Set(a.poll.myOptionIds);
      if (set.has(opt)) set.delete(opt); else set.add(opt);
      picks[id] = set; render();
    }));
    content.querySelectorAll('[data-submit]').forEach((b) => b.addEventListener('click', () => { const id = Number(b.dataset.submit); vote(id, [...(picks[id] || [])]); }));
    content.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', () => vote(Number(b.dataset.undo), null)));
  }

  content.innerHTML = '<div class="mp-loading">Loading announcements…</div>';
  try { data = (await api.get('/announcements')).data; render(); }
  catch (e) { content.innerHTML = notice('Could not load announcements', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
}
