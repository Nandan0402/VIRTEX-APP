/** Virtex Trainer Hub — trainer-workouts.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, emptyState, renderError, renderPager, openModal, formData, clientSelect, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'workouts', title: 'Workout Programmes', subtitle: 'Your programmes and shared templates' });

if (shell) {
  const { content, actions } = shell;
  actions.insertAdjacentHTML('beforeend', '<button class="btn btn-green" id="new">+ New programme</button>');
  content.innerHTML = `
    <div class="tp-toolbar"><input class="input-search" id="q" placeholder="Search programmes…" maxlength="80">
      <label class="tp-muted"><input type="checkbox" id="tpl" checked> Include shared templates</label></div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;
  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  let page = 1;
  let rows = [];
  let exercises = null;

  const metaFields = (p = {}) => `<div class="tp-form-grid">
    <div class="form-group"><label>Name *</label><input name="name" maxlength="150" required value="${esc(p.name || '')}"></div>
    <div class="form-group"><label>Difficulty</label><input name="difficultyLevel" maxlength="30" value="${esc(p.difficulty_level || '')}" placeholder="Beginner / Intermediate / Advanced"></div>
    <div class="form-group"><label>Goal</label><input name="goal" maxlength="50" value="${esc(p.goal || '')}"></div>
    <div class="form-group"><label>Split type</label><input name="splitType" maxlength="50" value="${esc(p.split_type || '')}"></div></div>
    <div class="form-group"><label>Description</label><textarea name="description" rows="3" maxlength="2000">${esc(p.description || '')}</textarea></div>
    <label class="tp-muted"><input type="checkbox" name="isTemplate" ${p.is_template ? 'checked' : ''}> Save as reusable template</label>`;

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/workouts', { page, limit: 20, search: content.querySelector('#q').value.trim(), includeTemplates: content.querySelector('#tpl').checked ? 'true' : 'false' });
      rows = res.data;
      if (!rows.length) { list.innerHTML = emptyState('No workout programmes yet', 'Create your first programme with “+ New programme”.'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>Programme</th><th>Goal</th><th>Structure</th><th>Owner</th><th>Updated</th><th></th></tr></thead><tbody>
        ${rows.map((p, i) => `<tr><td><div class="tp-strong">${esc(p.name)}</div><div class="tp-muted">${dash(p.difficulty_level)} · ${dash(p.split_type)}</div></td>
          <td>${dash(p.goal)}</td><td>${p.day_count} days · ${p.exercise_count} exercises</td>
          <td>${p.is_mine ? '<span class="badge badge-green">mine</span>' : '<span class="badge badge-purple">shared template</span>'}${p.is_mine && p.is_template ? ' <span class="badge badge-dim">template</span>' : ''}</td>
          <td>${fmtDate(p.updated_at || p.created_at)}</td>
          <td class="tp-nowrap">${p.is_mine ? `<button class="btn btn-outline" data-edit="${i}">Edit</button> ` : ''}<button class="btn btn-outline" data-assign="${i}">Assign</button></td></tr>`).join('')}</tbody></table>`;
      list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(rows[Number(b.dataset.edit)])));
      list.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => assign(rows[Number(b.dataset.assign)])));
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) { renderError(list, err, 'Workout programmes'); pager.innerHTML = ''; }
  }

  async function loadExercises() {
    if (exercises) return exercises;
    exercises = (await api.get('/exercises', { limit: 100 })).data;
    return exercises;
  }

  async function create() {
    let ex = [];
    try { ex = await loadExercises(); } catch (err) { toast(err.message, { error: true }); }
    const exOpts = ex.map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.muscle_group || '')})</option>`).join('');
    const { el, close } = openModal('New workout programme', `<form id="f">${metaFields()}
      <h4 class="tp-section-title">Training days</h4><div id="days"></div>
      <button type="button" class="btn btn-outline" id="addDay">+ Add day</button>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Create programme</button></div></form>`, { wide: true });
    const daysEl = el.querySelector('#days');
    const addExercise = (dayEl) => {
      if (!ex.length) { toast('The exercise library is empty.', { error: true }); return; }
      dayEl.querySelector('.exs').insertAdjacentHTML('beforeend', `<div class="tp-ex-row ex">
        <div class="form-group"><label>Exercise</label><select class="exid">${exOpts}</select></div>
        <div class="form-group"><label>Sets</label><input class="sets" type="number" min="1" max="20" value="3"></div>
        <div class="form-group"><label>Reps</label><input class="reps" maxlength="30" value="8-12"></div>
        <div class="form-group"><label>Rest (s)</label><input class="rest" type="number" min="0" max="900" value="90"></div>
        <button type="button" class="btn btn-outline rm" title="Remove">✕</button></div>`);
      dayEl.querySelector('.exs').lastElementChild.querySelector('.rm').addEventListener('click', (e) => e.target.closest('.ex').remove());
    };
    const addDay = () => {
      const n = daysEl.children.length + 1;
      if (n > 14) return;
      daysEl.insertAdjacentHTML('beforeend', `<div class="card day tp-day">
        <div class="tp-form-grid"><div class="form-group"><label>Day name</label><input class="dn" maxlength="100" value="Day ${n}"></div>
        <div class="form-group"><label>Focus</label><input class="df" maxlength="100" placeholder="e.g. Push"></div></div>
        <div class="exs"></div><button type="button" class="btn btn-outline ax">+ Exercise</button>
        <button type="button" class="btn btn-outline rd">Remove day</button></div>`);
      const dayEl = daysEl.lastElementChild;
      dayEl.querySelector('.ax').addEventListener('click', () => addExercise(dayEl));
      dayEl.querySelector('.rd').addEventListener('click', () => dayEl.remove());
    };
    el.querySelector('#addDay').addEventListener('click', addDay);
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const body = formData(form);
      body.days = [...daysEl.querySelectorAll('.day')].map((d, i) => ({
        dayNumber: i + 1, dayName: d.querySelector('.dn').value.trim() || `Day ${i + 1}`, focus: d.querySelector('.df').value.trim(),
        exercises: [...d.querySelectorAll('.ex')].map((x) => ({
          exerciseId: Number(x.querySelector('.exid').value), sets: Number(x.querySelector('.sets').value) || 3,
          reps: x.querySelector('.reps').value.trim() || '8-12', restSeconds: Number(x.querySelector('.rest').value) || 0,
        })),
      }));
      const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
      try { await api.post('/workouts', body); toast('Programme created.'); close(); page = 1; load(); }
      catch (err) { toast(err.message, { error: true }); btn.disabled = false; }
    });
  }

  function edit(p) {
    const { el, close } = openModal(`Edit · ${p.name}`, `<form id="f">${metaFields(p)}
      <div class="tp-muted" style="margin-top:.6rem;">Only programmes you created can be edited.</div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Save</button></div></form>`);
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      ['difficultyLevel', 'goal', 'splitType', 'description'].forEach((k) => { if (body[k] === undefined) body[k] = ''; });
      try { await api.put(`/workouts/${p.id}`, body); toast('Programme updated.'); close(); load(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  async function assign(p) {
    const { el, close } = openModal(`Assign · ${p.name}`, `<form id="f">
      <div class="form-group"><label>Active client *</label><select name="memberId" id="m" required></select></div>
      <div class="tp-form-grid"><div class="form-group"><label>Start date</label><input type="date" name="startDate"></div></div>
      <div class="form-group"><label>Notes</label><textarea name="notes" rows="2" maxlength="1000"></textarea></div>
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Assign</button></div></form>`);
    try {
      const opts = await clientSelect(el.querySelector('#m'), { status: 'active', placeholder: 'Select an active client…' });
      if (!opts.length) el.querySelector('#m').insertAdjacentHTML('afterend', '<div class="tp-muted">You have no active clients.</div>');
    } catch (err) { toast(err.message, { error: true }); }
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = formData(e.target);
      body.memberId = Number(body.memberId);
      try { await api.post(`/workouts/${p.id}/assign`, body); toast('Programme assigned.'); close(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  actions.querySelector('#new').addEventListener('click', create);
  let t;
  content.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  content.querySelector('#tpl').addEventListener('change', () => { page = 1; load(); });
  load();
}
