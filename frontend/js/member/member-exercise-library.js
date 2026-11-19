/** Virtex Member Portal — member-exercise-library.html: browse the shared Admin Exercise Library.
 *  Data: GET /api/v1/member/exercises?category=&search=&difficulty=&page=  (read-only; no member write route exists)
 *  Images: there is no image column, so the card shows the still frame of the exercise's own demo video
 *  (YouTube thumbnail, lazy-loaded, no referrer) or a muscle-group illustration when there is no video.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({ page: 'exercise-library', title: 'Exercise Library', subtitle: 'Browse the gym’s approved exercises' });

const ICON = { chest: '🫁', back: '🔙', shoulders: '🏋️', arms: '💪', biceps: '💪', triceps: '💪', legs: '🦵', core: '🎯', abs: '🎯', 'full body': '🔥' };
const youtubeId = (url) => (typeof url === 'string' ? (url.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#].*)?$/) || [])[1] || null : null);
const safeLink = (url) => (typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null);
const DIFF = { Beginner: 'ok', Intermediate: 'warn', Advanced: 'bad' };

function art(e) {
  const yt = youtubeId(e.video_url);
  const icon = ICON[String(e.muscle_group || '').toLowerCase()] || '🏋️';
  return yt
    ? `<img class="el-img" src="https://i.ytimg.com/vi/${yt}/hqdefault.jpg" alt="${esc(e.name)} demonstration still" loading="lazy" referrerpolicy="no-referrer"
         onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'el-img el-img-icon',textContent:'${icon}'}))">`
    : `<div class="el-img el-img-icon" aria-hidden="true">${icon}</div>`;
}

function card(e, i) {
  const targets = String(e.target_muscles || '').split(/\s*,\s*/).filter(Boolean);
  return `<article class="el-card">
    <button type="button" class="el-open" data-i="${i}" aria-label="Open ${esc(e.name)}">${art(e)}${youtubeId(e.video_url) || safeLink(e.video_url) ? '<span class="el-has-video">▶ Video</span>' : ''}</button>
    <div class="el-body">
      <h2><button type="button" class="el-title" data-i="${i}">${esc(e.name)}</button></h2>
      <div class="el-tags">${e.muscle_group ? `<span class="el-chip el-chip-main">${esc(e.muscle_group)}</span>` : ''}
        ${e.difficulty ? `<span class="bl-pill bl-pill-${DIFF[e.difficulty] || 'dim'}">${esc(e.difficulty)}</span>` : ''}</div>
      <dl class="el-kv"><dt>Equipment</dt><dd>${e.equipment ? esc(e.equipment) : '—'}</dd>
        ${targets.length ? `<dt>Targets</dt><dd>${targets.map(esc).join(', ')}</dd>` : ''}</dl>
      ${e.instructions ? `<details class="el-how"><summary>Instructions</summary><p>${esc(e.instructions)}</p></details>` : '<p class="el-none">No instructions provided.</p>'}
    </div></article>`;
}

function dialog(e) {
  const yt = youtubeId(e.video_url); const link = !yt && safeLink(e.video_url);
  const d = document.getElementById('el-dialog');
  d.innerHTML = `<form method="dialog" class="el-dlg">
    <header><h2>${esc(e.name)}</h2><button class="el-x" aria-label="Close">✕</button></header>
    <div class="el-dlg-media">${yt ? `<button type="button" class="el-play" data-yt="${yt}">${art(e)}<span class="el-play-btn" aria-hidden="true">▶</span><span class="sr-only">Play demo video</span></button>`
      : link ? `<a class="el-ext" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${art(e)}<span>Open video reference ↗</span></a>` : art(e)}</div>
    <div class="el-tags">${e.muscle_group ? `<span class="el-chip el-chip-main">${esc(e.muscle_group)}</span>` : ''}${e.difficulty ? `<span class="bl-pill bl-pill-${DIFF[e.difficulty] || 'dim'}">${esc(e.difficulty)}</span>` : ''}</div>
    <dl class="el-kv"><dt>Equipment</dt><dd>${e.equipment ? esc(e.equipment) : '—'}</dd><dt>Targets</dt><dd>${e.target_muscles ? esc(e.target_muscles) : '—'}</dd>
      <dt>Video</dt><dd>${yt ? `<a href="https://www.youtube.com/watch?v=${yt}" target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>` : link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open reference ↗</a>` : 'Not available'}</dd></dl>
    <h3>Instructions</h3><p class="el-instr">${e.instructions ? esc(e.instructions) : 'No instructions provided.'}</p>
    <p class="el-note">🔒 Exercises are maintained by the gym team. Ask your trainer if you would like one added to your programme.</p>
  </form>`;
  d.querySelector('.el-play')?.addEventListener('click', (ev) => {
    const id = ev.currentTarget.dataset.yt; if (!/^[\w-]{11}$/.test(id)) return;
    const f = document.createElement('iframe');
    Object.assign(f, { className: 'el-video', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`, title: `${e.name} demo video`, allowFullscreen: true, referrerPolicy: 'strict-origin-when-cross-origin' });
    f.allow = 'autoplay; encrypted-media; picture-in-picture';
    ev.currentTarget.replaceWith(f);
  });
  d.addEventListener('close', () => { d.innerHTML = ''; }, { once: true });
  d.showModal();
}

if (shell) {
  const { content } = shell;
  const state = { category: '', search: '', difficulty: '', page: 1 };
  let rows = [];
  content.innerHTML = `
    <section class="card el-filters" aria-label="Filter exercises">
      <div class="el-search"><label class="sr-only" for="el-q">Search exercises</label>
        <input id="el-q" type="search" placeholder="Search by name, muscle or equipment…" maxlength="80" autocomplete="off">
        <label class="sr-only" for="el-diff">Difficulty</label>
        <select id="el-diff"><option value="">All levels</option><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
      <div class="el-cats" id="el-cats" role="group" aria-label="Category"></div>
    </section>
    <p class="el-result" id="el-result" aria-live="polite"></p>
    <div class="el-grid" id="el-grid"><div class="mp-muted mp-loading">Loading exercises…</div></div>
    <div class="bl-pager" id="el-pager"></div>
    <dialog id="el-dialog" class="el-dialog" aria-label="Exercise details"></dialog>`;

  async function load() {
    const grid = content.querySelector('#el-grid');
    try {
      const res = await api.get('/exercises', { category: state.category, search: state.search, difficulty: state.difficulty, page: state.page, limit: 24 });
      rows = res.data;
      content.querySelector('#el-cats').innerHTML = [{ key: '', label: 'All', count: res.totalExercises }, ...res.categories]
        .map((c) => `<button type="button" class="el-cat${state.category === c.key ? ' is-active' : ''}" data-cat="${c.key}" aria-pressed="${state.category === c.key}">${esc(c.label)} <span>${c.count}</span></button>`).join('');
      content.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.category = b.dataset.cat; state.page = 1; load(); }));
      const label = res.categories.find((c) => c.key === state.category)?.label;
      content.querySelector('#el-result').textContent = `${res.pagination.total} exercise${res.pagination.total === 1 ? '' : 's'}${label ? ` in ${label}` : ''}${state.search ? ` matching “${state.search}”` : ''}${state.difficulty ? ` · ${state.difficulty}` : ''}`;
      grid.innerHTML = rows.length ? rows.map(card).join('')
        : emptyState('No exercises found', state.search || state.category || state.difficulty ? 'Try another search, category or level.' : 'The gym has not added exercises yet.');
      grid.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => dialog(rows[Number(b.dataset.i)])));
      const pg = content.querySelector('#el-pager'); const pn = res.pagination;
      pg.innerHTML = pn.totalPages > 1 ? `<span>Page ${pn.page} of ${pn.totalPages}</span><button class="btn btn-outline" data-p="${pn.page - 1}" ${pn.page <= 1 ? 'disabled' : ''}>‹ Prev</button><button class="btn btn-outline" data-p="${pn.page + 1}" ${pn.page >= pn.totalPages ? 'disabled' : ''}>Next ›</button>` : '';
      pg.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.p); load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) grid.innerHTML = notice('Could not load the exercise library', err.message || 'Unexpected error.', { error: true });
    }
  }

  let t;
  content.querySelector('#el-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; load(); }, 300); });
  content.querySelector('#el-diff').addEventListener('change', (e) => { state.difficulty = e.target.value; state.page = 1; load(); });
  load();
}
