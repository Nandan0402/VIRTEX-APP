/** Virtex Member Portal — member-events.html: Events & competitions.
 *  Uses: GET  /api/v1/member/events                       (Admin Events & Competitions + my entries)
 *        GET  /api/v1/member/events/:id/leaderboard       (scores recorded by staff; other members' names masked)
 *        POST /api/v1/member/events/:id/register          (only while registration is open)
 *        POST /api/v1/member/events/:id/withdraw
 *  Admin creates events and records results; nothing on this page creates a score or a result.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'events', title: 'Events', subtitle: 'Challenges, competitions, leaderboards and results' });

const GROUPS = {
  weightlifting: ['🏋️', 'Weightlifting'], push_up: ['💪', 'Push-up challenges'], pull_up: ['🧗', 'Pull-up challenges'],
  squat: ['🦵', 'Squat challenges'], transformation: ['📈', 'Transformation'], challenge: ['🔥', 'Fitness challenges'], event: ['📅', 'Other events'],
};
const TABS = [['upcoming', 'Upcoming'], ['in_progress', 'In progress'], ['results', 'Results'], ['mine', 'My entries']];
const dDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const range = (a, b) => (a && b && a !== b ? `${dDate(a)} – ${dDate(b)}` : dDate(a));
const fmtScore = (v, u) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${u ? ` ${esc(u)}` : ''}`);

if (shell) {
  const { content } = shell;
  let data = null; let tab = 'upcoming'; let group = 'all'; let busy = false; let flash = null;
  const boards = new Map(); const openBoards = new Set();

  function chip(e) {
    if (e.registration === 'cancelled') return '<span class="cl-reg cl-reg-cancelled">Cancelled</span>';
    if (e.status === 'completed') return `<span class="cl-reg ${e.myEntry && e.myEntry.status !== 'withdrawn' ? 'cl-reg-mine' : 'cl-reg-closed'}">${e.myEntry && e.myEntry.status !== 'withdrawn' ? 'You took part' : 'Results'}</span>`;
    if (e.registration === 'registered') return '<span class="cl-reg cl-reg-mine">You are registered</span>';
    if (e.registration === 'open') return '<span class="cl-reg cl-reg-open">Registration open</span>';
    if (e.status === 'completed') return '<span class="cl-reg cl-reg-closed">Results</span>';
    if (e.status === 'in_progress') return '<span class="cl-reg ev-live">In progress</span>';
    return '<span class="cl-reg cl-reg-closed">Registration closed</span>';
  }

  function myResult(e) {
    const m = e.myEntry;
    if (!m || m.status === 'withdrawn') return m?.status === 'withdrawn' ? '<p class="ev-mine muted">You withdrew from this event.</p>' : '';
    if (m.score === null) return `<p class="ev-mine">Your entry${m.division ? ` (${esc(m.division)})` : ''} · ${e.status === 'completed' ? 'no result recorded' : 'result not recorded yet'}</p>`;
    return `<p class="ev-mine"><b>Your result: ${fmtScore(m.score, m.scoreUnit)}</b>${m.rank ? ` · Rank #${m.rank}` : ''}${m.podium ? ' · 🏅 Podium' : ''}
      <small>${m.verified ? `Verified by ${esc(m.verifiedBy || 'trainer')}` : 'Recorded by staff'}</small></p>`;
  }

  function board(e) {
    if (!openBoards.has(e.id)) return '';
    const b = boards.get(e.id);
    if (!b) return '<div class="ev-board"><p class="pg-muted">Loading leaderboard…</p></div>';
    if (b.error) return `<div class="ev-board"><p class="mm-err">${esc(b.error)}</p></div>`;
    if (!b.entries.length) return '<div class="ev-board"><p class="pg-muted">No results recorded yet. The leaderboard fills in as staff record scores.</p></div>';
    return `<div class="ev-board"><table class="admin-table ev-tbl"><thead><tr><th>#</th><th>Member</th><th>Division</th><th>Score</th><th></th></tr></thead><tbody>
      ${b.entries.map((r) => `<tr class="${r.isMe ? 'is-me' : ''}"><td>${r.rank ?? '—'}${r.podium ? ' 🏅' : ''}</td><td>${esc(r.name)}</td><td>${esc(r.division || '—')}</td>
        <td><b>${fmtScore(r.score, r.scoreUnit)}</b></td><td><small>${r.verified ? '✓ verified' : 'recorded'}</small></td></tr>`).join('')}
      </tbody></table><small class="pg-muted">Scores are recorded by gym staff. Other members are shown by first name and initial.</small></div>`;
  }

  function card(e) {
    const [icon, label] = GROUPS[e.group] || GROUPS.event;
    const showBoard = e.scoredEntries > 0 || e.status !== 'upcoming';
    return `<article class="oc-vod ev-card${e.registration === 'cancelled' ? ' is-cancelled' : ''}" id="ev-${e.id}">
      <div class="oc-vod-top"><span class="cl-group">${icon} ${esc(e.type || label)}</span>${chip(e)}</div>
      <h3>${esc(e.title)}</h3>
      <p class="cl-meta">📅 ${esc(range(e.startDate, e.endDate))}${e.registration === 'open' ? ` · register by ${esc(dDate(e.registrationClosesOn))}` : ''}</p>
      ${e.description ? `<p class="cl-desc co-clamp">${esc(e.description)}</p>` : ''}
      <p class="cl-meta ev-facts">${e.metric ? `📏 ${esc(e.metric)} · ` : ''}${e.prize ? `🎁 ${esc(e.prize)} · ` : ''}👥 ${e.entrants} entered${e.organizer ? ` · Organiser ${esc(e.organizer)}` : ''}</p>
      ${e.rules ? `<details class="co-notes"><summary>Rules</summary><p>${esc(e.rules).replace(/\n/g, '<br>')}</p></details>` : ''}
      ${myResult(e)}
      ${e.certificate ? `<p class="ev-cert">🎓 Certificate issued${e.certificate.award ? `: ${esc(e.certificate.award)}` : ''} · <a href="member-achievements.html">View in Achievements</a></p>` : ''}
      <div class="ev-act">
        ${e.canRegister ? `<button type="button" class="btn btn-green" data-reg="${e.id}">Register</button>` : ''}
        ${e.canWithdraw ? `<button type="button" class="btn btn-outline" data-wd="${e.id}">Withdraw</button>` : ''}
        ${showBoard ? `<button type="button" class="btn btn-outline" data-board="${e.id}" aria-expanded="${openBoards.has(e.id)}">${openBoards.has(e.id) ? 'Hide leaderboard' : `Leaderboard${e.scoredEntries ? ` (${e.scoredEntries})` : ''}`}</button>` : ''}
      </div>${board(e)}</article>`;
  }

  function pick() {
    const ev = data.events;
    const byTab = {
      upcoming: ev.filter((e) => e.status === 'upcoming' && e.registration !== 'cancelled'),
      in_progress: ev.filter((e) => e.status === 'in_progress'),
      results: ev.filter((e) => e.status === 'completed'),
      mine: ev.filter((e) => e.myEntry && e.myEntry.status !== 'withdrawn'),
    };
    return { byTab, list: byTab[tab].filter((e) => group === 'all' || e.group === group) };
  }

  function render() {
    const { byTab, list } = pick();
    const groupsHere = [...new Set(byTab[tab].map((e) => e.group))];
    if (group !== 'all' && !groupsHere.includes(group)) group = 'all';
    const empty = { upcoming: 'No upcoming events right now. New challenges and competitions appear here when the gym announces them.', in_progress: 'No events are running right now.', results: 'No results have been published yet.', mine: 'You have not entered any events yet.' }[tab];
    content.innerHTML = `<div class="pg-wrap">${flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      <section class="pg-card">
        <div class="ac-chips" role="tablist" aria-label="Events">${TABS.map(([k, l]) => `<button type="button" role="tab" class="ac-chip${tab === k ? ' on' : ''}" aria-selected="${tab === k}" data-tab="${k}">${esc(l)} (${byTab[k].length})</button>`).join('')}</div>
        ${groupsHere.length > 1 ? `<div class="ac-chips ev-groups" role="group" aria-label="Event type">${['all', ...Object.keys(GROUPS).filter((g) => groupsHere.includes(g))].map((g) => `<button type="button" class="ac-chip${group === g ? ' on' : ''}" data-group="${g}" aria-pressed="${group === g}">${g === 'all' ? 'All types' : `${GROUPS[g][0]} ${esc(GROUPS[g][1])}`}</button>`).join('')}</div>` : ''}
        ${list.length ? `<div class="oc-grid ev-grid">${list.map(card).join('')}</div>` : `<p class="pg-muted">${esc(empty)}</p>`}
        <p class="pg-foot">Events, scores and results are managed by the gym. Registration closes on the date shown (the day before the event if no deadline is set).</p>
      </section></div>`;
    content.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; group = 'all'; flash = null; render(); }));
    content.querySelectorAll('[data-group]').forEach((b) => b.addEventListener('click', () => { group = b.dataset.group; render(); }));
    content.querySelectorAll('[data-reg]').forEach((b) => b.addEventListener('click', () => act(b, 'register')));
    content.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => act(b, 'withdraw')));
    content.querySelectorAll('[data-board]').forEach((b) => b.addEventListener('click', () => toggleBoard(Number(b.dataset.board))));
  }

  async function toggleBoard(id) {
    if (openBoards.has(id)) { openBoards.delete(id); render(); return; }
    openBoards.add(id); render();
    try { boards.set(id, (await api.get(`/events/${id}/leaderboard`)).data); }
    catch (e) { boards.set(id, { error: e instanceof ApiError ? e.message : 'Could not load the leaderboard.' }); }
    render();
    document.getElementById(`ev-${id}`)?.querySelector('[data-board]')?.focus();
  }

  async function act(btn, kind) {
    if (busy) return;
    const id = Number(btn.dataset.reg || btn.dataset.wd);
    const e = data.events.find((x) => x.id === id);
    if (kind === 'withdraw' && !confirm(`Withdraw from "${e?.title || 'this event'}"?`)) return;
    busy = true; btn.disabled = true;
    try {
      await api.post(`/events/${id}/${kind}`, {});
      flash = { text: kind === 'register' ? `You're registered for ${e?.title || 'the event'}.` : `You have withdrawn from ${e?.title || 'the event'}.` };
    } catch (err) { flash = { text: err instanceof ApiError ? err.message : 'Something went wrong — please try again.', error: true }; }
    finally { busy = false; boards.delete(id); await load(); }
  }

  async function load() {
    try { data = (await api.get('/events')).data; render(); }
    catch (e) { content.innerHTML = notice('Could not load events', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
  }

  content.innerHTML = '<div class="mp-loading">Loading events…</div>';
  await load();
}
