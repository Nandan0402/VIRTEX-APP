/**
 * workoutGuide.js — Admin → Workouts (admin-workout-management.html): a read-only workout reference.
 * Explains which exercises train which muscle (chest, upper lats, delts, arms, legs, core) and how to
 * train for bulking, cutting or maintenance. Static content: no API calls and no client workout data.
 * The same guide is shown read-only in the Member Portal (member-workouts.html) via
 * window.VirtexWorkoutGuide.mount(element).
 */

// ------------------------------------------------------------------ goals
const GOALS = {
  bulk: {
    title: 'Bulking — build muscle and size',
    summary: 'Eat a little more than you burn and train hard with plenty of volume. Aim to gain slowly so most of the weight is muscle.',
    rows: [
      ['Calories', 'About 250–500 kcal above maintenance'],
      ['Body-weight change', 'Gain about 0.25–0.5% of body weight per week (≈ 0.2–0.4 kg for a 75 kg person)'],
      ['Protein', '1.6–2.2 g per kg of body weight per day'],
      ['Reps', 'Mostly 6–12 per set; heavy compound lifts 4–8'],
      ['Sets', '12–20 hard sets per muscle per week, split over 2 sessions'],
      ['Effort', 'Stop 1–2 reps before failure (RIR 1–2); last set of isolation work can go to failure'],
      ['Rest', '2–3 min on big compound lifts, 60–90 s on isolation'],
      ['Progress', 'Add a rep or a little weight each week (progressive overload)'],
      ['Cardio', '2–3 × 20–30 min easy cardio for heart health and recovery'],
    ],
    scheme: { compound: '4 × 6–10', isolation: '3 × 10–15', note: 'add reps or weight every week' },
  },
  cut: {
    title: 'Cutting — lose fat, keep muscle',
    summary: 'Eat less than you burn, keep lifting heavy so the body keeps its muscle, and add more daily movement. Lose fat slowly.',
    rows: [
      ['Calories', 'About 300–500 kcal below maintenance'],
      ['Body-weight change', 'Lose about 0.5–1% of body weight per week'],
      ['Protein', 'Higher: 2.0–2.4 g per kg of body weight per day (protects muscle)'],
      ['Reps', 'Keep the same rep ranges as bulking (6–12); keep one heavy lift per muscle at 4–8 reps'],
      ['Sets', '10–14 hard sets per muscle per week — slightly less than bulking, recovery is lower'],
      ['Effort', 'RIR 1–3; avoid grinding to failure on heavy compound lifts'],
      ['Rest', 'Same as bulking — do not turn weight training into cardio'],
      ['Progress', 'Goal is to keep strength. Holding your weights steady during a cut is a win'],
      ['Cardio', '3–5 sessions (20–40 min) + 8,000–12,000 steps a day'],
    ],
    scheme: { compound: '3 × 6–8 (keep the weight heavy)', isolation: '2–3 × 10–15', note: 'keep strength, trim accessory sets' },
  },
  recomp: {
    title: 'Maintain / recomposition — get leaner and stronger slowly',
    summary: 'Eat around maintenance with high protein. Good for beginners and people returning to training: they can lose some fat and gain some muscle at the same time.',
    rows: [
      ['Calories', 'Around maintenance (±100 kcal)'],
      ['Body-weight change', 'Roughly stable; waist goes down while strength goes up'],
      ['Protein', '1.8–2.2 g per kg of body weight per day'],
      ['Reps', '6–12 for most work, 4–8 on one heavy lift per session'],
      ['Sets', '10–16 hard sets per muscle per week'],
      ['Effort', 'RIR 1–2'],
      ['Rest', '2–3 min compounds, 60–90 s isolation'],
      ['Progress', 'Add reps first, then weight'],
      ['Cardio', '2–4 sessions a week + 7,000–10,000 steps'],
    ],
    scheme: { compound: '3–4 × 6–10', isolation: '3 × 10–15', note: 'add reps first, then weight' },
  },
};

// ------------------------------------------------------------------ muscles
// Each part: what it does, best exercises (with one form cue each), common mistake. type: compound | isolation
const GROUPS = [
  {
    id: 'chest', name: 'Chest', icon: '🏋️', color: '#f87171',
    intro: 'The chest (pectorals) pushes the arms forward and across the body. Bench angle decides which part works most.',
    parts: [
      { name: 'Upper chest', aka: 'clavicular head', does: 'Lifts the arm forward and up. Makes the chest look full near the collarbone.',
        ex: [['Incline barbell / dumbbell press (30°)', 'Bench at 30°, not higher — steeper turns it into a shoulder press.', 'compound'],
             ['Low-to-high cable fly', 'Pull from hip height up to chin level, squeeze at the top.', 'isolation'],
             ['Incline Smith machine press', 'Bar touches the upper chest, elbows about 45° from the body.', 'compound']],
        mistake: 'Setting the bench too steep (45°+), which moves the work to the front shoulders.' },
      { name: 'Middle chest', aka: 'sternal head', does: 'Main pushing muscle. Builds overall chest thickness.',
        ex: [['Flat barbell bench press', 'Shoulder blades pulled back and down, feet planted, bar to mid-chest.', 'compound'],
             ['Flat dumbbell press', 'Lower until a deep stretch, press up and slightly in.', 'compound'],
             ['Machine chest press', 'Good for safe high-effort sets near failure.', 'compound'],
             ['Pec deck / cable fly', 'Slight bend in elbows, hug a big tree.', 'isolation']],
        mistake: 'Bouncing the bar off the chest and lifting the hips off the bench.' },
      { name: 'Lower chest', aka: 'costal fibres', does: 'Pulls the arms down and in. Gives the lower chest line.',
        ex: [['Chest dips (lean forward)', 'Lean the torso forward and let the elbows flare slightly.', 'compound'],
             ['Decline press', 'Small decline is enough; control the descent.', 'compound'],
             ['High-to-low cable fly', 'Pull from above the head down to the hips.', 'isolation']],
        mistake: 'Dipping too deep with shoulders rolled forward — stop when the upper arm is parallel to the floor.' },
    ],
  },
  {
    id: 'back', name: 'Back', icon: '🦅', color: '#38bdf8',
    intro: 'The back pulls. Vertical pulls (pull-ups, pulldowns) build width; horizontal pulls (rows) build thickness.',
    parts: [
      { name: 'Upper lats', aka: 'latissimus dorsi — upper fibres, back width', does: 'Pull the arms down from overhead. Create the V-taper.',
        ex: [['Pull-up / chin-up', 'Start from a dead hang, pull the chest to the bar, elbows to the ribs.', 'compound'],
             ['Wide-grip lat pulldown', 'Lean back slightly, pull to the upper chest, do not swing.', 'compound'],
             ['Straight-arm cable pulldown', 'Arms almost straight, sweep the bar to the thighs — feel the lats, not the triceps.', 'isolation']],
        mistake: 'Pulling with the biceps and shrugging the shoulders up to the ears.' },
      { name: 'Lower lats', aka: 'lower lat fibres', does: 'Pull the elbows down and back toward the hips.',
        ex: [['Single-arm dumbbell row', 'Row the elbow toward the hip pocket, not straight up.', 'compound'],
             ['Close-grip / neutral pulldown', 'Elbows tight to the body, finish at the lower chest.', 'compound'],
             ['Kneeling single-arm cable pulldown', 'Pull the elbow down to the side, full stretch at the top.', 'isolation']],
        mistake: 'Cutting the stretch short — let the arm go fully up between reps.' },
      { name: 'Mid back', aka: 'rhomboids, middle traps — back thickness', does: 'Squeeze the shoulder blades together; good posture.',
        ex: [['Chest-supported row (T-bar or machine)', 'Chest on the pad removes cheating; squeeze 1 s at the top.', 'compound'],
             ['Seated cable row', 'Sit tall, pull to the belly button, shoulders back.', 'compound'],
             ['Barbell bent-over row', 'Hinge to about 45°, flat back, pull to the lower ribs.', 'compound']],
        mistake: 'Using body swing to move the weight instead of the back muscles.' },
      { name: 'Upper traps', aka: 'trapezius', does: 'Shrug the shoulders up; support the neck.',
        ex: [['Dumbbell / barbell shrug', 'Straight up and down, hold 1 s at the top, no rolling.', 'isolation'],
             ['Farmer\'s carry', 'Heavy weights, walk tall for 30–40 m.', 'compound']],
        mistake: 'Rolling the shoulders in circles — it adds no benefit and strains the joint.' },
      { name: 'Lower back', aka: 'spinal erectors', does: 'Keep the spine straight while lifting and bending.',
        ex: [['Romanian deadlift', 'Hips back, bar close to the legs, flat back.', 'compound'],
             ['Back extension (45°)', 'Move from the hips, stop at a straight line — do not over-arch.', 'isolation'],
             ['Conventional deadlift', 'Brace, push the floor away, bar stays touching the legs.', 'compound']],
        mistake: 'Rounding the lower back under load.' },
    ],
  },
  {
    id: 'shoulders', name: 'Shoulders', icon: '🎯', color: '#fbbf24',
    intro: 'The deltoid has three heads. Pressing trains the front; most people need extra side- and rear-delt work for wide, healthy shoulders.',
    parts: [
      { name: 'Front delts', aka: 'anterior deltoid', does: 'Lift the arm forward. Already trained hard by every chest press.',
        ex: [['Overhead press (barbell or dumbbell)', 'Squeeze glutes, press straight up, head through at the top.', 'compound'],
             ['Seated dumbbell shoulder press', 'Elbows slightly in front of the body.', 'compound']],
        mistake: 'Adding lots of front raises on top of heavy pressing — usually unnecessary.' },
      { name: 'Side delts', aka: 'lateral deltoid — shoulder width', does: 'Lift the arm out to the side. Makes the shoulders look wider.',
        ex: [['Dumbbell lateral raise', 'Lead with the elbows, raise to shoulder height, slow on the way down.', 'isolation'],
             ['Cable lateral raise', 'Constant tension; cable starts behind or in front of the body.', 'isolation'],
             ['Machine lateral raise', 'Great for high-rep sets of 12–20.', 'isolation']],
        mistake: 'Going too heavy and swinging — light weight, strict form, more reps.' },
      { name: 'Rear delts', aka: 'posterior deltoid', does: 'Pull the arm backward. Balance the shoulder and improve posture.',
        ex: [['Reverse pec deck', 'Arms slightly bent, sweep back, do not squeeze the shoulder blades hard.', 'isolation'],
             ['Face pull', 'Rope to the forehead, elbows high, thumbs pull back.', 'isolation'],
             ['Bent-over reverse fly', 'Chest down, small weights, controlled.', 'isolation']],
        mistake: 'Turning rear-delt work into a back row by squeezing the shoulder blades.' },
    ],
  },
  {
    id: 'arms', name: 'Arms', icon: '💪', color: '#a78bfa',
    intro: 'Triceps are about two-thirds of the upper arm. Train both biceps and triceps through a full stretch.',
    parts: [
      { name: 'Biceps', aka: 'long head (peak) & short head (thickness)', does: 'Bend the elbow and turn the palm up.',
        ex: [['Incline dumbbell curl', 'Arms hang behind the body — big stretch for the long head.', 'isolation'],
             ['Barbell / EZ-bar curl', 'Elbows pinned to the sides, no swinging.', 'isolation'],
             ['Preacher curl', 'Short-head focus; control the bottom, do not drop.', 'isolation']],
        mistake: 'Half reps and swinging the back to lift heavier weight.' },
      { name: 'Brachialis & forearms', aka: 'under the biceps; grip muscles', does: 'Elbow strength, arm thickness and grip.',
        ex: [['Hammer curl', 'Neutral grip (thumbs up), curl across or straight.', 'isolation'],
             ['Reverse-grip curl', 'Palms down, lighter weight.', 'isolation'],
             ['Wrist curl / dead hang', 'For grip and forearm size.', 'isolation']],
        mistake: 'Ignoring grip, then grip fails first on rows and deadlifts.' },
      { name: 'Triceps', aka: 'long, lateral and medial heads', does: 'Straighten the elbow. The long head also pulls the arm down.',
        ex: [['Overhead cable / dumbbell extension', 'Arm overhead stretches the long head — best for size.', 'isolation'],
             ['Close-grip bench press', 'Hands shoulder-width, elbows tucked.', 'compound'],
             ['Rope pushdown', 'Elbows fixed, spread the rope at the bottom.', 'isolation'],
             ['Skull crusher (EZ bar)', 'Lower to the forehead or behind the head, elbows steady.', 'isolation']],
        mistake: 'Elbows flaring and moving — turns it into a chest press.' },
    ],
  },
  {
    id: 'legs', name: 'Legs & glutes', icon: '🦵', color: '#4ade80',
    intro: 'The biggest muscles in the body. Squats and leg presses train the front; hinges (RDLs) and curls train the back.',
    parts: [
      { name: 'Quads', aka: 'front of the thigh', does: 'Straighten the knee: squat, climb, jump.',
        ex: [['Back squat / front squat', 'Brace, sit between the heels, knees track over the toes.', 'compound'],
             ['Leg press', 'Feet shoulder-width and lower on the platform for more quads; full depth without the hips lifting.', 'compound'],
             ['Hack squat', 'Deep and controlled — great quad builder.', 'compound'],
             ['Leg extension', 'Pause 1 s at the top.', 'isolation']],
        mistake: 'Cutting depth short to lift heavier weight.' },
      { name: 'Hamstrings', aka: 'back of the thigh', does: 'Bend the knee and extend the hip.',
        ex: [['Romanian deadlift', 'Soft knees, push the hips back until a deep stretch.', 'compound'],
             ['Seated / lying leg curl', 'Seated version gives a better stretch.', 'isolation'],
             ['Nordic curl (assisted)', 'Lower slowly; great for injury prevention.', 'isolation']],
        mistake: 'Only training quads — keep hamstrings strong to protect the knees.' },
      { name: 'Glutes', aka: 'gluteus maximus & medius', does: 'Extend the hip and keep the pelvis level.',
        ex: [['Hip thrust', 'Chin tucked, ribs down, squeeze 1 s at the top.', 'compound'],
             ['Bulgarian split squat', 'Lean slightly forward for more glutes.', 'compound'],
             ['Cable hip abduction', 'For the side glute (glute medius).', 'isolation']],
        mistake: 'Arching the lower back at the top of hip thrusts instead of squeezing the glutes.' },
      { name: 'Calves', aka: 'gastrocnemius & soleus', does: 'Push up onto the toes.',
        ex: [['Standing calf raise', 'Full stretch at the bottom, 1 s pause, all the way up.', 'isolation'],
             ['Seated calf raise', 'Bent knee targets the soleus.', 'isolation']],
        mistake: 'Fast bouncing reps — calves need a pause at the bottom.' },
    ],
  },
  {
    id: 'core', name: 'Core', icon: '🧱', color: '#f472b6',
    intro: 'The core keeps the spine stable. Visible abs come from low body fat (a cut); training makes them stronger and thicker.',
    parts: [
      { name: 'Upper & lower abs', aka: 'rectus abdominis', does: 'Bend the spine forward; brace for heavy lifts.',
        ex: [['Cable crunch', 'Curl the ribs toward the hips, hips stay still.', 'isolation'],
             ['Hanging knee / leg raise', 'Curl the pelvis up, no swinging.', 'isolation'],
             ['Ab wheel rollout', 'Ribs down, go only as far as you can keep a flat back.', 'isolation']],
        mistake: 'Hundreds of fast crunches — add weight and slow down instead.' },
      { name: 'Obliques', aka: 'sides of the waist', does: 'Twist and bend sideways; resist rotation.',
        ex: [['Pallof press', 'Press the cable out and resist being pulled sideways.', 'isolation'],
             ['Side plank', '30–45 s each side, straight body line.', 'isolation'],
             ['Cable woodchop', 'Rotate from the torso, arms stay long.', 'isolation']],
        mistake: 'Very heavy side bends — they rarely help and can strain the back.' },
      { name: 'Deep core', aka: 'transverse abdominis & lower-back stabilisers', does: 'Brace the trunk so the spine stays safe under load.',
        ex: [['Plank / dead bug', 'Lower back gently pressed toward the floor.', 'isolation'],
             ['Bird dog', 'Opposite arm and leg, no rotation of the hips.', 'isolation']],
        mistake: 'Holding the breath without bracing — breathe in, brace, then lift.' },
    ],
  },
];

// ------------------------------------------------------------------ weekly plans
const SPLITS = [
  { name: 'Push / Pull / Legs', days: '6 days (or 3 days, once each)', best: 'Bulking · intermediate', icon: '💪',
    plan: [['Push', 'Chest, shoulders, triceps — bench, incline press, overhead press, lateral raise, pushdown'],
           ['Pull', 'Back, rear delts, biceps — pull-up, row, pulldown, face pull, curl'],
           ['Legs', 'Quads, hamstrings, glutes, calves, core — squat, RDL, leg press, leg curl, calf raise']] },
  { name: 'Upper / Lower', days: '4 days', best: 'Cutting · bulking · most people', icon: '⚖️',
    plan: [['Upper A', 'Bench, row, overhead press, pulldown, curls, triceps'],
           ['Lower A', 'Squat, RDL, leg curl, calf raise, abs'],
           ['Upper B', 'Incline press, chest-supported row, lateral raise, pull-up, arms'],
           ['Lower B', 'Leg press / hack squat, hip thrust, leg extension, calves, abs']] },
  { name: 'Full body', days: '3 days (e.g. Mon / Wed / Fri)', best: 'Beginners · busy schedules · recomp', icon: '🌱',
    plan: [['Every session', 'One squat or leg press, one press, one row or pulldown, one hinge (RDL or hip thrust), one arm or core exercise'],
           ['Progress', 'Add a rep or 2.5 kg each week while form stays clean']] },
];

const RULES = [
  ['📈', 'Progressive overload', 'Muscles grow when the work gets slightly harder over time — one more rep, a little more weight or one more set.'],
  ['🎯', 'Full range of motion', 'Train through a full stretch. Partial reps build less muscle and hide weak points.'],
  ['🔥', 'Warm up', '5 min of easy cardio, then 2–3 lighter ramp-up sets of the first exercise.'],
  ['🧘', 'Form before weight', 'If the lower back rounds, hips lift or the body swings, the weight is too heavy.'],
  ['😴', 'Recovery', '7–9 hours of sleep. Train a muscle again after 48–72 h. Take a lighter "deload" week every 6–8 weeks.'],
  ['🍗', 'Protein every day', 'Spread protein over 3–5 meals (about 0.4 g per kg per meal). It matters for bulking and cutting.'],
  ['📝', 'Track it', 'Write down weights and reps. Weigh in 3–4 mornings a week and use the weekly average.'],
  ['🩺', 'Pain is a stop sign', 'Sharp or joint pain means stop the exercise. Muscle burn and soreness are normal; joint pain is not.'],
];

// ------------------------------------------------------------------ rendering
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let goal = 'bulk';
let area = 'all';
let q = '';

function renderGoal() {
  const g = GOALS[goal];
  document.getElementById('wg-goal-body').innerHTML = `
    <div class="wg-goal-intro"><h3>${esc(g.title)}</h3><p>${esc(g.summary)}</p></div>
    <dl class="wg-goal-grid">${g.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  document.querySelectorAll('[data-goal]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.goal === goal)));
}

function renderChips() {
  const chips = [{ id: 'all', name: 'All', icon: '✨' }, ...GROUPS];
  document.getElementById('wg-chips').innerHTML = chips.map((c) =>
    `<button type="button" class="wg-chip${area === c.id ? ' on' : ''}" data-area="${c.id}" aria-pressed="${area === c.id}">${c.icon} ${esc(c.name)}</button>`).join('');
}

function matches(group, part) {
  if (!q) return true;
  const hay = [group.name, part.name, part.aka, part.does, ...part.ex.map((e) => e[0])].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderGroups() {
  const scheme = GOALS[goal].scheme;
  let shown = 0;
  const html = GROUPS.filter((g) => area === 'all' || g.id === area).map((g) => {
    const parts = g.parts.filter((p) => matches(g, p));
    if (!parts.length) return '';
    shown += parts.length;
    return `<article class="wg-group" style="--wg-c:${g.color}" id="wg-${g.id}">
        <header><h3>${g.icon} ${esc(g.name)}</h3><p>${esc(g.intro)}</p></header>
        <div class="wg-parts">${parts.map((p) => `
          <section class="wg-part">
            <h4>${esc(p.name)} <small>${esc(p.aka)}</small></h4>
            <p class="wg-does">${esc(p.does)}</p>
            <ul class="wg-ex">${p.ex.map(([name, cue, type]) => `
              <li><div class="wg-ex-top"><b>${esc(name)}</b><span class="wg-dose ${type}" title="${goal === 'bulk' ? 'Bulking' : goal === 'cut' ? 'Cutting' : 'Maintain'}: ${esc(scheme.note)}">${esc(type === 'compound' ? scheme.compound : scheme.isolation)}</span></div>
                <span class="wg-cue">${esc(cue)}</span></li>`).join('')}
            </ul>
            <p class="wg-mistake"><span aria-hidden="true">⚠️</span> ${esc(p.mistake)}</p>
          </section>`).join('')}
        </div>
      </article>`;
  }).join('');
  document.getElementById('wg-groups').innerHTML = html;
  document.getElementById('wg-empty').hidden = shown > 0;
}

function renderStatic() {
  document.getElementById('wg-splits').innerHTML = SPLITS.map((s) => `
    <article class="wg-split"><header><h3>${s.icon} ${esc(s.name)}</h3><span>${esc(s.days)}</span></header>
      <p class="wg-best">Best for: ${esc(s.best)}</p>
      <dl>${s.plan.map(([d, w]) => `<div><dt>${esc(d)}</dt><dd>${esc(w)}</dd></div>`).join('')}</dl></article>`).join('');
  document.getElementById('wg-rules').innerHTML = RULES.map(([i, t, d]) => `
    <div class="wg-rule"><span aria-hidden="true">${i}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></div>`).join('');
}

function init() {
  renderGoal(); renderChips(); renderGroups(); renderStatic();
  document.querySelectorAll('[data-goal]').forEach((b) => b.addEventListener('click', () => { goal = b.dataset.goal; renderGoal(); renderGroups(); }));
  document.getElementById('wg-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]'); if (!b) return;
    area = b.dataset.area; renderChips(); renderGroups();
  });
  let t;
  document.getElementById('wg-search').addEventListener('input', (e) => {
    clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim().toLowerCase(); renderGroups(); }, 120);
  });
}

/** Guide markup for the Member Portal (the admin page has it in its HTML). */
function guideHtml(note) {
  return `<div class="wg-wrap wg-embed">
    ${note ? `<p class="wg-shared" role="note">${note}</p>` : ''}
    <section class="wg-goal" aria-labelledby="wg-goal-title">
      <div class="wg-goal-head">
        <h2 id="wg-goal-title">Choose a goal</h2>
        <div class="wg-seg" role="tablist" aria-label="Training goal">
          <button type="button" role="tab" data-goal="bulk" aria-selected="true">💪 Bulking</button>
          <button type="button" role="tab" data-goal="cut" aria-selected="false">🔥 Cutting</button>
          <button type="button" role="tab" data-goal="recomp" aria-selected="false">⚖️ Maintain / Recomp</button>
        </div>
      </div>
      <div class="wg-goal-body" id="wg-goal-body"></div>
    </section>
    <section aria-labelledby="wg-muscles-title">
      <div class="wg-section-head">
        <h2 id="wg-muscles-title">Muscles &amp; the best exercises</h2>
        <div class="wg-tools">
          <div class="wg-chips" id="wg-chips" role="group" aria-label="Body area"></div>
          <input type="search" id="wg-search" class="wg-search" placeholder="Search a muscle or exercise…" aria-label="Search a muscle or exercise">
        </div>
      </div>
      <div id="wg-groups"></div>
      <p class="wg-empty" id="wg-empty" hidden>Nothing matches that search.</p>
    </section>
    <section aria-labelledby="wg-splits-title">
      <div class="wg-section-head"><h2 id="wg-splits-title">Example weekly plans</h2></div>
      <div class="wg-splits" id="wg-splits"></div>
    </section>
    <section aria-labelledby="wg-rules-title">
      <div class="wg-section-head"><h2 id="wg-rules-title">Rules that always apply</h2></div>
      <div class="wg-rules" id="wg-rules"></div>
      <p class="wg-disclaimer">General fitness guidance for healthy adults, not medical advice. People with injuries, heart conditions, pregnancy or other health issues should get clearance from a doctor or physiotherapist first.</p>
    </section>
  </div>`;
}

/** Puts the same read-only guide into a Member Portal page. `note` is plain text. */
function mountWorkoutGuide(root, { note = '' } = {}) {
  if (!root || document.getElementById('wg-goal-body')) return;
  const safe = String(note).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  root.innerHTML = guideHtml(safe);
  init();
}
window.VirtexWorkoutGuide = { mount: mountWorkoutGuide };

// Admin page: the markup is already in the HTML.
const autoInit = () => { if (document.getElementById('wg-goal-body')) init(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit); else autoInit();
