/** Virtex Member Portal — member-messages.html: 1-to-1 conversations with your assigned trainer and the gym team, plus groups the gym team adds you to (members cannot create groups).
 *  Uses: GET  /api/v1/member/messages              (my threads + assigned trainers I can start a chat with)
 *        GET  /api/v1/member/messages/:threadId    (history; marks the trainer's messages read)
 *        POST /api/v1/member/messages/:threadId    (reply)
 *        POST /api/v1/member/messages              ({trainerId} → start a chat with an ASSIGNED trainer; {to:'gym'} → the gym team)
 *  The server only ever returns the signed-in member's own conversations.
 */
import { api, ApiError } from './member-api.js';
import * as MX from '../components/messageExtras.js';   // 📎 files + 📊 polls
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'messages', title: 'Messages', subtitle: 'Chat 1-to-1 with your trainer and the gym team' });

const time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d) => {
  const x = new Date(d); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (x.toDateString() === t.toDateString()) return 'Today';
  if (x.toDateString() === y.toDateString()) return 'Yesterday';
  return x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
// Role tags: who wrote a message / who a conversation is with (names come from PostgreSQL via the API).
const ROLE_TAG = { staff: ['Admin', 'admin'], admin: ['Admin', 'admin'], trainer: ['Trainer', 'trainer'], member: ['Member', 'member'], group: ['Group', 'group'] };
const tag = (role) => { const t = ROLE_TAG[role]; return t ? `<span class="ms-role ms-role-${t[1]}">${t[0]}</span>` : ''; };
const short = (d) => (new Date(d).toDateString() === new Date().toDateString() ? time(d) : new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));

if (shell) {
  const { content } = shell;
  let inbox = null; let thread = null; let busy = false; let draft = ''; let err = '';
  const qThread = () => new URLSearchParams(location.search).get('thread');
  const setThread = (id) => { history.replaceState(null, '', id ? `member-messages.html?thread=${encodeURIComponent(id)}` : 'member-messages.html'); };

  function listHtml() {
    const all = [...inbox.threads, ...(inbox.groups || [])].sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0));
    const items = all.map((t) => `<li><button type="button" class="ms-thread${thread?.id === t.id ? ' on' : ''}${t.unread ? ' unread' : ''}" data-open="${esc(t.id)}">
        <span class="ms-av${t.type === 'gym' ? ' ms-av-gym' : ''}${t.type === 'group' ? ' ms-av-group' : ''}" aria-hidden="true">${t.type === 'group' ? '#' : esc((t.trainer.name || '?').slice(0, 1))}</span>
        <span class="ms-tmain"><b>${esc(t.trainer.name)} ${tag(t.trainer.role)}</b><small>${t.lastMessage ? `${t.lastMessage.fromMe ? 'You: ' : ''}${esc(t.lastMessage.preview)}` : 'No messages yet'}</small></span>
        <span class="ms-tmeta">${t.lastMessage ? `<small>${esc(short(t.lastMessage.at))}</small>` : ''}${t.unread ? `<span class="ms-badge" aria-label="${t.unread} unread">${t.unread}</span>` : ''}</span>
      </button></li>`).join('');
    const start = inbox.trainers.map((tr) => `<li><button type="button" class="ms-thread ms-new" data-start="${tr.trainerId}"><span class="ms-av">+</span>
        <span class="ms-tmain"><b>Message ${esc(tr.name)} ${tag('trainer')}</b><small>${esc(tr.specialty || 'Your assigned trainer')}</small></span></button></li>`).join('')
      + (inbox.gym?.available && !inbox.gym.threadId ? `<li><button type="button" class="ms-thread ms-new" data-start="gym"><span class="ms-av ms-av-gym">+</span>
        <span class="ms-tmain"><b>Message ${esc(inbox.gym.name)} ${tag('admin')}</b><small>${esc(inbox.gym.specialty)}</small></span></button></li>` : '');
    return `<aside class="ms-list" aria-label="Conversations"><h2 class="pg-h">Conversations</h2>
      ${items || start ? `<ul>${items}${start}</ul>` : '<p class="pg-muted">No conversations yet.</p>'}</aside>`;
  }

  function threadHtml() {
    if (!thread) return '<section class="ms-thread-view ms-empty"><p class="pg-muted">Choose a conversation.</p></section>';
    let last = '';
    const msgs = thread.messages.map((m) => {
      const day = dayLabel(m.sentAt); const sep = day !== last ? `<li class="ms-day">${esc(day)}</li>` : ''; last = day;
      const from = m.mine ? '' : `<span class="ms-from${m.senderRole === 'staff' ? ' ms-from-staff' : ''}">${esc(m.senderName || '')} ${tag(m.senderRole)}</span>`;
      return `${sep}<li class="ms-msg ${m.mine ? 'mine' : 'theirs'}" data-mid="${esc(m.id)}">${from}<div class="ms-bubble">${esc(m.body).replace(/\n/g, '<br>')}</div>
        <small>${esc(time(m.sentAt))}${m.mine && thread.type !== 'group' ? ` · <span class="${m.readAt ? 'ms-read' : ''}" title="${m.readAt ? `Read ${new Date(m.readAt).toLocaleString()}` : 'Not read yet'}">${m.readAt ? '✓✓ Read' : '✓ Sent'}</span>` : ''}</small></li>`;
    }).join('');
    return `<section class="ms-thread-view" aria-label="Conversation with ${esc(thread.trainer.name)}">
      <header class="ms-head"><button type="button" class="btn btn-outline ms-back" id="ms-back">‹</button>
        <span class="ms-av${thread.type === 'gym' ? ' ms-av-gym' : ''}${thread.type === 'group' ? ' ms-av-group' : ''}">${thread.type === 'group' ? '#' : esc(thread.trainer.name.slice(0, 1))}</span><div><b>${esc(thread.trainer.name)} ${tag(thread.trainer.role)}</b><small>${esc(thread.trainer.specialty || 'Trainer')}</small></div></header>
      <ol class="ms-msgs" id="ms-msgs">${msgs || '<li class="ms-day">No messages yet — say hello.</li>'}</ol>
      ${thread.canReply ? `<form class="ms-compose" id="ms-form"><label class="sr-only" for="ms-body">Message</label>
          <textarea id="ms-body" rows="2" maxlength="4000" placeholder="Write a message…">${esc(draft)}</textarea>
          <button type="submit" class="btn btn-green">Send</button></form>${err ? `<p class="mm-err" role="alert">${esc(err)}</p>` : ''}<small class="ms-hint">Ctrl + Enter to send</small>`
        : `<p class="ms-readonly">${thread.type === 'gym' ? 'This conversation has been closed by the gym team.' : thread.type === 'group' ? 'This group has been closed by the gym team. You can still read it.' : 'This trainer is no longer assigned to you, so this conversation is read-only.'}</p>`}
    </section>`;
  }

  function render() {
    content.innerHTML = `<div class="pg-wrap">
      <section class="pg-card ms-shell${thread ? ' has-thread' : ''}">${listHtml()}${threadHtml()}</section></div>`;
    content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => open(b.dataset.open)));
    content.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => start(b.dataset.start === 'gym' ? 'gym' : Number(b.dataset.start))));
    content.querySelector('#ms-back')?.addEventListener('click', () => { thread = null; setThread(null); render(); });
    const f = content.querySelector('#ms-form');
    if (f) {
      const ta = f.querySelector('#ms-body');
      ta.addEventListener('input', () => { draft = ta.value; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); f.requestSubmit(); } });
      f.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    }
    const box = content.querySelector('#ms-msgs'); if (box) box.scrollTop = box.scrollHeight;
    if (thread && box) {   // 📎 files + 📊 polls
      const id = thread.id;
      MX.tools(content.querySelector('#ms-form'), id, () => open(id));
      MX.decorate(box, id).then(() => { box.scrollTop = box.scrollHeight; });
    }
  }

  async function open(id) {
    try { thread = (await api.get(`/messages/${encodeURIComponent(id)}`)).data; setThread(id); err = ''; draft = ''; inbox = (await api.get('/messages')).data; render(); content.querySelector('#ms-body')?.focus(); }
    catch (e) { thread = null; setThread(null); content.innerHTML = notice('Conversation not available', e instanceof ApiError ? e.message : 'Network error.', { error: true }); }
  }
  async function start(trainerId) {
    if (busy) return; busy = true;
    try { const r = (await api.post('/messages', trainerId === 'gym' ? { to: 'gym' } : { trainerId })).data; inbox = (await api.get('/messages')).data; await open(r.id); }
    catch (e) { err = e instanceof ApiError ? e.message : 'Could not start the conversation.'; render(); }
    finally { busy = false; }
  }
  async function send() {
    const body = draft.trim();
    if (!body || busy) return;
    busy = true; const btn = content.querySelector('#ms-form button'); if (btn) btn.disabled = true;
    try {
      await api.post(`/messages/${encodeURIComponent(thread.id)}`, { body });
      draft = ''; err = '';
      thread = (await api.get(`/messages/${encodeURIComponent(thread.id)}`)).data; inbox = (await api.get('/messages')).data;
    } catch (e) { err = e instanceof ApiError ? e.message : 'Could not send — your message is kept above.'; }
    finally { busy = false; render(); content.querySelector('#ms-body')?.focus(); }
  }

  content.innerHTML = '<div class="mp-loading">Loading messages…</div>';
  try {
    inbox = (await api.get('/messages')).data;
    if (!inbox.available) {
      content.innerHTML = `<div class="pg-wrap">${notice('Messaging is not switched on yet', 'Messaging needs a database update that the gym has not applied yet. Please speak to the front desk or your trainer in person.')}</div>`;
    } else {
      const want = qThread() || (() => { const all = [...inbox.threads, ...(inbox.groups || [])].sort((a, b) => new Date(b.lastMessage?.at || 0) - new Date(a.lastMessage?.at || 0)); return all.length && window.innerWidth > 800 ? all[0].id : null; })();
      if (want) await open(want); else render();
      // Light refresh while the page is open: new replies and read receipts.
      setInterval(async () => {
        if (busy || document.visibilityState !== 'visible' || document.activeElement?.id === 'ms-body') return;
        try { inbox = (await api.get('/messages')).data; if (thread) thread = (await api.get(`/messages/${encodeURIComponent(thread.id)}`)).data; render(); } catch { /* keep current view */ }
      }, 30000);
    }
  } catch (e) {
    content.innerHTML = notice('Could not load messages', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true });
  }
}
