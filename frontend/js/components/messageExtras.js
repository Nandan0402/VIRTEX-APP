/**
 * messageExtras.js — 📎 files and 📊 polls for the Messages pages (admin, trainer, member).
 * Shared by admin-messages.html, trainer-messages.js and member-messages.js. API: /api/v1/messages/* (migration 034).
 *
 *   tools(form, threadId, onPosted)  adds "📎 File" and "📊 Poll" buttons to a compose form
 *   decorate(root, threadId)         adds attachments and polls under the matching message bubbles ([data-mid])
 *
 * Messages bubbles must carry data-mid="<message public id>". Files are downloaded with the signed-in token
 * (never by public URL). All text from the server is escaped before it is shown.
 */
const API = '/api/v1/messages';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = () => { try { return localStorage.getItem('virtex_admin_jwt_token') || ''; } catch { return ''; } };
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv';
const ICON = (t) => (/pdf/.test(t) ? '📕' : /word|msword/.test(t) ? '📘' : /sheet|excel|csv/.test(t) ? '📗' : /presentation|powerpoint/.test(t) ? '📙' : /^image\//.test(t) ? '🖼️' : '📄');
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function call(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw Object.assign(new Error(j.error || `Request failed (${res.status})`), { status: res.status });
  return j;
}

function toast(msg, error = false) {
  const n = document.createElement('div'); n.setAttribute('role', 'status');
  n.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:10001;padding:.7rem 1rem;border-radius:10px;font:700 .88rem system-ui,sans-serif;background:${error ? '#7f1d1d' : '#064e3b'};color:#fff;border:1px solid ${error ? '#ef4444' : '#10b981'}`;
  n.textContent = msg; document.body.appendChild(n); setTimeout(() => n.remove(), 3500);
}

function addStyle() {
  if (document.getElementById('mx-style')) return;
  const s = document.createElement('style'); s.id = 'mx-style';
  s.textContent = `
  .mx-tools { display: flex; gap: 6px; flex-wrap: wrap; flex: 0 0 100%; width: 100%; }
  form:has(> .mx-tools) { flex-wrap: wrap; }
  .mm-bubble[hidden], .tm-bubble[hidden], .ms-bubble[hidden] { display: none !important; }
  .mx-tool { background: transparent; border: 1px solid rgba(255,255,255,.16); color: #cbd5e1; border-radius: 999px; padding: 4px 12px; font: 700 .76rem inherit; font-family: inherit; cursor: pointer; }
  .mx-tool:hover { color: #fff; border-color: rgba(0,230,118,.6); } .mx-tool:disabled { opacity: .5; cursor: wait; }
  .mx-file { display: flex; align-items: center; gap: .55rem; margin-top: 6px; padding: .5rem .65rem; border-radius: 10px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); color: #e5e7eb; cursor: pointer; font: inherit; font-size: .84rem; text-align: left; max-width: 340px; width: 100%; }
  .mx-file:hover { border-color: rgba(0,230,118,.55); } .mx-file b { display: block; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
  .mx-file small { color: #94a3b8; font-size: .72rem; } .mx-file .mx-ico { font-size: 1.4rem; }
  .mx-img { display: block; margin-top: 6px; max-width: 260px; max-height: 220px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); cursor: zoom-in; }
  .mx-poll { margin-top: 6px; padding: .7rem .8rem; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.14); max-width: 380px; width: 100%; display: grid; gap: .45rem; }
  .mx-poll h4 { margin: 0; font-size: .92rem; color: #fff; } .mx-poll small { color: #94a3b8; font-size: .72rem; }
  .mx-opt { position: relative; overflow: hidden; display: flex; justify-content: space-between; gap: .5rem; align-items: center; padding: .45rem .6rem; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: transparent; color: #e5e7eb; font: inherit; font-size: .84rem; cursor: pointer; text-align: left; }
  .mx-opt:disabled { cursor: default; } .mx-opt .mx-bar { position: absolute; inset: 0 auto 0 0; background: rgba(0,230,118,.14); z-index: 0; transition: width .3s; }
  .mx-opt span { position: relative; z-index: 1; } .mx-opt.on { border-color: #00e676; color: #fff; } .mx-opt.on .mx-mk { color: #00e676; }
  .mx-poll-foot { display: flex; justify-content: space-between; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .mx-link { background: none; border: 0; color: #94a3b8; font: inherit; font-size: .74rem; cursor: pointer; text-decoration: underline; padding: 0; }
  .mx-back { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .mx-box { width: min(460px, 100%); background: #13161f; border: 1px solid rgba(255,255,255,.14); border-radius: 16px; padding: 1.2rem 1.3rem; display: grid; gap: .7rem; color: #e5e7eb; font-family: inherit; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
  .mx-box h3 { margin: 0; color: #fff; font-size: 1.08rem; } .mx-box label { display: grid; gap: 4px; font-size: .78rem; font-weight: 700; color: #94a3b8; }
  .mx-box input[type=text] { background: #0b0d14; border: 1px solid rgba(255,255,255,.14); color: #fff; border-radius: 9px; padding: .5rem .6rem; font: inherit; font-size: .9rem; }
  .mx-box .mx-row { display: flex; gap: .4rem; } .mx-box .mx-row input { flex: 1; }
  .mx-box .mx-x { background: none; border: 1px solid rgba(255,255,255,.14); color: #94a3b8; border-radius: 8px; cursor: pointer; width: 34px; }
  .mx-box .mx-check { display: flex; align-items: center; gap: .45rem; font-weight: 600; color: #cbd5e1; }
  .mx-acts { display: flex; justify-content: flex-end; gap: .5rem; } .mx-err { color: #fca5a5; font-size: .82rem; margin: 0; } .mx-err:empty { display: none; }
  .mx-btn { border-radius: 10px; padding: .5rem 1rem; font: 700 .86rem inherit; font-family: inherit; cursor: pointer; border: 1px solid rgba(255,255,255,.18); background: transparent; color: #fff; }
  .mx-btn.go { background: #00e676; border-color: #00e676; color: #04130a; }`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- compose tools

function pollBuilder() {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'mx-back';
    back.innerHTML = `<form class="mx-box" role="dialog" aria-modal="true" aria-labelledby="mx-pt" novalidate>
      <h3 id="mx-pt">📊 New poll</h3>
      <label>Question<input type="text" name="q" maxlength="200" placeholder="e.g. Which day for the Sunday hike?" required></label>
      <div class="mx-opts" aria-label="Options"></div>
      <button type="button" class="mx-link" data-add>+ Add option</button>
      <label class="mx-check"><input type="checkbox" name="multi"> People can pick more than one</label>
      <p class="mx-err" role="alert"></p>
      <div class="mx-acts"><button type="button" class="mx-btn" data-cancel>Cancel</button><button type="submit" class="mx-btn go">Post poll</button></div></form>`;
    const form = back.querySelector('form'); const box = back.querySelector('.mx-opts');
    const addOpt = (val = '') => {
      if (box.children.length >= 10) return;
      const row = document.createElement('div'); row.className = 'mx-row';
      row.innerHTML = `<input type="text" maxlength="100" placeholder="Option ${box.children.length + 1}" aria-label="Option ${box.children.length + 1}" value="${esc(val)}"><button type="button" class="mx-x" aria-label="Remove option">×</button>`;
      box.appendChild(row);
    };
    addOpt(); addOpt();
    const done = (v) => { document.removeEventListener('keydown', key); back.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') done(null); };
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-cancel]')) return done(null);
      if (e.target.closest('[data-add]')) { addOpt(); box.lastElementChild.querySelector('input').focus(); }
      const x = e.target.closest('.mx-x'); if (x && box.children.length > 2) x.parentElement.remove();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.q.value.trim(); const options = [...box.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
      const err = form.querySelector('.mx-err');
      if (q.length < 2) { err.textContent = 'Write the question.'; return; }
      if (new Set(options).size < 2) { err.textContent = 'Give at least 2 different options.'; return; }
      done({ question: q, options, multiple: form.multi.checked });
    });
    document.addEventListener('keydown', key); document.body.appendChild(back); form.q.focus();
  });
}

export function tools(form, threadId, onPosted) {
  if (!form || !threadId) return;
  addStyle();
  form.querySelector('.mx-tools')?.remove();
  const bar = document.createElement('div'); bar.className = 'mx-tools';
  bar.innerHTML = `<button type="button" class="mx-tool" data-mx="file" title="Attach a PDF, Word, Excel, PowerPoint, image or text file (max 5 MB)">📎 File</button>
    <button type="button" class="mx-tool" data-mx="poll" title="Ask a question with options people can vote on">📊 Poll</button>
    <input type="file" accept="${ACCEPT}" hidden aria-label="Choose a file to send">`;
  form.prepend(bar);
  const input = bar.querySelector('input[type=file]');
  const busy = (on) => bar.querySelectorAll('button').forEach((b) => { b.disabled = on; });
  bar.querySelector('[data-mx=file]').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const f = input.files[0]; input.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Files can be at most 5 MB.', true); return; }
    busy(true);
    try {
      const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
      const caption = form.querySelector('textarea')?.value.trim() || '';
      await call(`/${encodeURIComponent(threadId)}/attachments`, { method: 'POST', body: JSON.stringify({ fileName: f.name, data, caption }) });
      if (caption) { const ta = form.querySelector('textarea'); ta.value = ''; ta.dispatchEvent(new Event('input')); }
      toast(`📎 ${f.name} sent.`); cache.delete(threadId); await onPosted?.();
    } catch (e) { toast(e.status === 503 ? 'Files need a database update (migration 034).' : e.message, true); }
    finally { busy(false); }
  });
  bar.querySelector('[data-mx=poll]').addEventListener('click', async () => {
    const p = await pollBuilder(); if (!p) return;
    busy(true);
    try { await call(`/${encodeURIComponent(threadId)}/polls`, { method: 'POST', body: JSON.stringify(p) }); toast('📊 Poll posted.'); cache.delete(threadId); await onPosted?.(); }
    catch (e) { toast(e.status === 503 ? 'Polls need a database update (migration 034).' : e.message, true); }
    finally { busy(false); }
  });
}

// ---------------------------------------------------------------- show files + polls in the conversation

const cache = new Map();   // threadId → { at, data }
const blobUrls = new Map(); // fileId → object URL (images)

async function fetchFile(id, inline) {
  const res = await fetch(`${API}/files/${encodeURIComponent(id)}${inline ? '?inline=1' : ''}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not open the file.');
  return res.blob();
}
async function download(id, name) {
  try {
    const b = await fetchFile(id, false); const url = URL.createObjectURL(b);
    const a = Object.assign(document.createElement('a'), { href: url, download: name }); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) { toast(e.message, true); }
}

function pollHtml(p) {
  const voted = p.options.some((o) => o.mine);
  const show = voted || p.closed;
  return `<div class="mx-poll" data-poll="${esc(p.id)}" data-multi="${p.multiple ? 1 : 0}">
    <h4>📊 ${esc(p.question)}</h4><small>${p.closed ? 'Poll closed' : p.multiple ? 'Pick one or more' : 'Pick one'}${show ? '' : ' · results show after you vote'}</small>
    ${p.options.map((o) => { const pct = p.totalVoters ? Math.round((o.votes / p.totalVoters) * 100) : 0; return `<button type="button" class="mx-opt${o.mine ? ' on' : ''}" data-opt="${esc(o.id)}" aria-pressed="${o.mine}" ${p.closed ? 'disabled' : ''}>
      <i class="mx-bar" style="width:${show ? pct : 0}%"></i><span><b class="mx-mk">${o.mine ? (p.multiple ? '☑' : '◉') : (p.multiple ? '☐' : '○')}</b> ${esc(o.label)}</span>${show ? `<span>${o.votes} · ${pct}%</span>` : ''}</button>`; }).join('')}
    <div class="mx-poll-foot"><small>${p.totalVoters} vote${p.totalVoters === 1 ? '' : 's'}${voted ? ' · ✓ you voted' : ''}</small>
      <span>${voted && !p.closed ? '<button type="button" class="mx-link" data-unvote>Take back my vote</button> ' : ''}${p.mine && !p.closed ? '<button type="button" class="mx-link" data-close-poll>Close poll</button>' : ''}</span></div></div>`;
}

export async function decorate(root, threadId) {
  if (!root || !threadId) return;
  addStyle();
  const bubbles = root.querySelectorAll('[data-mid]');
  if (!bubbles.length) return;
  let entry = cache.get(threadId);
  if (!entry || entry.n !== bubbles.length || Date.now() - entry.at > 15000) {
    try { entry = { at: Date.now(), n: bubbles.length, data: (await call(`/${encodeURIComponent(threadId)}/extras`)).data }; cache.set(threadId, entry); }
    catch { return; }   // feature not available (e.g. migration 034 missing) — leave messages as they are
  }
  const { attachments = {}, polls = {} } = entry.data;
  for (const li of root.querySelectorAll('[data-mid]')) {
    li.querySelector('.mx-extra')?.remove();
    const mid = li.dataset.mid; const files = attachments[mid]; const poll = polls[mid];
    if (!files && !poll) continue;
    const box = document.createElement('div'); box.className = 'mx-extra';
    box.innerHTML = (files || []).map((f) => (/^image\//.test(f.type)
      ? `<img class="mx-img" data-img="${esc(f.id)}" alt="${esc(f.name)}" title="${esc(f.name)} — click to download">`
      : `<button type="button" class="mx-file" data-file="${esc(f.id)}" data-name="${esc(f.name)}" title="Download ${esc(f.name)}"><span class="mx-ico" aria-hidden="true">${ICON(f.type)}</span><span><b>${esc(f.name)}</b><small>${size(f.size)} · tap to download</small></span></button>`)).join('')
      + (poll ? pollHtml(poll) : '');
    const bubble = li.querySelector('.mm-bubble, .tm-bubble, .ms-bubble');
    (bubble ? bubble.after(box) : li.appendChild(box));
    if (poll && bubble && /^📊 Poll:/.test(bubble.textContent.trim())) bubble.hidden = true;   // the poll card replaces the plain text
    if (files && bubble && files.some((f) => bubble.textContent.trim() === `📎 ${f.name}`)) bubble.hidden = true;   // no caption: the file card is enough
    box.querySelectorAll('[data-img]').forEach(async (img) => {
      const id = img.dataset.img;
      try { if (!blobUrls.has(id)) blobUrls.set(id, URL.createObjectURL(await fetchFile(id, true))); img.src = blobUrls.get(id); } catch { img.alt = `${img.alt} (could not load)`; }
    });
  }
  if (!root.dataset.mxBound) {
    root.dataset.mxBound = '1';
    root.addEventListener('click', async (e) => {
      const f = e.target.closest('[data-file]'); if (f) { download(f.dataset.file, f.dataset.name); return; }
      const im = e.target.closest('[data-img]'); if (im) { download(im.dataset.img, im.alt); return; }
      const pollEl = e.target.closest('[data-poll]'); if (!pollEl) return;
      const pid = pollEl.dataset.poll; const tid = root.dataset.mxThread;
      const ent = cache.get(tid); const poll = ent && Object.values(ent.data.polls || {}).find((p) => p.id === pid); if (!poll) return;
      let ids = null;
      const opt = e.target.closest('[data-opt]');
      if (opt) {
        const mine = poll.options.filter((o) => o.mine).map((o) => o.id);
        ids = poll.multiple ? (mine.includes(opt.dataset.opt) ? mine.filter((x) => x !== opt.dataset.opt) : [...mine, opt.dataset.opt]) : [opt.dataset.opt];
      } else if (e.target.closest('[data-unvote]')) ids = [];
      try {
        let r;
        if (e.target.closest('[data-close-poll]')) r = await call(`/polls/${encodeURIComponent(pid)}/close`, { method: 'POST', body: '{}' });
        else if (ids) r = await call(`/polls/${encodeURIComponent(pid)}/vote`, { method: 'POST', body: JSON.stringify({ optionIds: ids }) });
        else return;
        Object.assign(poll, r.data);
        pollEl.outerHTML = pollHtml(poll);
      } catch (ex) { toast(ex.message, true); }
    });
  }
  root.dataset.mxThread = threadId;
}
