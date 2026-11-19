/** Virtex Trainer Hub — trainer-messages.html: 1-to-1 conversations with your clients and with the gym team.
 *  Uses: GET  /api/v1/trainer/messages/threads            (my client threads + unread counts)
 *        GET  /api/v1/trainer/messages/threads/:id        (history; marks the other side's messages read)
 *        POST /api/v1/trainer/messages/threads/:id        (reply — client threads only while the member is still my client)
 *        POST /api/v1/trainer/messages/threads            (open a thread with one of my clients)
 *        GET  /api/v1/trainer/messages/gym                (my conversation with the gym team, if any)
 *        POST /api/v1/trainer/messages/gym                (start / reopen it)
 *        GET  /api/v1/trainer/clients                     (assigned clients I can start a chat with)
 *  Client threads are the same ones the member sees on member-messages.html; the gym-team thread is the
 *  one owners/managers answer on admin-messages.html (Trainers tab).
 */
import { api, ApiError } from './trainer-api.js';
import * as MX from '../components/messageExtras.js';   // 📎 files + 📊 polls
import { initShell, esc, dash, fmtDateTime, renderError, toast, qp, pageHref } from './trainer-navigation.js';

const shell = await initShell({ page: 'messages', title: 'Messages', subtitle: 'Chat 1-to-1 with your clients and the gym team' });
const time = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

if (shell) {
  const { content } = shell;
  let threads = []; let gym = { available: false }; let clients = []; let current = null; let busy = false; let draft = '';

  async function loadLists() {
    const [t, g, c] = await Promise.all([
      api.get('/messages/threads'),
      api.get('/messages/gym').catch(() => ({ data: { available: false } })),
      api.get('/clients', { limit: 100 }).catch(() => ({ data: [] })),
    ]);
    threads = t.data || []; gym = g.data || { available: false };
    const seen = new Set(threads.map((x) => x.member_id));
    clients = (c.data || []).filter((r) => ['active', 'paused'].includes(r.assignment_status))
      .filter((r) => (seen.has(r.member_id) ? false : seen.add(r.member_id)));
  }

  const sec = (title) => `<div class="tm-sec">${esc(title)}</div>`;
  // Role tags (names come from PostgreSQL via the API): Admin / Trainer / Member
  const ROLE_TAG = { staff: ['Admin', 'admin'], admin: ['Admin', 'admin'], trainer: ['Trainer', 'trainer'], member: ['Member', 'member'] };
  const tag = (role) => { const t = ROLE_TAG[role]; return t ? `<span class="tm-role tm-role-${t[1]}">${t[0]}</span>` : ''; };

  function listHtml() {
    let html = '';
    if (gym.available) {
      const g = gym.thread;
      html += sec('Gym team') + (g
        ? `<button type="button" class="tp-row tm-row${current?.id === g.id ? ' is-on' : ''}" data-open="${esc(g.id)}">
            <div class="tp-avatar tm-av-gym">V</div>
            <div class="tp-row-main"><div class="tp-row-title">${esc(gym.name)} ${tag('admin')}</div>
            <div class="tp-row-sub">${g.lastMessage ? `${g.lastMessage.fromMe ? 'You: ' : ''}${esc(g.lastMessage.preview)}` : esc(gym.specialty)}</div></div>
            ${g.unread ? `<span class="badge badge-green">${g.unread} unread</span>` : ''}</button>`
        : `<button type="button" class="tp-row tm-row tm-new" data-start-gym="1"><div class="tp-avatar tm-av-gym">+</div>
            <div class="tp-row-main"><div class="tp-row-title">Message ${esc(gym.name)} ${tag('admin')}</div><div class="tp-row-sub">${esc(gym.specialty)}</div></div></button>`);
    }
    html += sec('Clients') + (threads.length ? threads.map((t) => `<button type="button" class="tp-row tm-row${current?.id === t.public_id ? ' is-on' : ''}" data-open="${esc(t.public_id)}">
          <div class="tp-avatar">${esc((t.member_name || '?').slice(0, 1).toUpperCase())}</div>
          <div class="tp-row-main"><div class="tp-row-title">${esc(t.member_name)} ${tag('member')} <span class="tp-muted">${dash(t.member_code)}</span></div>
          <div class="tp-row-sub">Last message ${fmtDateTime(t.last_message_at || t.created_at)}</div></div>
          ${t.unread_count ? `<span class="badge badge-green">${t.unread_count} unread</span>` : ''}</button>`).join('')
      : '<p class="tp-muted tm-none">No client conversations yet.</p>');
    if (clients.length) {
      html += sec('Start a chat') + clients.map((r) => `<button type="button" class="tp-row tm-row tm-new" data-start-member="${Number(r.member_id)}">
          <div class="tp-avatar">+</div>
          <div class="tp-row-main"><div class="tp-row-title">${esc(r.full_name)} ${tag('member')} <span class="tp-muted">${dash(r.member_code)}</span></div>
          <div class="tp-row-sub">Your client · ${esc(r.assignment_status)}</div></div></button>`).join('');
    }
    return `<div class="tp-list">${html}</div>`;
  }

  function viewHtml() {
    if (!current) return '<div class="card tm-thread tm-empty"><p class="tp-muted">Select a conversation.</p></div>';
    const isGym = current.type === 'trainer_gym';
    const head = isGym
      ? `<b>${esc(current.counterpart.name)}</b> ${tag('admin')} <span class="tp-muted">${esc(current.counterpart.specialty)}</span>`
      : `<b>${esc(current.member.name)}</b> ${tag('member')} <span class="tp-muted">${dash(current.member.code)}</span>
         <a class="tp-muted tm-profile" href="${pageHref('trainer-client-profile.html', { memberId: current.member.id })}">Client profile ›</a>`;
    const msgs = current.messages.map((m) => `<li class="tm-msg ${m.mine ? 'mine' : 'theirs'}" data-mid="${esc(m.id)}">${m.mine ? '' : `<span class="tm-from">${esc(m.senderName || '')} ${tag(m.senderRole)}</span>`}<div class="tm-bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
          <small>${esc(time(m.sentAt))}${m.mine ? ` · ${m.readAt ? '✓✓ read' : '✓ sent'}` : ''}</small></li>`).join('');
    const who = isGym ? current.counterpart.name : current.member.name;
    return `<div class="card tm-thread"><div class="tm-head">${head}</div>
        <ol class="tm-msgs" id="tm-msgs">${msgs || '<li class="tp-muted">No messages yet — say hello.</li>'}</ol>
        ${current.canReply ? `<form class="tm-compose" id="tm-form"><label class="sr-only" for="tm-body">Message</label><textarea id="tm-body" rows="2" maxlength="4000" placeholder="Message ${esc(who)}…">${esc(draft)}</textarea>
          <button class="btn btn-green" type="submit">Send</button></form><small class="tp-muted tm-hint">Ctrl + Enter to send</small>`
        : `<p class="tp-muted tm-ro">${isGym ? 'This conversation has been closed by the gym team.' : 'This member is no longer your client — read-only.'}</p>`}</div>`;
  }

  function render() {
    content.innerHTML = `<div class="tm-grid"><div class="card tm-list">${listHtml()}</div>${viewHtml()}</div>`;
    content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
    content.querySelectorAll('[data-start-member]').forEach((b) => b.addEventListener('click', () => start(() => api.post('/messages/threads', { memberId: Number(b.dataset.startMember) }))));
    content.querySelector('[data-start-gym]')?.addEventListener('click', () => start(() => api.post('/messages/gym', {})));
    const f = content.querySelector('#tm-form');
    if (f) {
      const ta = f.querySelector('#tm-body');
      ta.addEventListener('input', () => { draft = ta.value; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = draft.trim(); if (!body || busy) return;
        busy = true;
        try { await api.post(`/messages/threads/${encodeURIComponent(current.id)}`, { body }); draft = ''; await open(current.id); }
        catch (err) { toast(err instanceof ApiError ? err.message : 'Could not send — your message is kept.', { error: true }); }
        finally { busy = false; }
      });
    }
    const box = content.querySelector('#tm-msgs'); if (box) box.scrollTop = box.scrollHeight;
    if (current && box) {   // 📎 files + 📊 polls
      const id = current.id;
      MX.tools(content.querySelector('#tm-form'), id, () => open(id));
      MX.decorate(box, id).then(() => { box.scrollTop = box.scrollHeight; });
    }
  }

  async function open(id) {
    try {
      current = (await api.get(`/messages/threads/${encodeURIComponent(id)}`)).data;
      await loadLists();
      history.replaceState(null, '', pageHref('trainer-messages.html', { thread: id }));
      render(); content.querySelector('#tm-body')?.focus();
    } catch (err) { toast(err instanceof ApiError ? err.message : 'Could not open the conversation.', { error: true }); }
  }
  async function start(fn) {
    if (busy) return; busy = true;
    try { const r = (await fn()).data; draft = ''; await open(r.id); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Could not start the conversation.', { error: true }); }
    finally { busy = false; }
  }

  content.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
  try {
    // Opened from a client profile: ?memberId= → open (or create) that client's thread.
    const memberId = qp('memberId');
    if (memberId) { const r = (await api.post('/messages/threads', { memberId: Number(memberId) })).data; await open(r.id); }
    else {
      await loadLists();
      const want = qp('thread');
      if (want) await open(want); else render();
    }
    // Light refresh while the page is open: new replies and read receipts.
    setInterval(async () => {
      if (busy || document.visibilityState !== 'visible' || document.activeElement?.id === 'tm-body') return;
      try { await loadLists(); if (current) current = (await api.get(`/messages/threads/${encodeURIComponent(current.id)}`)).data; render(); } catch { /* keep current view */ }
    }, 30000);
  } catch (err) {
    renderError(content, err, 'Messages');
  }
}
