/** Virtex Member Portal — member-book-details.html: one library book.
 *  Uses: GET /api/v1/member/books/:id            (404 unless the member may see the book)
 *        GET /api/v1/member/books/:id/file       (authenticated stream — opened as a private blob, never a public URL)
 *        PUT /api/v1/member/books/:id/progress   (reading progress)
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'books', title: 'Book details', subtitle: 'Books & Library' });

const money = (p) => (p ? `${p.currency === 'INR' ? '₹' : `${esc(p.currency)} `}${Number(p.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '');
const dDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

if (shell) {
  const { content } = shell;
  const id = new URLSearchParams(location.search).get('id');
  let book = null; let flash = null; let busy = false; let blobUrl = null;

  function accessBox(b) {
    if (b.access.canRead) {
      return `<div class="bk-access ok"><b>${b.purchase ? `You bought this book on ${esc(dDate(b.purchase.purchasedAt))}` : b.vip ? 'Included with your VIP membership' : 'Included with your membership'}</b>
        <div class="bk-read-act"><button type="button" class="btn btn-green" id="bk-open">📖 Open e-book</button>
        <small>${esc(b.format)}${b.sizeMb ? ` · ${b.sizeMb} MB` : ''} · opens in a private tab, only for you</small></div></div>`;
    }
    if (b.access.reason === 'purchase_required') {
      return `<div class="bk-access"><b>${money(b.price)} — purchase required</b>
        <p>Paid books are sold at the gym reception. Once the purchase is recorded, this book opens here for you.</p></div>`;
    }
    return '<div class="bk-access"><b>An active membership is needed to read this book.</b><p>Renew your membership to read included library books.</p></div>';
  }

  function progressBox(b) {
    if (!b.access.canRead) return '';
    const p = b.progress;
    return `<section class="pg-card"><h2 class="pg-h">Reading progress</h2>
      ${p ? `<div class="cl-slots"><div class="cl-bar co-bar bk-bar"><span style="width:${p.pct}%"></span></div><small>${p.completed ? '✓ Finished' : `${p.pct}%`} · page ${p.currentPage} of ${p.totalPages} · last read ${esc(dDate(p.lastReadAt))}</small></div>`
        : '<p class="pg-muted">Not started yet.</p>'}
      <form id="bk-prog" class="bk-prog">
        <label class="mm-field"><span>Page you're on (of ${b.pages || '?'})</span><input type="number" name="currentPage" min="0" max="${b.pages || 0}" step="1" value="${p ? p.currentPage : ''}" required></label>
        <label class="mm-field bk-notes"><span>Notes <i>optional</i></span><textarea name="notes" rows="2" maxlength="1000">${esc(p?.notes || '')}</textarea></label>
        <div class="bk-prog-act"><button type="submit" class="btn btn-green">Save progress</button>${b.pages ? '<button type="button" class="btn btn-outline" id="bk-done">Mark as finished</button>' : ''}</div>
        <p class="mm-err" id="bk-err" role="alert"></p>
      </form></section>`;
  }

  function render() {
    const b = book;
    content.innerHTML = `<div class="pg-wrap">${flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      <p><a class="btn btn-outline co-back" href="member-books.html">‹ All books</a></p>
      <section class="pg-card bk-head">
        <div class="bk-cover" aria-hidden="true">📘<span>${esc(b.format)}</span></div>
        <div class="bk-info">
          <span class="cl-group">${esc(b.category)}${b.vip ? ' · VIP' : ''}${b.archived ? ' · no longer in the catalogue' : ''}</span>
          <h2 class="co-title">${esc(b.title)}</h2>
          <p class="cl-meta">by ${esc(b.author)}${b.pages ? ` · ${b.pages} pages` : ''} · ${esc(b.format)} e-book</p>
          ${b.description ? `<p class="co-desc">${esc(b.description).replace(/\n/g, '<br>')}</p>` : ''}
          ${accessBox(b)}
          ${b.purchase ? `<p class="pg-muted">Invoice <code>${esc(b.purchase.invoice)}</code> · <a href="member-books.html?tab=purchases">Purchase history</a></p>` : ''}
        </div>
      </section>
      ${progressBox(b)}</div>`;
    content.querySelector('#bk-open')?.addEventListener('click', openBook);
    const f = content.querySelector('#bk-prog');
    f?.addEventListener('submit', (ev) => { ev.preventDefault(); saveProgress(f.currentPage.value, f.notes.value); });
    content.querySelector('#bk-done')?.addEventListener('click', () => saveProgress(String(b.pages), f.notes.value));
  }

  async function openBook(ev) {
    if (busy) return;
    const btn = ev.target; busy = true; btn.disabled = true; btn.textContent = 'Opening…';
    // Open the tab first (inside the click) so pop-up blockers allow it, then load the private file into it.
    const win = window.open('', '_blank');
    try {
      const blob = await api.blob(`/books/${encodeURIComponent(book.id)}/file`);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(blob);
      if (win) win.location.href = blobUrl;
      else { const a = document.createElement('a'); a.href = blobUrl; a.download = `${book.title}.${book.format.toLowerCase()}`; a.click(); }
      flash = null;
    } catch (e) {
      if (win) win.close();
      flash = { text: e instanceof ApiError ? e.message : 'Could not open the book — please try again.', error: true };
      render(); return;
    } finally { busy = false; }
    btn.disabled = false; btn.textContent = '📖 Open e-book';
  }

  async function saveProgress(pageRaw, notes) {
    if (busy) return;
    const err = content.querySelector('#bk-err');
    const page = Number(pageRaw);
    if (!Number.isInteger(page) || page < 0 || (book.pages && page > book.pages)) { err.textContent = `Enter a page from 0 to ${book.pages}.`; return; }
    busy = true;
    try {
      const r = (await api.put(`/books/${encodeURIComponent(book.id)}/progress`, { currentPage: page, notes: notes.trim() })).data;
      flash = { text: r.completed ? 'Marked as finished — well done!' : `Progress saved: page ${r.currentPage} (${r.pct}%).` };
      await load();
    } catch (e) { err.textContent = e instanceof ApiError ? e.message : 'Could not save — please try again.'; }
    finally { busy = false; }
  }

  async function load() {
    book = (await api.get(`/books/${encodeURIComponent(id)}`)).data;
    document.title = `${book.title} · Virtex Member Portal`;
    render();
  }

  window.addEventListener('pagehide', () => { if (blobUrl) URL.revokeObjectURL(blobUrl); });
  if (!/^\d+$/.test(id || '')) {
    content.innerHTML = `<div class="pg-wrap">${notice('Book not found', 'Choose a book from the library.', { error: true })}<p><a class="btn btn-outline" href="member-books.html">‹ All books</a></p></div>`;
  } else {
    content.innerHTML = '<div class="mp-loading">Loading book…</div>';
    try { await load(); }
    catch (e) {
      content.innerHTML = `<div class="pg-wrap">${notice('Book not available', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true })}<p><a class="btn btn-outline" href="member-books.html">‹ All books</a></p></div>`;
    }
  }
}
