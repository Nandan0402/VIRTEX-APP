/** Virtex Member Portal — member-books.html: Books & Library.
 *  Uses: GET /api/v1/member/books — only books this member may see (never staff-only or drafts;
 *  VIP books only for VIP members), plus the member's own purchase records and reading progress.
 *  Books are added and sold by the gym in the Admin Books & Library module. No file URL is shown here.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'books', title: 'Books & Library', subtitle: 'Fitness, anatomy and nutrition e-books' });

const BOOK_GROUPS = { fitness: ['🏋️', 'Fitness'], anatomy: ['🦴', 'Anatomy'], nutrition: ['🥗', 'Nutrition'], science: ['🔬', 'Exercise science'], rules: ['📋', 'Gym rules'], other: ['📘', 'Other'] };
const money = (p) => (p ? `${p.currency === 'INR' ? '₹' : `${esc(p.currency)} `}${Number(p.amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '');
const dDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
function accessChip(b) {
  if (b.purchase) return '<span class="cl-reg cl-reg-mine">Purchased</span>';
  if (b.access.canRead) return `<span class="cl-reg cl-reg-open">${b.vip ? 'VIP · included' : 'Included'}</span>`;
  if (b.access.reason === 'purchase_required') return `<span class="cl-reg cl-reg-full">${money(b.price)}</span>`;
  return '<span class="cl-reg cl-reg-closed">Membership needed</span>';
}

if (shell) {
  const { content } = shell;
  let data = null; let tab = 'catalogue'; let group = 'all'; let fmt = 'all'; let q = '';
  try { const t = new URLSearchParams(location.search).get('tab'); if (['catalogue', 'mine', 'purchases'].includes(t)) tab = t; } catch { /* ignore */ }

  const card = (b) => `<a class="oc-vod bk-card" href="member-book-details.html?id=${b.id}">
      <div class="oc-vod-top"><span class="cl-group">${BOOK_GROUPS[b.group][0]} ${esc(b.category)}</span>${accessChip(b)}</div>
      <h3>${esc(b.title)}</h3><p class="cl-meta">by ${esc(b.author)}</p>
      ${b.summary ? `<p class="cl-desc co-clamp">${esc(b.summary)}</p>` : ''}
      <p class="cl-meta bk-facts">📄 ${esc(b.format)} e-book${b.pages ? ` · ${b.pages} pages` : ''}${b.archived ? ' · no longer in the catalogue' : ''}</p>
      ${b.progress ? `<div class="cl-slots"><div class="cl-bar co-bar"><span style="width:${b.progress.pct}%"></span></div><small>${b.progress.completed ? 'Finished' : `${b.progress.pct}% · page ${b.progress.currentPage}`}</small></div>` : ''}
    </a>`;

  function catalogue() {
    const groups = [...new Set(data.books.map((b) => b.group))];
    const formats = [...new Set(data.books.map((b) => b.format))];
    const s = q.trim().toLowerCase();
    const list = data.books.filter((b) => (group === 'all' || b.group === group) && (fmt === 'all' || b.format === fmt)
      && (!s || `${b.title} ${b.author} ${b.category}`.toLowerCase().includes(s)));
    return `<div class="cl-head"><input type="search" id="bk-q" class="co-search" placeholder="Search title or author" value="${esc(q)}" aria-label="Search books"></div>
      ${groups.length > 1 ? `<div class="ac-chips" role="group" aria-label="Category">${['all', ...Object.keys(BOOK_GROUPS).filter((g) => groups.includes(g))].map((g) => `<button type="button" class="ac-chip${group === g ? ' on' : ''}" data-g="${g}" aria-pressed="${group === g}">${g === 'all' ? 'All categories' : `${BOOK_GROUPS[g][0]} ${BOOK_GROUPS[g][1]}`}</button>`).join('')}</div>` : ''}
      ${formats.length > 1 ? `<div class="ac-chips" role="group" aria-label="E-book format">${['all', ...formats].map((f) => `<button type="button" class="ac-chip${fmt === f ? ' on' : ''}" data-f="${esc(f)}" aria-pressed="${fmt === f}">${f === 'all' ? 'All e-books' : esc(f)}</button>`).join('')}</div>` : ''}
      ${list.length ? `<div class="oc-grid">${list.map(card).join('')}</div>` : `<p class="pg-muted">${data.books.length ? 'No books match.' : 'No books are available to you yet. Books appear here when the gym adds them to the library.'}</p>`}`;
  }
  function mine() {
    const list = data.books.filter((b) => b.access.canRead);
    const reading = list.filter((b) => b.progress && !b.progress.completed);
    return `${reading.length ? `<h3 class="cl-day">Continue reading</h3><div class="oc-grid">${reading.map(card).join('')}</div>` : ''}
      <h3 class="cl-day">Books you can read (${list.length})</h3>
      ${list.length ? `<div class="oc-grid">${list.map(card).join('')}</div>` : `<p class="pg-muted">${data.membershipActive ? 'No books are available to read yet.' : 'An active membership is needed to read included books. Books you have bought stay available.'}</p>`}`;
  }
  function purchases() {
    if (!data.purchases.length) return '<p class="pg-muted">No book purchases on record. Paid books are sold at the gym; your purchases appear here once recorded.</p>';
    return `<div class="pg-scroll"><table class="admin-table pg-tbl"><thead><tr><th>Date</th><th>Book</th><th>Invoice</th><th>Amount</th><th>Paid by</th></tr></thead><tbody>
      ${data.purchases.map((p) => `<tr><td>${esc(dDate(p.purchasedAt))}</td><td><a href="member-book-details.html?id=${p.book.id}">${esc(p.book.title)}</a><small class="pg-sub">${esc(p.book.author)}</small></td>
        <td><code>${esc(p.invoice)}</code></td><td>${money({ amount: p.amount, currency: p.currency })}</td><td>${esc(p.method)}</td></tr>`).join('')}
      </tbody></table></div><p class="pg-foot">From the gym's purchase records.</p>`;
  }

  function render() {
    const TABS = [['catalogue', `Catalogue (${data.books.length})`], ['mine', `My books (${data.books.filter((b) => b.access.canRead).length})`], ['purchases', `Purchase history (${data.purchases.length})`]];
    content.innerHTML = `<div class="pg-wrap">
      ${!data.membershipActive ? notice('Membership not active', 'Included library books need an active membership. Books you have bought remain available.') : ''}
      <section class="pg-card"><div class="ac-chips" role="tablist" aria-label="Library">${TABS.map(([k, l]) => `<button type="button" role="tab" class="ac-chip${tab === k ? ' on' : ''}" aria-selected="${tab === k}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
        ${{ catalogue, mine, purchases }[tab]()}</section></div>`;
    content.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
    content.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { group = b.dataset.g; render(); }));
    content.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { fmt = b.dataset.f; render(); }));
    const s = content.querySelector('#bk-q');
    s?.addEventListener('input', () => { q = s.value; render(); const n = content.querySelector('#bk-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  }

  content.innerHTML = '<div class="mp-loading">Loading the library…</div>';
  try { data = (await api.get('/books')).data; render(); }
  catch (e) { content.innerHTML = notice('Could not load the library', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
}
