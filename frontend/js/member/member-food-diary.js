/** Virtex Member Portal — member-food-diary.html: record daily food consumption.
 *  Read:  GET /api/v1/member/food-diary?date=YYYY-MM-DD   (that day's log + active plan targets)
 *         GET /api/v1/member/foods?search=                 (foodCatalogue / food database)
 *         GET /api/v1/member/nutrition-logs                (recent days)
 *  Write: PUT /api/v1/member/food-diary/:date              (whole day; today … 7 days back)
 *  Database foods: nutrition = food database values × servings, recalculated by the server.
 *  Custom foods: the member types every value from the label. Nothing is guessed.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({ page: 'nutrition-logs', title: 'Food Diary', subtitle: 'Record what you eat and drink each day' });

const MEALS = [
  { key: 'Breakfast', icon: '🌅' }, { key: 'Lunch', icon: '🍛' }, { key: 'Dinner', icon: '🌙' }, { key: 'Snacks', icon: '🍎' },
];
const r1 = (x) => Math.round(x * 10) / 10;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const show = (v, unit = '') => (num(v) === null ? '—' : `${num(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const longDate = (s) => new Date(`${s}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function toast(message, error = false) {
  let el = document.getElementById('fd-toast');
  if (!el) { el = document.createElement('div'); el.id = 'fd-toast'; el.className = 'toast-banner mp-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.classList.toggle('error', error); el.textContent = message; el.style.display = 'block';
  clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

if (shell) {
  const { content } = shell;
  const params = new URLSearchParams(location.search);
  let state = null;            // { date, today, editable, targets, entries:[], water, notes }
  let saved = '';              // JSON snapshot of the last saved day (dirty tracking)
  let saving = false;

  const snapshot = () => JSON.stringify({ e: state.entries.map(({ mealType, foodItemId, servings, foodName, portionSize, calories, proteinG, carbsG, fatsG }) => [mealType, foodItemId, servings, foodName, portionSize, calories, proteinG, carbsG, fatsG]), w: state.water, n: state.notes });
  const dirty = () => state && state.editable && snapshot() !== saved;

  /** Entry from the server log → editable entry. Database foods keep their per-serving values for re-calculation. */
  function fromServer(e) {
    const m = /^([\d.]+)\s*×/.exec(e.portion_size || '');
    return { mealType: MEALS.find((x) => x.key.toLowerCase() === String(e.meal_type).toLowerCase())?.key || 'Snacks',
      foodItemId: e.food_item_id, servings: e.food_item_id && m ? Number(m[1]) : null, foodName: e.food_name, portionSize: e.portion_size,
      calories: num(e.calories), proteinG: num(e.protein_g), carbsG: num(e.carbs_g), fatsG: num(e.fats_g), per: null };
  }

  function totals() {
    return state.entries.reduce((t, e) => ({ kcal: t.kcal + (e.calories || 0), p: t.p + (e.proteinG || 0), c: t.c + (e.carbsG || 0), f: t.f + (e.fatsG || 0) }), { kcal: 0, p: 0, c: 0, f: 0 });
  }

  function tile(label, value, unit, target, icon) {
    const pct = num(target) ? Math.round((value / num(target)) * 100) : null;
    return `<div class="fd-tile"><span>${icon} ${esc(label)}</span><b>${esc(show(r1(value), unit))}</b>
      ${pct !== null ? `<div class="fd-meter" role="meter" aria-label="${esc(label)} vs plan target" aria-valuemin="0" aria-valuemax="${num(target)}" aria-valuenow="${Math.round(value)}"><span style="width:${Math.min(pct, 100)}%"${pct > 110 ? ' class="over"' : ''}></span></div>
        <small>${pct}% of ${esc(show(target, unit))} target</small>` : '<small>No plan target</small>'}</div>`;
  }

  function entryRow(e, idx) {
    return `<li class="fd-entry"><div class="fd-entry-main"><b>${esc(e.foodName)}</b>
        <span class="fd-src ${e.foodItemId ? 'db' : 'own'}">${e.foodItemId ? 'Food database' : 'Your entry'}</span>
        <div class="fd-sub">${esc(e.portionSize || '')}</div></div>
      <div class="fd-macros"><span>${esc(show(e.calories))} kcal</span><span>P ${esc(show(e.proteinG, 'g'))}</span><span>C ${esc(show(e.carbsG, 'g'))}</span><span>F ${esc(show(e.fatsG, 'g'))}</span></div>
      ${state.editable ? `<button type="button" class="fd-icon" data-rm="${idx}" aria-label="Remove ${esc(e.foodName)}">✕</button>` : ''}</li>`;
  }

  function render() {
    const t = totals(); const tg = state.targets;
    const isToday = state.date === state.today;
    content.innerHTML = `
      <section class="card fd-dates" aria-label="Choose a day">
        <button type="button" class="btn btn-outline" id="fd-prev" aria-label="Previous day">‹</button>
        <label class="sr-only" for="fd-date">Diary date</label>
        <input type="date" id="fd-date" value="${state.date}" max="${state.today}">
        <button type="button" class="btn btn-outline" id="fd-next" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
        <div class="fd-date-label">${esc(longDate(state.date))}${isToday ? ' · <b>Today</b>' : ''}</div>
        ${!isToday ? '<button type="button" class="btn btn-outline" id="fd-today">Today</button>' : ''}
      </section>
      ${state.editable ? '' : notice('This day is locked', 'Days older than a week are kept as permanent history. Ask your trainer if a past record needs correcting.')}
      <section class="fd-tiles" aria-label="Daily totals">
        ${tile('Calories', t.kcal, ' kcal', tg?.calories, '🔥')}${tile('Protein', t.p, ' g', tg?.proteinG, '🥩')}
        ${tile('Carbohydrates', t.c, ' g', tg?.carbsG, '🍚')}${tile('Fat', t.f, ' g', tg?.fatsG, '🥑')}
        <div class="fd-tile fd-water"><span>💧 Water</span>
          ${state.editable ? `<div class="fd-water-row"><input type="number" id="fd-water" min="0" max="15000" step="50" inputmode="numeric" aria-label="Water intake in ml" value="${state.water ?? ''}" placeholder="ml"><span>ml</span></div>
            <div class="fd-water-btns">${[250, 500].map((v) => `<button type="button" class="btn btn-outline" data-water="${v}">+${v} ml</button>`).join('')}</div>`
            : `<b>${esc(show(state.water, ' ml'))}</b>`}
          <small>${num(tg?.waterMl) ? `Target ${esc(show(tg.waterMl, ' ml'))}` : 'No plan target'}</small></div>
      </section>
      ${tg ? `<p class="fd-sub">Targets from your diet plan <b>${esc(tg.planName)}</b>. <a href="member-diet-plan.html">View plan</a></p>` : '<p class="fd-sub">No diet plan assigned — totals are shown without targets.</p>'}
      <div class="fd-meals">${MEALS.map((m) => {
        const list = state.entries.map((e, i) => [e, i]).filter(([e]) => e.mealType === m.key);
        const sub = list.reduce((s, [e]) => s + (e.calories || 0), 0);
        return `<section class="card fd-meal" aria-labelledby="fd-h-${m.key}">
          <header><h2 id="fd-h-${m.key}">${m.icon} ${m.key}</h2><span class="fd-sub">${list.length ? `${esc(show(r1(sub)))} kcal` : ''}</span></header>
          ${list.length ? `<ul class="fd-list">${list.map(([e, i]) => entryRow(e, i)).join('')}</ul>` : `<p class="fd-empty">Nothing logged for ${m.key.toLowerCase()}.</p>`}
          ${state.editable ? `<button type="button" class="btn btn-outline fd-add" data-add="${m.key}">+ Add food</button><div class="fd-adder" id="fd-adder-${m.key}"></div>` : ''}
        </section>`;
      }).join('')}</div>
      <section class="card fd-notes"><label for="fd-notes">Notes for your trainer</label>
        <textarea id="fd-notes" rows="2" maxlength="1000" ${state.editable ? '' : 'disabled'} placeholder="Cravings, eating out, how you felt…">${esc(state.notes || '')}</textarea></section>
      ${state.editable ? `<div class="fd-savebar"><span id="fd-dirty" class="fd-sub"></span><button type="button" class="btn btn-green" id="fd-save">Save ${isToday ? "today's" : 'this day’s'} diary</button></div>` : ''}
      <section class="card fd-recent"><h2>Recent days</h2><div id="fd-recent"><div class="mp-muted mp-loading">Loading…</div></div></section>`;
    wire(); updateDirty(); loadRecent();
  }

  function updateDirty() {
    const el = content.querySelector('#fd-dirty'); if (!el) return;
    el.textContent = dirty() ? 'Unsaved changes' : (saved && state.entries.length ? 'All changes saved' : '');
  }

  function wire() {
    const go = async (d) => { if (dirty() && !(await confirmLeave())) return; load(d); };
    content.querySelector('#fd-prev').addEventListener('click', () => go(addDays(state.date, -1)));
    content.querySelector('#fd-next').addEventListener('click', () => go(addDays(state.date, 1)));
    content.querySelector('#fd-today')?.addEventListener('click', () => go(state.today));
    content.querySelector('#fd-date').addEventListener('change', (e) => { if (e.target.value && e.target.value <= state.today) go(e.target.value); });
    content.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { state.entries.splice(Number(b.dataset.rm), 1); render(); }));
    content.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => openAdder(b.dataset.add)));
    const water = content.querySelector('#fd-water');
    water?.addEventListener('input', () => { state.water = water.value === '' ? null : Number(water.value); updateDirty(); });
    content.querySelectorAll('[data-water]').forEach((b) => b.addEventListener('click', () => { state.water = Math.min(15000, (state.water || 0) + Number(b.dataset.water)); water.value = state.water; updateDirty(); }));
    content.querySelector('#fd-notes').addEventListener('input', (e) => { state.notes = e.target.value; updateDirty(); });
    content.querySelector('#fd-save')?.addEventListener('click', save);
  }

  function openAdder(meal) {
    content.querySelectorAll('.fd-adder').forEach((a) => { a.innerHTML = ''; });
    const box = content.querySelector(`#fd-adder-${meal}`);
    box.innerHTML = `<div class="fd-adder-panel">
      <div class="fd-tabs" role="tablist"><button type="button" role="tab" class="is-on" aria-selected="true" data-tab="db">Food database</button><button type="button" role="tab" aria-selected="false" data-tab="own">Custom food</button></div>
      <div data-pane="db"><label class="sr-only" for="fd-q-${meal}">Search foods</label><input type="search" id="fd-q-${meal}" class="fd-q" placeholder="Search foods, e.g. rice, eggs…" autocomplete="off">
        <ul class="fd-results" aria-live="polite"></ul><div class="fd-pick"></div></div>
      <form data-pane="own" hidden novalidate><p class="fd-sub">Use the values from the food's label or packaging. All fields are required — values are never guessed.</p>
        <div class="fd-own-grid">
          <label>Food name<input name="foodName" maxlength="120" required></label><label>Amount eaten<input name="portionSize" maxlength="100" placeholder="e.g. 1 bowl, 200 g" required></label>
          <label>Calories (kcal)<input name="calories" type="number" min="0" max="5000" step="0.1" required></label><label>Protein (g)<input name="proteinG" type="number" min="0" max="500" step="0.1" required></label>
          <label>Carbs (g)<input name="carbsG" type="number" min="0" max="1000" step="0.1" required></label><label>Fat (g)<input name="fatsG" type="number" min="0" max="500" step="0.1" required></label></div>
        <div class="fd-err" role="alert"></div><div class="fd-row-actions"><button type="button" class="btn btn-outline" data-close>Cancel</button><button type="submit" class="btn btn-green">Add to ${meal}</button></div></form>
    </div>`;
    const panes = box.querySelectorAll('[data-pane]');
    box.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => {
      box.querySelectorAll('[data-tab]').forEach((x) => { const on = x === t; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', String(on)); });
      panes.forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
    }));
    box.querySelector('[data-close]').addEventListener('click', () => { box.innerHTML = ''; });
    const q = box.querySelector('.fd-q'); const results = box.querySelector('.fd-results'); const pick = box.querySelector('.fd-pick');
    let timer; let foods = [];
    const search = async () => {
      try {
        foods = (await api.get('/foods', { search: q.value.trim(), limit: 12 })).data;
        results.innerHTML = foods.length ? foods.map((f, i) => `<li><button type="button" data-food="${i}"><b>${esc(f.name)}</b><span>${esc(f.serving_size)} · ${esc(show(f.calories))} kcal · P ${esc(show(f.protein_g))} · C ${esc(show(f.carbs_g))} · F ${esc(show(f.fats_g))}</span></button></li>`).join('')
          : '<li class="fd-none">No matching foods. Try the Custom food tab.</li>';
        results.querySelectorAll('[data-food]').forEach((b) => b.addEventListener('click', () => choose(foods[Number(b.dataset.food)])));
      } catch (e) { results.innerHTML = `<li class="fd-none">${esc(e.message)}</li>`; }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
    search(); q.focus();

    function choose(f) {
      pick.innerHTML = `<div class="fd-chosen"><b>${esc(f.name)}</b> <span class="fd-sub">per ${esc(f.serving_size)}: ${esc(show(f.calories))} kcal · P ${esc(show(f.protein_g))} g · C ${esc(show(f.carbs_g))} g · F ${esc(show(f.fats_g))} g</span>
        <div class="fd-serv"><label>Servings <input type="number" class="fd-servings" min="0.1" max="20" step="0.25" value="1"></label><span class="fd-preview"></span>
        <button type="button" class="btn btn-green fd-confirm">Add to ${meal}</button></div></div>`;
      const s = pick.querySelector('.fd-servings'); const pv = pick.querySelector('.fd-preview');
      const calc = () => { const n = Number(s.value); pv.textContent = n >= 0.1 && n <= 20 ? `= ${show(r1(f.calories * n))} kcal · P ${show(r1(f.protein_g * n))} g · C ${show(r1(f.carbs_g * n))} g · F ${show(r1(f.fats_g * n))} g` : 'Servings must be 0.1–20'; };
      s.addEventListener('input', calc); calc(); s.focus();
      pick.querySelector('.fd-confirm').addEventListener('click', () => {
        const n = Number(s.value); if (!(n >= 0.1 && n <= 20)) { s.focus(); return; }
        state.entries.push({ mealType: meal, foodItemId: f.id, servings: n, foodName: f.name, portionSize: `${n} × ${f.serving_size}`,
          calories: r1(f.calories * n), proteinG: r1(f.protein_g * n), carbsG: r1(f.carbs_g * n), fatsG: r1(f.fats_g * n) });
        render();
      });
    }

    box.querySelector('[data-pane="own"]').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const f = ev.target; const err = f.querySelector('.fd-err');
      const v = Object.fromEntries(['foodName', 'portionSize', 'calories', 'proteinG', 'carbsG', 'fatsG'].map((k) => [k, f[k].value.trim()]));
      const missing = Object.entries(v).filter(([, x]) => x === '').map(([k]) => f[k].closest('label').firstChild.textContent.trim());
      if (missing.length) { err.textContent = `Please enter: ${missing.join(', ')}.`; return; }
      if (['calories', 'proteinG', 'carbsG', 'fatsG'].some((k) => !(Number(v[k]) >= 0))) { err.textContent = 'Nutrition values must be 0 or more.'; return; }
      state.entries.push({ mealType: meal, foodItemId: null, servings: null, foodName: v.foodName, portionSize: v.portionSize,
        calories: Number(v.calories), proteinG: Number(v.proteinG), carbsG: Number(v.carbsG), fatsG: Number(v.fatsG) });
      render();
    });
  }

  async function save() {
    if (saving) return;
    if (state.water === null || state.water === undefined || state.water === '') { toast('Enter your water intake for the day (0 if none).', true); content.querySelector('#fd-water')?.focus(); return; }
    saving = true;
    const btn = content.querySelector('#fd-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await api.put(`/food-diary/${state.date}`, {
        waterIntakeMl: Number(state.water), notes: state.notes?.trim() || undefined,
        entries: state.entries.map((e) => (e.foodItemId ? { mealType: e.mealType, foodItemId: e.foodItemId, servings: e.servings }
          : { mealType: e.mealType, foodName: e.foodName, portionSize: e.portionSize, calories: e.calories, proteinG: e.proteinG, carbsG: e.carbsG, fatsG: e.fatsG })),
      });
      toast('Diary saved — your trainer can review it.');
      await load(state.date);                       // reload the server-calculated values
    } catch (e) {
      toast(e.message || 'Could not save your diary.', true);
      btn.disabled = false; btn.textContent = 'Save diary';
    } finally { saving = false; }
  }

  async function loadRecent() {
    const box = content.querySelector('#fd-recent');
    try {
      const res = await api.get('/nutrition-logs', { limit: 7 });
      box.innerHTML = res.data.length ? `<ul class="fd-days">${res.data.map((d) => {
        const day = String(d.log_date).slice(0, 10);
        const key = /^\d{4}-\d{2}-\d{2}$/.test(day) ? ymd(new Date(d.log_date)) : day;
        return `<li><a href="member-food-diary.html?date=${esc(key)}" data-day="${esc(key)}"><b>${esc(new Date(d.log_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
          <span>${esc(show(d.total_calories))} kcal · ${esc(show(d.water_intake_ml))} ml water${d.adherence_score !== null && d.adherence_score !== undefined ? ` · ${esc(d.adherence_score)}% on target` : ''}</span></a></li>`;
      }).join('')}</ul>` : emptyState('No diary days yet', 'Days you save appear here.');
      box.querySelectorAll('[data-day]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); if (dirty() && !(await confirmLeave())) return; load(a.dataset.day); }));
    } catch (e) { box.innerHTML = `<p class="fd-sub">${esc(e.message)}</p>`; }
  }

  async function load(date) {
    content.innerHTML = '<div class="mp-muted mp-loading">Loading your diary…</div>';
    try {
      const d = (await api.get('/food-diary', date ? { date } : {})).data;
      state = { date: d.date, today: d.today, editable: d.editable, targets: d.targets,
        entries: (d.log?.entries || []).map(fromServer), water: d.log ? num(d.log.water_intake_ml) : null, notes: d.log?.notes || '' };
      saved = d.log ? snapshot() : '';
      history.replaceState(null, '', d.date === d.today ? 'member-food-diary.html' : `member-food-diary.html?date=${d.date}`);
      render();
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) content.innerHTML = notice('Could not load your food diary', err.message || 'Unexpected error.', { error: true });
    }
  }

  // ---- Unsaved changes: a centered in-page dialog instead of the browser's "Leave site?" box -------------
  let leaving = false; // set once the member chose "Leave without saving" so the browser doesn't ask again
  function confirmLeave() {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'fd-leave-backdrop';
      back.innerHTML = `<div class="fd-leave" role="alertdialog" aria-modal="true" aria-labelledby="fd-leave-t" aria-describedby="fd-leave-d">
          <h2 id="fd-leave-t">Leave without saving?</h2>
          <p id="fd-leave-d">You have food diary changes that aren't saved yet. If you leave now, they will be lost.</p>
          <div class="fd-leave-actions">
            <button type="button" class="btn btn-outline" data-stay>Stay on this page</button>
            <button type="button" class="btn fd-leave-go" data-leave>Leave without saving</button>
          </div></div>`;
      const prevFocus = document.activeElement;
      const close = (ok) => { document.removeEventListener('keydown', onKey, true); back.remove(); if (!ok) prevFocus?.focus?.(); resolve(ok); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Tab') { // keep focus inside the dialog
          const btns = [...back.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement);
          e.preventDefault(); btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
        }
      };
      back.addEventListener('click', (e) => { if (e.target === back) close(false); });
      back.querySelector('[data-stay]').addEventListener('click', () => close(false));
      back.querySelector('[data-leave]').addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
      back.querySelector('[data-stay]').focus();
    });
  }
  // Links inside the portal (sidebar, menus, buttons that are links): ask with the centered dialog.
  document.addEventListener('click', async (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || !dirty()) return;
    if (a.target === '_blank' || a.hasAttribute('download') || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
    e.preventDefault();
    if (await confirmLeave()) { leaving = true; location.href = url.href; }
  }, true);
  // Closing the tab, reloading or typing a new address can only be warned about by the browser's own box.
  window.addEventListener('beforeunload', (e) => { if (!leaving && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  load(params.get('date'));
}
