/** Virtex Trainer Hub — trainer-diet-plans.html page logic. */
import { api } from './trainer-api.js';
import { initShell, esc, dash, fmtDate, emptyState, renderError, renderPager, openModal, formData, clientSelect, toast } from './trainer-navigation.js';

const shell = await initShell({ page: 'diet-plans', title: 'Diet Plans', subtitle: 'Nutrition targets you create and assign' });

if (shell) {
  const { content, actions } = shell;
  actions.insertAdjacentHTML('beforeend', '<button class="btn btn-green" id="new">+ New diet plan</button>');
  content.innerHTML = `
    <div class="tp-toolbar"><input class="input-search" id="q" placeholder="Search diet plans…" maxlength="80">
      <label class="tp-muted"><input type="checkbox" id="tpl" checked> Include shared templates</label></div>
    <div class="card"><div class="table-responsive" id="list"></div><div class="tp-pager" id="pager"></div></div>`;
  const list = content.querySelector('#list');
  const pager = content.querySelector('#pager');
  let page = 1;
  let rows = [];

  const num = (name, label, v, min, max) => `<div class="form-group"><label>${label}</label><input type="number" data-num name="${name}" min="${min}" max="${max}" value="${v ?? ''}"></div>`;
  const fields = (p = {}) => `<div class="tp-form-grid">
    <div class="form-group"><label>Name *</label><input name="name" maxlength="150" required value="${esc(p.name || '')}"></div>
    <div class="form-group"><label>Goal</label><input name="goal" maxlength="50" value="${esc(p.goal || '')}"></div>
    ${num('targetCalories', 'Calories (kcal)', p.target_calories, 500, 10000)}
    ${num('targetProteinG', 'Protein (g)', p.target_protein_g, 0, 1000)}
    ${num('targetCarbsG', 'Carbs (g)', p.target_carbs_g, 0, 2000)}
    ${num('targetFatsG', 'Fats (g)', p.target_fats_g, 0, 1000)}
    ${num('targetWaterMl', 'Water (ml)', p.target_water_ml, 0, 10000)}</div>
    <div class="form-group"><label>Description / guidance</label><textarea name="description" rows="3" maxlength="2000">${esc(p.description || '')}</textarea></div>
    <label class="tp-muted"><input type="checkbox" name="isTemplate" ${p.is_template ? 'checked' : ''}> Save as reusable template</label>`;

  async function load() {
    list.innerHTML = '<div class="tp-muted tp-loading">Loading…</div>';
    try {
      const res = await api.get('/diet-plans', { page, limit: 20, search: content.querySelector('#q').value.trim(), includeTemplates: content.querySelector('#tpl').checked ? 'true' : 'false' });
      rows = res.data;
      if (!rows.length) { list.innerHTML = emptyState('No diet plans yet', 'Create one with “+ New diet plan”.'); pager.innerHTML = ''; return; }
      list.innerHTML = `<table class="admin-table"><thead><tr><th>Plan</th><th>Daily targets</th><th>Meals</th><th>Owner</th><th>Updated</th><th></th></tr></thead><tbody>
        ${rows.map((p, i) => `<tr><td><div class="tp-strong">${esc(p.name)}</div><div class="tp-muted">${dash(p.goal)}</div></td>
          <td>${dash(p.target_calories, ' kcal')}<div class="tp-muted">P ${dash(p.target_protein_g, 'g')} · C ${dash(p.target_carbs_g, 'g')} · F ${dash(p.target_fats_g, 'g')} · ${dash(p.target_water_ml, ' ml')}</div></td>
          <td>${p.meal_count}</td>
          <td>${p.is_mine ? '<span class="badge badge-green">mine</span>' : '<span class="badge badge-purple">shared template</span>'}</td>
          <td>${fmtDate(p.updated_at || p.created_at)}</td>
          <td class="tp-nowrap">${p.is_mine ? `<button class="btn btn-outline" data-edit="${i}">Edit</button> ` : ''}<button class="btn btn-outline" data-assign="${i}">Assign</button></td></tr>`).join('')}</tbody></table>`;
      list.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => edit(rows[Number(b.dataset.edit)])));
      list.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () => assign(rows[Number(b.dataset.assign)])));
      renderPager(pager, res.pagination, (p) => { page = p; load(); });
    } catch (err) { renderError(list, err, 'Diet plans'); pager.innerHTML = ''; }
  }

  function form(title, p, submit) {
    const { el, close } = openModal(title, `<form id="f">${fields(p)}
      <div class="tp-form-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-green" type="submit">Save</button></div></form>`, { wide: true });
    el.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try { await submit(formData(e.target)); close(); load(); }
      catch (err) { toast(err.message, { error: true }); btn.disabled = false; }
    });
  }
  const create = () => form('New diet plan', {}, async (body) => { await api.post('/diet-plans', body); toast('Diet plan created.'); page = 1; });
  const edit = (p) => form(`Edit · ${p.name}`, p, async (body) => {
    ['goal', 'description'].forEach((k) => { if (body[k] === undefined) body[k] = ''; });
    await api.put(`/diet-plans/${p.id}`, body); toast('Diet plan updated.');
  });

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
      try { await api.post(`/diet-plans/${p.id}/assign`, body); toast('Diet plan assigned.'); close(); }
      catch (err) { toast(err.message, { error: true }); }
    });
  }

  actions.querySelector('#new').addEventListener('click', create);
  let t;
  content.querySelector('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { page = 1; load(); }, 300); });
  content.querySelector('#tpl').addEventListener('change', () => { page = 1; load(); });
  load();
}
