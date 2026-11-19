/**
 * dietGuide.js — Admin → Diet Guide (admin-diet-nutrition.html): a read-only nutrition reference.
 * Explains how to eat for bulking, cutting or maintenance: calories, protein/carbs/fat, which foods
 * (Indian veg and non-veg), example days, meal timing, water and supplements.
 * Static content: no API calls, no client diet data is shown. The same guide is also shown read-only
 * in the Member Portal (member-diet-plan.html) and Trainer Hub (trainer-diet-guide.html) via
 * window.VirtexDietGuide.mount(element).
 * Food values are typical approximate values per the stated amount.
 */

const GOALS = {
  bulk: {
    title: 'Bulking — eat to build muscle',
    summary: 'Eat a little more than you burn, get enough protein, and fuel training with carbs. Gain slowly so most of the weight is muscle, not fat.',
    rows: [
      ['Calories', 'Maintenance + 250–500 kcal a day'],
      ['Weight change', 'Gain 0.25–0.5% of body weight per week'],
      ['Protein', '1.6–2.2 g per kg body weight a day'],
      ['Fat', '0.8–1 g per kg (about 25–30% of calories)'],
      ['Carbs', 'The rest of the calories — about 4–6 g per kg'],
      ['Meals', '4–5 meals or snacks; liquid calories (milk, smoothies) help if appetite is low'],
    ],
    example: '70 kg person: about 2,800 kcal → 140 g protein, 70 g fat, 400 g carbs',
    tips: ['Add calories with easy foods: milk, banana, peanut butter, oats, rice, ghee in small amounts.',
           'Weigh in 3–4 mornings a week. If the weekly average does not go up for 2 weeks, add 150–200 kcal.',
           'Do not "dirty bulk" — junk food adds fat faster than muscle.'],
    day: 'bulk',
  },
  cut: {
    title: 'Cutting — eat to lose fat and keep muscle',
    summary: 'Eat less than you burn, keep protein high so muscle is protected, and fill the plate with vegetables so hunger stays low.',
    rows: [
      ['Calories', 'Maintenance − 300–500 kcal a day'],
      ['Weight change', 'Lose 0.5–1% of body weight per week'],
      ['Protein', '2.0–2.4 g per kg body weight a day (higher than bulking)'],
      ['Fat', '0.6–0.8 g per kg (do not go below ~20% of calories)'],
      ['Carbs', 'The rest — keep most of them around training'],
      ['Meals', '3–4 meals with protein and vegetables in each; plan snacks so hunger does not win'],
    ],
    example: '70 kg person: about 1,900 kcal → 150 g protein, 50 g fat, 210 g carbs',
    tips: ['Big volume, low calories: vegetables, salads, soups, fruit, curd, egg whites.',
           'Watch hidden calories: oil, ghee, sugar in tea and coffee, juices, fried snacks, sauces.',
           'If weight is stuck for 2 weeks, cut 100–150 kcal or add 2,000 steps a day — not both at once.'],
    day: 'cut',
  },
  recomp: {
    title: 'Maintain / recomposition — leaner and stronger slowly',
    summary: 'Eat around maintenance with high protein. Works well for beginners and people returning to the gym.',
    rows: [
      ['Calories', 'About maintenance (±100 kcal)'],
      ['Weight change', 'Stable weight; waist goes down while lifts go up'],
      ['Protein', '1.8–2.2 g per kg body weight a day'],
      ['Fat', '0.7–1 g per kg'],
      ['Carbs', 'The rest — more on training days, a bit less on rest days'],
      ['Meals', '3–4 meals, protein in every meal'],
    ],
    example: '70 kg person: about 2,350 kcal → 140 g protein, 65 g fat, 300 g carbs',
    tips: ['Keep the same foods most days — consistency matters more than perfection.',
           'Check progress with the mirror, a waist measurement and strength, not only the scale.'],
    day: 'recomp',
  },
};

// [food, amount, protein g, kcal, note, veg?]
const FOODS = [
  { id: 'protein', name: 'Protein foods', icon: '🍗', color: '#f87171',
    intro: 'Builds and repairs muscle. Have 20–40 g in every meal.',
    items: [
      ['Chicken breast (cooked)', '100 g', 31, 165, 'Lean, cheap protein', false],
      ['Eggs', '2 whole', 12, 140, 'Whites alone: ~3.5 g protein, 17 kcal each', false],
      ['Fish (rohu, salmon, tuna)', '100 g cooked', 22, 140, 'Oily fish also gives omega-3', false],
      ['Paneer', '100 g', 18, 265, 'High in fat — use low-fat paneer when cutting', true],
      ['Soya chunks (dry)', '50 g', 26, 170, 'One of the best veg protein sources', true],
      ['Tofu (firm)', '100 g', 12, 120, '', true],
      ['Greek yogurt / hung curd', '200 g', 18, 130, 'Plain curd: ~7 g per 200 g', true],
      ['Dal (cooked)', '1 katori (150 g)', 9, 170, 'Pair with rice/roti for a complete protein', true],
      ['Chana / rajma (cooked)', '1 katori (150 g)', 13, 200, 'Also high in fibre', true],
      ['Milk (toned)', '250 ml', 8, 145, 'Easy calories when bulking', true],
      ['Whey protein', '1 scoop (30 g)', 24, 120, 'Convenient, not required', true],
    ] },
  { id: 'carbs', name: 'Carbs (energy)', icon: '🍚', color: '#fbbf24',
    intro: 'Fuel for training. Choose mostly whole grains, millets and fruit.',
    items: [
      ['Rice (cooked)', '1 cup (150 g)', 4, 195, 'Brown rice adds fibre', true],
      ['Roti / chapati (atta)', '1 medium', 3, 100, 'Skip ghee on top when cutting', true],
      ['Oats', '40 g dry', 5, 150, 'Great breakfast with milk + fruit', true],
      ['Poha', '1 plate (150 g)', 4, 250, 'Add peanuts and vegetables', true],
      ['Idli', '2 pieces', 4, 120, 'Light pre-workout meal with sambar', true],
      ['Ragi / millets (cooked)', '1 cup', 4, 180, 'More fibre and minerals', true],
      ['Potato / sweet potato', '150 g boiled', 3, 130, 'Filling, good around training', true],
      ['Banana', '1 medium', 1, 105, 'Quick pre-workout snack', true],
    ] },
  { id: 'fats', name: 'Healthy fats', icon: '🥜', color: '#a78bfa',
    intro: 'Needed for hormones and health — but calorie-dense, so measure them.',
    items: [
      ['Peanuts / almonds', '30 g (a handful)', 7, 170, '', true],
      ['Peanut butter', '1 tbsp (16 g)', 4, 95, 'Easy bulking calories', true],
      ['Ghee / oil', '1 tsp (5 g)', 0, 45, 'Measure it — easy to overdo', true],
      ['Flax / chia seeds', '1 tbsp', 2, 55, 'Fibre and omega-3', true],
      ['Whole eggs', '1 egg', 6, 70, 'Fat is in the yolk', false],
    ] },
  { id: 'veg', name: 'Vegetables & fruit', icon: '🥦', color: '#4ade80',
    intro: 'Fibre, vitamins and minerals; keep you full. Fill half the plate.',
    items: [
      ['Green vegetables (palak, beans, broccoli)', '1 katori', 3, 40, 'Eat as much as you like', true],
      ['Salad (cucumber, tomato, onion)', '1 bowl', 2, 35, 'Before meals helps when cutting', true],
      ['Fruit (apple, orange, papaya, guava)', '1 serving', 1, 70, '2–3 servings a day', true],
      ['Sprouts', '1 cup', 7, 80, 'Protein + fibre snack', true],
    ] },
];

// Example days (≈ 70 kg person). Approximate totals.
const DAYS = {
  bulk: { label: 'Bulking day', kcal: '≈ 2,800 kcal · 140 g protein', meals: {
    veg: [['Breakfast', 'Oats (60 g) with 300 ml milk, 1 banana, 1 tbsp peanut butter'],
          ['Lunch', '2 cups rice, 1 katori dal, 1 katori rajma, vegetables, curd'],
          ['Pre-workout', '2 idli or 1 banana + 30 g peanuts'],
          ['Post-workout', '1 scoop whey in milk, or 200 g Greek yogurt'],
          ['Dinner', '3 roti, 150 g paneer or soya curry, salad'],
          ['Before bed', '250 ml milk']],
    nonveg: [['Breakfast', '3 eggs + 2 slices toast, oats with milk'],
             ['Lunch', '2 cups rice, 150 g chicken curry, dal, salad'],
             ['Pre-workout', 'Banana + peanut butter toast'],
             ['Post-workout', 'Whey shake or 200 ml milk + fruit'],
             ['Dinner', '3 roti, 150 g fish or chicken, vegetables'],
             ['Before bed', 'Curd or milk']] } },
  cut: { label: 'Cutting day', kcal: '≈ 1,900 kcal · 150 g protein', meals: {
    veg: [['Breakfast', 'Besan chilla (2) with low-fat paneer filling, green tea'],
          ['Lunch', '1 cup rice or 2 roti, 1 katori dal, big salad, 150 g hung curd'],
          ['Snack', 'Sprouts chaat or roasted chana (30 g)'],
          ['Post-workout', '1 scoop whey in water, or soya chunks (50 g dry) curry'],
          ['Dinner', '2 roti, tofu or low-fat paneer bhurji (150 g), vegetables']],
    nonveg: [['Breakfast', '4 egg whites + 1 whole egg omelette, 1 roti or toast'],
             ['Lunch', '1 cup rice, 150 g grilled chicken, dal, salad'],
             ['Snack', 'Fruit + 200 g curd'],
             ['Post-workout', 'Whey in water'],
             ['Dinner', '150 g fish or chicken, vegetables, 1–2 roti']] } },
  recomp: { label: 'Maintenance day', kcal: '≈ 2,350 kcal · 140 g protein', meals: {
    veg: [['Breakfast', 'Poha with peanuts + 200 g curd'],
          ['Lunch', '1½ cups rice, dal, chana, vegetables'],
          ['Snack', 'Fruit + roasted chana'],
          ['Post-workout', 'Whey or paneer sandwich'],
          ['Dinner', '3 roti, soya or paneer curry, salad']],
    nonveg: [['Breakfast', '3 eggs, 2 toast, fruit'],
             ['Lunch', '1½ cups rice, chicken curry (150 g), salad'],
             ['Snack', 'Curd + fruit'],
             ['Post-workout', 'Whey or milk'],
             ['Dinner', '2–3 roti, fish or chicken, vegetables']] } },
};

const BASICS = [
  ['🧮', 'Find maintenance calories', 'Quick estimate: body weight (kg) × 30–33 kcal. Better: keep eating normally for 2 weeks, log food, and see if weight stays the same.'],
  ['🥩', 'Protein first', 'Hit the daily protein target every day. Spread it over 3–5 meals of 20–40 g.'],
  ['⏰', 'Before training', 'A meal with carbs + protein 1–3 hours before (e.g. rice + dal, or idli + curd). Light snack 30–60 min before if hungry.'],
  ['🔁', 'After training', '20–40 g protein + some carbs within a couple of hours. A normal meal works fine.'],
  ['💧', 'Water', 'About 35 ml per kg body weight a day (≈ 2.5 L for 70 kg), plus 500–750 ml per hour of training. Pale-yellow urine = enough.'],
  ['🌾', 'Fibre', '25–35 g a day from vegetables, fruit, dal and whole grains. Keeps you full and digestion regular.'],
  ['🧂', 'Salt & sugar', 'Keep added sugar low and avoid sugary drinks. Packaged and restaurant food is very high in salt and oil.'],
  ['😴', 'Sleep', '7–9 hours. Poor sleep increases hunger and makes cutting much harder.'],
];

const SUPPS = [
  ['✅', 'Whey / plant protein', 'Useful only to reach the protein target. Food first.'],
  ['✅', 'Creatine monohydrate', '3–5 g a day, every day. Well studied for strength and muscle. Plain creatine monohydrate is enough.'],
  ['➖', 'Vitamin D, B12, iron', 'Only if a blood test shows low levels — check with a doctor. Vegetarians should check B12.'],
  ['➖', 'Caffeine', 'Optional before training (black coffee). Avoid late in the day.'],
  ['❌', 'Fat burners, "mass gainers" with sugar, steroids', 'Not recommended — little benefit, real health risks.'],
];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let goal = 'bulk';
let food = 'all';
let vegOnly = false;
let q = '';

function renderGoal() {
  const g = GOALS[goal];
  document.getElementById('dg-goal-body').innerHTML = `
    <div class="wg-goal-intro"><h3>${esc(g.title)}</h3><p>${esc(g.summary)}</p></div>
    <dl class="wg-goal-grid">${g.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <p class="dg-example">📌 Example: ${esc(g.example)}</p>
    <ul class="dg-tips">${g.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  document.querySelectorAll('[data-goal]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.goal === goal)));
  renderDay();
}

function renderDay() {
  const d = DAYS[GOALS[goal].day];
  const col = (title, meals) => `<div class="dg-day-col"><h4>${title}</h4><dl>${meals.map(([m, f]) => `<div><dt>${esc(m)}</dt><dd>${esc(f)}</dd></div>`).join('')}</dl></div>`;
  document.getElementById('dg-day').innerHTML = `
    <div class="dg-day-head"><h3>${esc(d.label)}</h3><span>${esc(d.kcal)} · example for a 70 kg person</span></div>
    <div class="dg-day-cols">${col('🥗 Vegetarian', d.meals.veg)}${vegOnly ? '' : col('🍗 Non-vegetarian', d.meals.nonveg)}</div>`;
}

function renderChips() {
  const chips = [{ id: 'all', name: 'All', icon: '✨' }, ...FOODS];
  document.getElementById('dg-chips').innerHTML = chips.map((c) =>
    `<button type="button" class="wg-chip${food === c.id ? ' on' : ''}" data-food="${c.id}" aria-pressed="${food === c.id}">${c.icon} ${esc(c.name)}</button>`).join('')
    + `<label class="dg-veg"><input type="checkbox" id="dg-veg" ${vegOnly ? 'checked' : ''}> 🌱 Vegetarian only</label>`;
}

function renderFoods() {
  let shown = 0;
  document.getElementById('dg-foods').innerHTML = FOODS.filter((g) => food === 'all' || g.id === food).map((g) => {
    const items = g.items.filter((it) => (!vegOnly || it[5]) && (!q || `${it[0]} ${it[4]}`.toLowerCase().includes(q)));
    if (!items.length) return '';
    shown += items.length;
    return `<article class="wg-group" style="--wg-c:${g.color}">
        <header><h3>${g.icon} ${esc(g.name)}</h3><p>${esc(g.intro)}</p></header>
        <div class="table-responsive"><table class="dg-table">
          <thead><tr><th>Food</th><th>Amount</th><th class="num">Protein</th><th class="num">Calories</th><th>Note</th></tr></thead>
          <tbody>${items.map(([n, amt, p, kcal, note, veg]) => `<tr>
            <td><span class="dg-dot ${veg ? 'veg' : 'nonveg'}" title="${veg ? 'Vegetarian' : 'Non-vegetarian'}" aria-label="${veg ? 'Vegetarian' : 'Non-vegetarian'}"></span>${esc(n)}</td>
            <td>${esc(amt)}</td><td class="num">${p} g</td><td class="num">${kcal}</td><td class="dg-note">${esc(note)}</td></tr>`).join('')}</tbody>
        </table></div>
      </article>`;
  }).join('');
  document.getElementById('dg-empty').hidden = shown > 0;
}

function renderStatic() {
  document.getElementById('dg-basics').innerHTML = BASICS.map(([i, t, d]) => `
    <div class="wg-rule"><span aria-hidden="true">${i}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></div>`).join('');
  document.getElementById('dg-supps').innerHTML = SUPPS.map(([i, t, d]) => `
    <li><span aria-hidden="true">${i}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('');
}

function init() {
  renderGoal(); renderChips(); renderFoods(); renderStatic();
  document.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => { goal = b.dataset.goal; renderGoal(); }));
  document.getElementById('dg-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-food]'); if (!b) return;
    food = b.dataset.food; renderChips(); renderFoods();
  });
  document.getElementById('dg-chips').addEventListener('change', (e) => {
    if (e.target.id !== 'dg-veg') return;
    vegOnly = e.target.checked; renderFoods(); renderDay();
  });
  let t;
  document.getElementById('dg-search').addEventListener('input', (e) => {
    clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); renderFoods(); }, 120);
  });
}

/** Guide markup for the Member and Trainer portals (the admin page has it in its HTML). */
function guideHtml(note) {
  return `<div class="wg-wrap wg-embed">
    ${note ? `<p class="wg-shared" role="note">${esc(note)}</p>` : ''}
    <section class="wg-goal" aria-labelledby="dg-goal-title">
      <div class="wg-goal-head">
        <h2 id="dg-goal-title">Choose a goal</h2>
        <div class="wg-seg" role="tablist" aria-label="Diet goal">
          <button type="button" role="tab" data-goal="bulk" aria-selected="true">💪 Bulking</button>
          <button type="button" role="tab" data-goal="cut" aria-selected="false">🔥 Cutting</button>
          <button type="button" role="tab" data-goal="recomp" aria-selected="false">⚖️ Maintain / Recomp</button>
        </div>
      </div>
      <div class="wg-goal-body" id="dg-goal-body"></div>
    </section>
    <section class="dg-day" id="dg-day" aria-label="Example day of eating"></section>
    <section aria-labelledby="dg-foods-title">
      <div class="wg-section-head">
        <h2 id="dg-foods-title">Foods &amp; what they give you</h2>
        <div class="wg-tools">
          <div class="wg-chips" id="dg-chips" role="group" aria-label="Food type"></div>
          <input type="search" id="dg-search" class="wg-search" placeholder="Search a food…" aria-label="Search a food">
        </div>
      </div>
      <div id="dg-foods"></div>
      <p class="wg-empty" id="dg-empty" hidden>Nothing matches that search.</p>
      <p class="dg-legend"><span class="dg-dot veg"></span> Vegetarian <span class="dg-dot nonveg"></span> Non-vegetarian · values are typical approximations.</p>
    </section>
    <section aria-labelledby="dg-basics-title">
      <div class="wg-section-head"><h2 id="dg-basics-title">Basics that always apply</h2></div>
      <div class="wg-rules" id="dg-basics"></div>
    </section>
    <section aria-labelledby="dg-supps-title">
      <div class="wg-section-head"><h2 id="dg-supps-title">Supplements — what is worth it</h2></div>
      <ul class="dg-supps" id="dg-supps"></ul>
      <p class="wg-disclaimer">General nutrition guidance for healthy adults, not medical advice. People with diabetes, kidney or heart disease, thyroid problems, pregnancy or eating disorders should follow a doctor or registered dietitian.</p>
    </section>
  </div>`;
}

/** Puts the same read-only guide into a Member / Trainer portal page. */
function mountDietGuide(root, { note = '' } = {}) {
  if (!root || document.getElementById('dg-goal-body')) return;
  root.innerHTML = guideHtml(note);
  init();
}
window.VirtexDietGuide = { mount: mountDietGuide };

// Admin page: the markup is already in the HTML.
const autoInit = () => { if (document.getElementById('dg-goal-body')) init(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit); else autoInit();
