/** Virtex Trainer Hub — trainer-exercise-library.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, emptyState, renderError, renderPager, openModal } from './trainer-navigation.js';

const shell = await initShell({ page: 'exercise-library', title: 'Exercise Library', subtitle: 'Shared gym exercise catalogue (read-only)' });

if (shell) {
  const { content } = shell;
  content.innerHTML = `
    <div class="tp-toolbar">
      <input class="input-search" id="q" placeholder="Search exercises…" maxlength="80">
      <input class="input-search tp-search-sm" id="mg" placeholder="Muscle group (e.g. Chest)" maxlength="50">
    </div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;
  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  let page = 1;
  let rows = [];

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/exercises', { page, limit: 25, search: content.querySelector('#q').value.trim(), muscleGroup: content.querySelector('#mg').value.trim() });
      rows = res.data;
      if (!rows.length) { list.innerHTML = emptyState('No exercises found'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>Exercise</th><th>Muscle group</th><th>Equipment</th><th>Difficulty</th><th></th></tr></thead><tbody>
        ${rows.map((e, i) => `<tr><td class="tp-strong">${esc(e.name)}</td><td>${dash(e.muscle_group)}</td>
          <td>${dash(e.equipment)}</td><td>${dash(e.difficulty)}</td>
          <td><button class="btn btn-outline" data-i="${i}">Details</button></td></tr>`).join('')}</tbody></table>`;
      list.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', () => {
        const e = rows[Number(b.dataset.i)];
        const targets = Array.isArray(e.target_muscles) ? e.target_muscles.join(', ') : e.target_muscles;
        openModal(e.name, `<dl class="tp-kv"><dt>Muscle group</dt><dd>${dash(e.muscle_group)}</dd>
          <dt>Target muscles</dt><dd>${dash(targets)}</dd><dt>Equipment</dt><dd>${dash(e.equipment)}</dd>
          <dt>Difficulty</dt><dd>${dash(e.difficulty)}</dd><dt>Instructions</dt><dd class="tp-pre">${dash(e.instructions)}</dd>
          ${e.video_url && /^https?:\/\//i.test(e.video_url) ? `<dt>Video</dt><dd><a href="${esc(e.video_url)}" target="_blank" rel="noopener noreferrer">Open video</a></dd>` : ''}</dl>`);
      }));
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) { renderError(list, err, 'Exercise library'); pager.innerHTML = ''; }
  }
  let t;
  const debounced = () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); };
  content.querySelector('#q').addEventListener('input', debounced);
  content.querySelector('#mg').addEventListener('input', debounced);
  load();
}
