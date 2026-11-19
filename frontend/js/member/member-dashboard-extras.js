/** Virtex Member Portal — dashboard extras (migration 031), from GET /api/v1/member/fee-status:
 *  - Fee countdown: shown from 7 days before the due date (and while overdue) until the gym records the payment.
 *  - "My week": the Mon–Sun planner of the member's fee plan (PT days, self-training, ladies-only, rest).
 *  - Girls / Boys: own colour theme + tips (body class mp-girls / mp-boys).
 */
import { esc } from './member-navigation.js';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const TYPE = {
  pt: ['🤝', 'With trainer'], self: ['🏋️', 'Self-training'], ladies: ['👩', 'Ladies-only'], rest: ['😴', 'Rest'],
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const to12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

const TIPS = {
  female: [
    ['💪', 'Lift with confidence', 'Strength training builds lean, toned muscle and stronger bones — it will not make you "bulky".'],
    ['🩸', 'Iron & calcium', 'Include dal, greens, curd, paneer, ragi and eggs. Ask a doctor about an iron test if you often feel tired.'],
    ['🌙', 'Listen to your cycle', 'On low-energy days, keep the session lighter (mobility, walking, yoga) instead of skipping completely.'],
    ['👩', 'Ladies-only batch', 'Your plan’s ladies-only days are shown in “My week”. Ask the front desk to change your timing.'],
  ],
  male: [
    ['🏋️', 'Progressive overload', 'Add a little weight or one more rep each week — that is what builds strength and muscle.'],
    ['🥚', 'Protein every meal', 'Aim for 1.6–2.2 g per kg body weight a day: eggs, chicken, paneer, dal, curd, whey if needed.'],
    ['🦵', 'Do not skip legs', 'Squats, lunges and deadlifts build the whole body and protect your knees and back.'],
    ['😴', 'Recover to grow', 'Sleep 7–9 hours. Muscles grow when you rest, not only when you train.'],
  ],
};

/** Applies the girls / boys theme to the page (kept for this visit only). */
export function applyGenderTheme(gender) {
  document.body.classList.toggle('mp-girls', gender === 'female');
  document.body.classList.toggle('mp-boys', gender === 'male');
}

/** Fee countdown banner, or '' when nothing needs paying soon. */
export function feeBanner(fee) {
  if (!fee || !fee.showAlert) return '';
  const overdue = fee.state === 'overdue';
  const days = Math.abs(fee.daysLeft ?? 0);
  const big = fee.daysLeft === null ? 'Due' : overdue ? `${days}` : fee.daysLeft === 0 ? 'Today' : `${days}`;
  const unit = fee.daysLeft === null || fee.daysLeft === 0 ? '' : `day${days === 1 ? '' : 's'} ${overdue ? 'overdue' : 'left'}`;
  return `<section class="mdx-fee ${overdue ? 'overdue' : 'soon'}" role="alert" aria-live="polite">
    <div class="mdx-fee-count" aria-hidden="true"><b>${esc(big)}</b><span>${esc(unit)}</span></div>
    <div class="mdx-fee-text">
      <h2>${overdue ? '🚨 Your fees are overdue' : '⏳ Your fees are due soon'}</h2>
      <p><b>${money(fee.due)}</b> ${fee.dueDate ? `${overdue ? 'was due on' : 'due on'} <b>${esc(fmtDay(fee.dueDate))}</b>` : 'is due'}. Please pay at the front desk${overdue ? ' — unpaid accounts can be frozen' : ''}.</p>
      <small>This alert disappears once the gym records your payment.</small>
    </div>
    <a class="btn btn-outline" href="member-payments.html">View payments</a>
  </section>`;
}

/** "My week" from the member's fee plan. */
export function weekCard(plan, gender) {
  if (!plan) return '';
  const ws = plan.weeklySchedule || {};
  const set = DAYS.filter(([k]) => ws[k]);
  const todayKey = DAYS[(new Date().getDay() + 6) % 7][0];
  const body = set.length
    ? `<ol class="mdx-week">${DAYS.map(([k, l]) => {
        const d = ws[k];
        const [ico, label] = d ? TYPE[d.type] || ['•', d.type] : ['·', 'Not set'];
        return `<li class="mdx-day ${d ? d.type : 'none'}${k === todayKey ? ' today' : ''}"${k === todayKey ? ' aria-current="date"' : ''}>
          <span class="mdx-dname">${l}${k === todayKey ? ' · today' : ''}</span>
          <span class="mdx-dico" aria-hidden="true">${ico}</span>
          <span class="mdx-dlabel">${esc(label)}</span>
          ${d && d.start ? `<span class="mdx-dtime">${esc(to12(d.start))} – ${esc(to12(d.end))}</span>` : ''}
        </li>`;
      }).join('')}</ol>`
    : '<p class="mp-muted">Your gym has not set a weekly plan for this fee plan yet.</p>';
  const ladies = set.filter(([k]) => ws[k].type === 'ladies').length;
  return `<section class="card mdx-week-card" aria-labelledby="mdx-week-h">
    <div class="md-section-head"><h2 id="mdx-week-h">🗓️ My week</h2><span class="mp-muted">${esc(plan.name || '')}${plan.audience === 'girls' ? ' · Girls plan' : plan.audience === 'boys' ? ' · Boys plan' : ''}</span></div>
    ${body}
    ${gender === 'female' && ladies ? `<p class="mdx-note">👩 You have ${ladies} ladies-only day${ladies === 1 ? '' : 's'} each week.</p>` : ''}
  </section>`;
}

/** Girls / boys tips card ('' when gender is not set). */
export function tipsCard(gender) {
  const tips = TIPS[gender];
  if (!tips) return '';
  return `<section class="card mdx-tips" aria-labelledby="mdx-tips-h">
    <div class="md-section-head"><h2 id="mdx-tips-h">${gender === 'female' ? '🌸 Tips for you' : '⚡ Tips for you'}</h2></div>
    <ul>${tips.map(([i, t, d]) => `<li><span aria-hidden="true">${i}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join('')}</ul>
  </section>`;
}
