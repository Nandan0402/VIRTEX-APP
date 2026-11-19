/**
 * Virtex Member Portal — member-nutrition-progress.js: Macro & Nutrition Progress Analytics.
 *
 * Displays:
 * - Daily calorie intake (vs target, deficit/surplus, status)
 * - Protein progress (actual vs target, remaining/excess)
 * - Carbohydrate progress (actual vs target, remaining/excess)
 * - Fat progress (actual vs target, remaining/excess)
 * - Water intake (actual vs target, visual hydration bar)
 * - Meal completion (Breakfast, Lunch, Dinner, Snacks itemized completion)
 * - Weekly nutrition history (7 days with distinct missing vs zero-intake representation)
 * - Monthly nutrition trends (30-day consistency, averages, macro split ratio, timeline chart)
 * - Trainer Hub nutrition monitoring connection (sync status, coach notes)
 */

import { api, ApiError } from './member-api.js';
import { initShell, esc, notice, emptyState } from './member-navigation.js';

const shell = await initShell({
  page: 'nutrition-progress',
  title: 'Nutrition Progress',
  subtitle: 'Daily macro progress, hydration, meal completion, and long-term nutrition trends',
});

const NONE = '<span class="np-val-null">—</span>';
const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fmt = (v, unit = '', d = 0) => (n(v) === null ? NONE : `${esc(n(v).toLocaleString(undefined, { maximumFractionDigits: d }))}${unit}`);
const fmtG = (v, d = 0) => (n(v) === null ? NONE : `${esc(n(v).toLocaleString(undefined, { maximumFractionDigits: d }))}g`);
const fmtKcal = (v) => (n(v) === null ? NONE : `${esc(Math.round(n(v)).toLocaleString())} kcal`);
const fmtMl = (v) => (n(v) === null ? NONE : `${esc(Math.round(n(v)).toLocaleString())} ml`);

function getRelativeDateStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

if (shell) {
  const { content } = shell;

  let selectedDate = getRelativeDateStr(0);
  let progressData = null;
  let isLoading = false;
  let loadError = '';

  async function loadData(dateStr) {
    isLoading = true;
    render();
    loadError = '';
    try {
      progressData = (await api.get('/nutrition-progress', { date: dateStr })).data || null;
      if (!progressData) loadError = 'No data returned.';
    } catch (err) {
      // No substitute numbers: if the records cannot be read, say so.
      progressData = null;
      loadError = err instanceof ApiError ? err.message : 'Network error.';
    } finally {
      isLoading = false;
      render();
    }
  }

  function renderHeaderBar() {
    const isToday = selectedDate === getRelativeDateStr(0);
    return `
      <div class="np-header-bar">
        <div class="np-date-nav">
          <button type="button" class="btn-date-nav" id="np-btn-prev" title="Previous Day">‹ Previous</button>
          <input type="date" class="np-date-input" id="np-date-picker" value="${esc(selectedDate)}" max="${esc(getRelativeDateStr(0))}" />
          <button type="button" class="btn-date-nav" id="np-btn-next" title="Next Day" ${isToday ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>Next ›</button>
          <button type="button" class="btn-date-nav" id="np-btn-today" style="${isToday ? 'border-color:#00e676;color:#00e676;' : ''}">Today</button>
        </div>
        <div class="np-actions">
          <a href="member-food-diary.html?date=${encodeURIComponent(selectedDate)}" class="btn btn-green" style="text-decoration:none;font-size:0.85rem;padding:0.45rem 0.9rem;">
            🍽️ Log in Food Diary
          </a>
          <a href="member-diet-plan.html" class="btn btn-outline" style="text-decoration:none;font-size:0.85rem;padding:0.45rem 0.9rem;">
            🥗 View Diet Plan
          </a>
        </div>
      </div>
    `;
  }

  function renderDailyOverview(today, targets) {
    if (!today) return '';

    const hasTarget = targets && targets.calories > 0;
    const isMissing = today.isMissing;
    const isZero = today.isZeroIntake;

    // Daily Calorie Hero Card
    let calDisplay = NONE;
    let calSub = '';
    let calPct = 0;
    let badgeHtml = '';

    if (isMissing) {
      calDisplay = '<span class="np-val-null">—</span>';
      badgeHtml = `<span class="badge-np missing" title="No food log was submitted for this date">⚠️ Missing Data</span>`;
      calSub = `<span>Prescribed Target: <strong>${hasTarget ? fmtKcal(targets.calories) : '—'}</strong></span>`;
    } else if (isZero) {
      calDisplay = `<span style="color:#60a5fa;">0 kcal</span>`;
      badgeHtml = `<span class="badge-np zero-intake" title="You saved this day with no food entries — recorded as zero intake">0 kcal recorded</span>`;
      calSub = `<span>Target: <strong>${hasTarget ? fmtKcal(targets.calories) : '—'}</strong></span>`;
    } else {
      calDisplay = fmtKcal(today.calories);
      if (hasTarget) {
        const rawPct = Math.round((today.calories / targets.calories) * 100);
        calPct = Math.min(100, rawPct);
        const diff = Math.round(today.calories - targets.calories);
        const diffStr = diff > 0 ? `+${diff.toLocaleString()} kcal over target` : diff < 0 ? `${Math.abs(diff).toLocaleString()} kcal under target` : 'On target';
        badgeHtml = `<span class="badge-np logged">✓ Logged · ${rawPct}% of target</span>`;
        calSub = `<span>Target: <strong>${fmtKcal(targets.calories)}</strong> · <span style="color:${diff > 100 ? '#f59e0b' : diff < -300 ? '#38bdf8' : '#00e676'}">${diffStr}</span></span>`;
      } else {
        badgeHtml = '<span class="badge-np logged">✓ Logged</span>';
        calSub = '<span>No calorie target in your diet plan</span>';
      }
    }

    // Macro Cards helper
    function getMacroCard(title, actual, target, fillClass, icon) {
      let valHtml = NONE;
      let pct = 0;
      let subText = '';
      if (isMissing) {
        valHtml = '<span class="np-val-null">—</span>';
        subText = `Target: <strong>${target ? fmtG(target) : '—'}</strong> · <span class="np-val-null">Unlogged</span>`;
      } else if (n(actual) === null) {
        valHtml = NONE;
        subText = 'Not recorded in this diary';
      } else {
        valHtml = n(actual) === 0 ? '<span style="color:#60a5fa;">0g</span>' : fmtG(actual, 1);
        if (target) {
          const rawPct = Math.round((n(actual) / target) * 100);
          pct = Math.min(100, rawPct);
          const rem = Math.round(target - n(actual));
          const remStr = rem > 0 ? `${rem}g left` : rem < 0 ? `${Math.abs(rem)}g over` : 'on target';
          subText = `Target: <strong>${fmtG(target)}</strong> · <span>${remStr} (${rawPct}%)</span>`;
        } else {
          subText = 'No target in your diet plan';
        }
      }

      return `
        <div class="np-card ${isMissing ? 'is-missing' : ''}">
          <div class="np-card-header">
            <span class="np-card-title">${icon} ${esc(title)}</span>
            ${isMissing ? '<span class="badge-np missing" style="font-size:0.68rem;padding:0.2rem 0.4rem;">Not Logged</span>' : ''}
          </div>
          <div class="np-card-value">${valHtml}</div>
          <div class="np-progress-bar-wrap">
            <div class="np-progress-fill ${fillClass}" style="width: ${isMissing ? 0 : pct}%;"></div>
          </div>
          <div class="np-card-sub">${subText}</div>
        </div>
      `;
    }

    // Water Intake Card
    let waterHtml = NONE;
    let waterPct = 0;
    let waterSub = '';
    const waterTarget = n(targets?.waterMl);
    if (isMissing) {
      waterHtml = '<span class="np-val-null">—</span>';
      waterSub = `Daily Target: <strong>${waterTarget ? fmtMl(waterTarget) : '—'}</strong> · <span class="np-val-null">Unrecorded</span>`;
    } else if (n(today.waterMl) === null) {
      waterHtml = NONE;
      waterSub = 'Water was not recorded for this day';
    } else {
      waterHtml = n(today.waterMl) === 0 ? '<span style="color:#60a5fa;">0 ml</span>' : fmtMl(today.waterMl);
      if (waterTarget) {
        waterPct = Math.min(100, Math.round((n(today.waterMl) / waterTarget) * 100));
        const wDiff = Math.max(0, waterTarget - n(today.waterMl));
        waterSub = `Target: <strong>${fmtMl(waterTarget)}</strong> · <span>${wDiff === 0 ? 'Goal reached' : `${fmtMl(wDiff)} left (${waterPct}%)`}</span>`;
      } else {
        waterSub = 'No water target in your diet plan';
      }
    }

    return `
      <div class="np-cards-grid">
        <!-- Daily Calorie Hero -->
        <div class="np-card card-hero ${isMissing ? 'is-missing' : ''}">
          <div class="np-card-header">
            <span class="np-card-title">🔥 Daily Calorie Intake</span>
            ${badgeHtml}
          </div>
          <div class="np-card-value">${calDisplay}</div>
          <div class="np-progress-bar-wrap">
            <div class="np-progress-fill fill-cal" style="width: ${isMissing ? 0 : calPct}%;"></div>
          </div>
          <div class="np-card-sub">${calSub}</div>
          ${isMissing ? `
            <div class="np-missing-notice">
              <span>⚠️</span>
              <span><strong>Missing data:</strong> No food intake was logged for ${formatDateDisplay(today.date)}.</span>
            </div>
          ` : ''}
        </div>

        <!-- Protein Progress -->
        ${getMacroCard('Protein Progress', today.proteinG, targets?.proteinG, 'fill-prot', '🥩')}

        <!-- Carbohydrate Progress -->
        ${getMacroCard('Carbohydrate Progress', today.carbsG, targets?.carbsG, 'fill-carb', '🍞')}

        <!-- Fat Progress -->
        ${getMacroCard('Fat Progress', today.fatsG, targets?.fatsG, 'fill-fat', '🥑')}

        <!-- Water Intake -->
        <div class="np-card ${isMissing ? 'is-missing' : ''}">
          <div class="np-card-header">
            <span class="np-card-title">💧 Water Intake</span>
            ${isMissing ? '<span class="badge-np missing" style="font-size:0.68rem;padding:0.2rem 0.4rem;">Not Logged</span>' : ''}
          </div>
          <div class="np-card-value">${waterHtml}</div>
          <div class="np-progress-bar-wrap">
            <div class="np-progress-fill fill-water" style="width: ${isMissing ? 0 : waterPct}%;"></div>
          </div>
          <div class="np-card-sub">${waterSub}</div>
        </div>
      </div>
    `;
  }

  function renderMealCompletion(mealCompletion, isMissing) {
    if (!mealCompletion) return '';

    const meals = mealCompletion.meals || [];
    const pct = isMissing ? 0 : (mealCompletion.completionPercent || 0);
    const loggedCount = isMissing ? 0 : (mealCompletion.mealsLoggedCount || 0);

    const icons = {
      Breakfast: '🌅',
      Lunch: '🍛',
      Dinner: '🌙',
      Snacks: '🍎',
    };

    return `
      <section class="np-meal-completion-section">
        <div class="np-section-title">
          <span>🍽️ Meal Completion · ${formatDateDisplay(selectedDate)}</span>
          <span class="badge-np ${isMissing ? 'missing' : pct >= 75 ? 'logged' : 'zero-intake'}">
            ${isMissing ? '0 of 4 Meals (Unrecorded)' : `${loggedCount} of ${meals.length} Meals Logged (${pct}%)`}
          </span>
        </div>
        <p class="np-section-desc">
          Individual meal slot completion and food intake itemization recorded in your daily food diary.
        </p>

        <div class="np-meal-grid">
          ${meals.map((m) => {
            const isComp = !isMissing && m.isCompleted;
            const icon = icons[m.mealType] || '🍲';
            const items = m.items || [];
            return `
              <div class="np-meal-item-card ${isComp ? 'completed' : 'missing'}">
                <div class="np-meal-top">
                  <span class="np-meal-name">${icon} ${esc(m.mealType)}</span>
                  ${isComp
                    ? '<span class="badge-np logged" style="font-size:0.68rem;padding:0.2rem 0.45rem;">✓ Recorded</span>'
                    : '<span class="badge-np missing" style="font-size:0.68rem;padding:0.2rem 0.45rem;">Missing</span>'
                  }
                </div>
                <div class="np-meal-stats">
                  ${isComp
                    ? `<strong>${fmtKcal(m.calories)}</strong> · ${fmtG(m.proteinG)}P | ${fmtG(m.carbsG)}C | ${fmtG(m.fatsG)}F`
                    : '<span class="np-val-null">No food items logged</span>'
                  }
                </div>
                <div class="np-meal-foods">
                  ${isComp && items.length > 0
                    ? items.map((it) => `<div>• ${esc(it.food || it.foodName)} <span style="color:#94a3b8;">(${esc(it.portion || it.portionSize)})</span></div>`).join('')
                    : '<span style="color:#64748b;font-style:italic;">Empty meal slot</span>'
                  }
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function renderWeeklyHistory(weeklyHistory, targets) {
    if (!weeklyHistory || weeklyHistory.length === 0) {
      return '';
    }

    const targetKcal = targets?.calories;

    return `
      <section class="np-section-card">
        <div class="np-section-title">
          <span>📅 Weekly Nutrition History (Past 7 Days)</span>
          <span style="font-size:0.8rem;color:#94a3b8;font-weight:normal;">From your food diary</span>
        </div>
        <p class="np-section-desc">
          Each day comes from the food diary you saved. Days with no saved diary are marked as 
          <strong style="color:#fbbf24;">Missing Data</strong> rather than zero intake.
        </p>

        <div class="np-table-wrap">
          <table class="np-table">
            <thead>
              <tr>
                <th>Date & Day</th>
                <th>Status</th>
                <th>Calories</th>
                <th>Protein</th>
                <th>Carbs</th>
                <th>Fats</th>
                <th>Water</th>
                <th>Meals</th>
                <th>Adherence</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${weeklyHistory.map((d) => {
                const isSelected = d.date === selectedDate;
                let statusBadge = '';
                if (d.isMissing) {
                  statusBadge = '<span class="badge-np missing">⚠️ Not Logged</span>';
                } else if (d.isZeroIntake) {
                  statusBadge = '<span class="badge-np zero-intake">0 kcal recorded</span>';
                } else {
                  statusBadge = '<span class="badge-np logged">✓ Logged</span>';
                }

                return `
                  <tr class="${d.isMissing ? 'row-missing' : ''}" style="${isSelected ? 'background:rgba(0,230,118,0.06);border-left:3px solid #00e676;' : ''}">
                    <td>
                      <strong>${formatDateDisplay(d.date)}</strong>
                      ${isSelected ? ' <span style="font-size:0.7rem;color:#00e676;">(Viewing)</span>' : ''}
                    </td>
                    <td>${statusBadge}</td>
                    <td class="np-val-mono">
                      ${d.isMissing
                        ? '<span class="np-val-null">—</span>'
                        : `${fmtKcal(d.calories)} ${targetKcal ? `<span style="font-size:0.75rem;color:#64748b;">/ ${Math.round(targetKcal)}</span>` : ''}`
                      }
                    </td>
                    <td class="np-val-mono">${d.isMissing ? '<span class="np-val-null">—</span>' : fmtG(d.proteinG)}</td>
                    <td class="np-val-mono">${d.isMissing ? '<span class="np-val-null">—</span>' : fmtG(d.carbsG)}</td>
                    <td class="np-val-mono">${d.isMissing ? '<span class="np-val-null">—</span>' : fmtG(d.fatsG)}</td>
                    <td class="np-val-mono">${d.isMissing ? '<span class="np-val-null">—</span>' : fmtMl(d.waterMl)}</td>
                    <td>
                      ${d.isMissing
                        ? '<span class="np-val-null">—</span>'
                        : `<span style="font-weight:600;" title="${esc(String(d.mealsCount ?? 0))} food items">${d.mealSlotsLogged ?? 0} / 4</span>`
                      }
                    </td>
                    <td>
                      ${d.isMissing
                        ? '<span class="np-val-null">—</span>'
                        : n(d.adherenceScore) === null
                          ? '<span class="np-val-null" title="No calorie target to compare against">—</span>'
                          : `<span style="font-weight:700;color:${d.adherenceScore >= 85 ? '#00e676' : '#f59e0b'}">${Math.round(d.adherenceScore)}%</span>`
                      }
                    </td>
                    <td>
                      <button type="button" class="btn btn-outline btn-table-view" data-date="${esc(d.date)}" style="font-size:0.75rem;padding:0.25rem 0.55rem;">
                        View Day
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderMonthlyTrends(monthlyTrends, targets) {
    if (!monthlyTrends) return '';

    const summary = monthlyTrends.summary || {};
    const macroSplit = monthlyTrends.macroSplit || null;
    const series = monthlyTrends.dailySeries || [];
    const targetKcal = n(targets?.calories);

    // Chart scale from the target (if any) and the real logged values.
    let maxKcal = targetKcal ? targetKcal * 1.25 : 1;
    for (const item of series) {
      if (item.calories && item.calories > maxKcal) {
        maxKcal = item.calories * 1.1;
      }
    }

    return `
      <section class="np-section-card">
        <div class="np-section-title">
          <span>📈 Monthly Nutrition Trends (Past 30 Days)</span>
          <span class="badge-np logged">${summary.loggedDaysCount || 0} of 30 Days Logged</span>
        </div>
        <p class="np-section-desc">
          Long-term consistency and macro adherence. Averages are strictly calculated over 
          <strong>logged days only</strong> to avoid artificially diluting daily intake figures with missing days.
        </p>

        <!-- KPI Rollup -->
        <div class="np-trends-summary-grid">
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${summary.loggingConsistencyPercent || 0}%</div>
            <div class="np-trend-kpi-label">Logging Consistency</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">${summary.loggedDaysCount || 0} logged · ${summary.missingDaysCount || 0} missing</div>
          </div>
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${n(summary.avgCalories) !== null ? fmtKcal(summary.avgCalories) : NONE}</div>
            <div class="np-trend-kpi-label">Avg Daily Calories</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">Target: ${targetKcal ? fmtKcal(targetKcal) : '—'}</div>
          </div>
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${n(summary.avgProteinG) !== null ? fmtG(summary.avgProteinG) : NONE}</div>
            <div class="np-trend-kpi-label">Avg Daily Protein</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">Target: ${targets?.proteinG ? fmtG(targets.proteinG) : '—'}</div>
          </div>
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${n(summary.avgCarbsG) !== null ? fmtG(summary.avgCarbsG) : NONE}</div>
            <div class="np-trend-kpi-label">Avg Daily Carbs</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">Target: ${targets?.carbsG ? fmtG(targets.carbsG) : '—'}</div>
          </div>
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${n(summary.avgFatsG) !== null ? fmtG(summary.avgFatsG) : NONE}</div>
            <div class="np-trend-kpi-label">Avg Daily Fats</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">Target: ${targets?.fatsG ? fmtG(targets.fatsG) : '—'}</div>
          </div>
          <div class="np-trend-kpi">
            <div class="np-trend-kpi-val">${n(summary.avgWaterMl) !== null ? fmtMl(summary.avgWaterMl) : NONE}</div>
            <div class="np-trend-kpi-label">Avg Water Intake</div>
            <div style="font-size:0.72rem;color:#94a3b8;margin-top:0.2rem;">Target: ${targets?.waterMl ? fmtMl(targets.waterMl) : '—'}</div>
          </div>
        </div>

        <!-- Macro Ratio Split Bar -->
        ${macroSplit ? `
          <div style="margin: 1.5rem 0;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.85rem;font-weight:700;color:#cbd5e1;">Macro Split by Weight (Logged Days Average)</span>
              <span style="font-size:0.75rem;color:#94a3b8;">Protein ${macroSplit.proteinPercent}% · Carbs ${macroSplit.carbsPercent}% · Fats ${macroSplit.fatsPercent}%</span>
            </div>
            <div class="np-macro-ratio-bar">
              <div class="np-macro-seg np-seg-prot" style="width: ${macroSplit.proteinPercent}%;" title="Protein: ${macroSplit.proteinPercent}%"></div>
              <div class="np-macro-seg np-seg-carb" style="width: ${macroSplit.carbsPercent}%;" title="Carbs: ${macroSplit.carbsPercent}%"></div>
              <div class="np-macro-seg np-seg-fat" style="width: ${macroSplit.fatsPercent}%;" title="Fats: ${macroSplit.fatsPercent}%"></div>
            </div>
            <div class="np-macro-legend">
              <span style="color:#60a5fa;">● Protein (${macroSplit.proteinPercent}%)</span>
              <span style="color:#fbbf24;">● Carbohydrates (${macroSplit.carbsPercent}%)</span>
              <span style="color:#f43f5e;">● Fats (${macroSplit.fatsPercent}%)</span>
            </div>
          </div>
        ` : ''}

        <!-- 30-Day Daily Calorie Timeline Chart -->
        <div class="np-chart-card">
          <div class="np-chart-header">
            <span style="font-weight:700;font-size:0.9rem;color:#f1f5f9;">30-Day Calorie Intake Timeline</span>
            <div class="np-chart-legend">
              <div class="np-legend-item"><div class="np-legend-dot logged"></div> Logged Intake</div>
              <div class="np-legend-item"><div class="np-legend-dot missing"></div> Missing Log</div>
              <div class="np-legend-item"><div class="np-legend-dot zero"></div> 0 kcal recorded</div>
              ${targetKcal ? `<div class="np-legend-item"><div class="np-legend-dot target"></div> Target Line (${Math.round(targetKcal)} kcal)</div>` : ''}
            </div>
          </div>

          <div class="np-timeline-chart">
            <!-- Target Line -->
            ${targetKcal ? `
              <div class="np-target-line" style="bottom: ${Math.round((targetKcal / maxKcal) * 155)}px;">
                <span class="np-target-label">Target: ${Math.round(targetKcal)} kcal</span>
              </div>
            ` : ''}

            ${series.map((item, idx) => {
              const isMissing = item.isMissing;
              const isZero = item.isZeroIntake;
              const cal = item.calories || 0;
              const heightPct = isMissing ? 12 : isZero ? 6 : Math.max(8, Math.min(100, Math.round((cal / maxKcal) * 100)));
              const showDate = idx % 5 === 0 || idx === series.length - 1;
              const shortDate = item.date.slice(5);

              return `
                <div class="np-timeline-bar-wrap" data-date="${esc(item.date)}">
                  <div class="np-bar-tooltip">
                    <strong>${formatDateDisplay(item.date)}</strong><br/>
                    ${isMissing
                      ? '<span style="color:#fbbf24;">⚠️ Missing: No log submitted</span>'
                      : isZero
                      ? '<span style="color:#60a5fa;">0 kcal recorded (diary saved with no food)</span>'
                      : `Intake: <strong>${fmtKcal(cal)}</strong><br/>P: ${fmtG(item.proteinG)} | C: ${fmtG(item.carbsG)} | F: ${fmtG(item.fatsG)}<br/>Water: ${fmtMl(item.waterMl)}`
                    }
                  </div>
                  <div class="np-timeline-bar ${isMissing ? 'missing' : isZero ? 'zero-intake' : 'logged'}" style="height: ${heightPct}%;"></div>
                  ${showDate ? `<span class="np-timeline-date">${esc(shortDate)}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </section>
    `;
  }

  function renderTrainerHubConnection(trainerHub) {
    if (!trainerHub) return '';

    if (!trainerHub.isAssigned) {
      return `
      <section class="np-trainer-banner">
        <div class="np-trainer-info">
          <div class="np-trainer-avatar">🎓</div>
          <div class="np-trainer-details">
            <h4>Trainer Hub nutrition monitoring</h4>
            <p>You do not have an assigned personal trainer, so no trainer is reviewing your food diary.${trainerHub.planTrainerName ? ` Your diet plan was written by ${esc(trainerHub.planTrainerName)}.` : ''}</p>
          </div>
        </div>
        <div class="np-trainer-sync-status">
          <a href="member-trainer.html" class="btn btn-outline" style="font-size:0.75rem;padding:0.35rem 0.75rem;text-decoration:none;">🎓 My Trainer</a>
        </div>
      </section>`;
    }

    return `
      <section class="np-trainer-banner">
        <div class="np-trainer-info">
          <div class="np-trainer-avatar">🎓</div>
          <div class="np-trainer-details">
            <h4>${esc(trainerHub.trainerName || 'Your trainer')}</h4>
            <p>${trainerHub.specialty ? `${esc(trainerHub.specialty)} · ` : ''}Your assigned trainer${trainerHub.status === 'paused' ? ' (assignment paused)' : ''}</p>
            ${trainerHub.trainerNotes ? `
              <p style="margin-top:0.4rem;font-size:0.8rem;color:#e0e7ff;max-width:600px;">
                Diet plan note from your trainer: <em>${esc(trainerHub.trainerNotes)}</em>
              </p>
            ` : ''}
          </div>
        </div>

        <div class="np-trainer-sync-status">
          <span class="badge-np trainer-sync">● Visible in Trainer Hub</span>
          <span style="font-size:0.75rem;color:#c7d2fe;">
            Your trainer sees the same food diary days in Trainer Hub's nutrition monitoring.
          </span>
          <div style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <a href="member-messages.html" class="btn btn-outline" style="font-size:0.75rem;padding:0.35rem 0.75rem;text-decoration:none;">
              💬 Message Trainer
            </a>
            <a href="member-diet-plan.html" class="btn btn-outline" style="font-size:0.75rem;padding:0.35rem 0.75rem;text-decoration:none;">
              🥗 Plan Details
            </a>
          </div>
        </div>
      </section>
    `;
  }

  function render() {
    if (isLoading) {
      content.innerHTML = `
        <div class="np-container">
          ${renderHeaderBar()}
          <div class="mp-loading" style="padding:4rem;text-align:center;color:#94a3b8;">
            <div class="spinner" style="margin:0 auto 1rem auto;"></div>
            Loading nutrition progress and food diary records...
          </div>
        </div>
      `;
      bindEvents();
      return;
    }

    if (!progressData) {
      content.innerHTML = `
        <div class="np-container">
          ${renderHeaderBar()}
          <div class="np-card" style="padding:3rem;text-align:center;">
            <h3>Unable to load nutrition progress</h3>
            <p style="color:#94a3b8;margin:1rem 0;">We could not retrieve your food diary records. Please try again.</p>${loadError ? `<p style="color:#64748b;font-size:0.8rem;">${esc(loadError)}</p>` : ''}
            <button type="button" class="btn btn-green" id="np-btn-retry">Retry</button>
          </div>
        </div>
      `;
      bindEvents();
      return;
    }

    const { today, targets, mealCompletion, weeklyHistory, monthlyTrends, trainerHub } = progressData;

    content.innerHTML = `
      <div class="np-container">
        <!-- Date Bar -->
        ${renderHeaderBar()}

        <!-- Daily Hero Cards: Calories, Protein, Carbs, Fats, Water -->
        ${renderDailyOverview(today, targets)}

        <!-- Meal Completion Breakdown -->
        ${renderMealCompletion(mealCompletion, today?.isMissing)}

        <!-- Weekly Nutrition History -->
        ${renderWeeklyHistory(weeklyHistory, targets)}

        <!-- Monthly Trends & Consistency -->
        ${renderMonthlyTrends(monthlyTrends, targets)}

        <!-- Trainer Hub Monitoring Connection -->
        ${renderTrainerHubConnection(trainerHub)}
      </div>
    `;

    bindEvents();
  }

  function bindEvents() {
    const prevBtn = document.getElementById('np-btn-prev');
    if (prevBtn) {
      prevBtn.onclick = () => {
        const d = new Date(selectedDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 1);
        selectedDate = d.toISOString().slice(0, 10);
        loadData(selectedDate);
      };
    }

    const nextBtn = document.getElementById('np-btn-next');
    if (nextBtn) {
      nextBtn.onclick = () => {
        const d = new Date(selectedDate + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        const todayStr = getRelativeDateStr(0);
        if (d.toISOString().slice(0, 10) <= todayStr) {
          selectedDate = d.toISOString().slice(0, 10);
          loadData(selectedDate);
        }
      };
    }

    const todayBtn = document.getElementById('np-btn-today');
    if (todayBtn) {
      todayBtn.onclick = () => {
        selectedDate = getRelativeDateStr(0);
        loadData(selectedDate);
      };
    }

    const datePicker = document.getElementById('np-date-picker');
    if (datePicker) {
      datePicker.onchange = (e) => {
        if (e.target.value) {
          selectedDate = e.target.value;
          loadData(selectedDate);
        }
      };
    }

    const retryBtn = document.getElementById('np-btn-retry');
    if (retryBtn) {
      retryBtn.onclick = () => loadData(selectedDate);
    }

    // Weekly history table view buttons
    document.querySelectorAll('.btn-table-view').forEach((btn) => {
      btn.onclick = () => {
        const d = btn.getAttribute('data-date');
        if (d) {
          selectedDate = d;
          loadData(selectedDate);
        }
      };
    });

    // 30-day timeline chart bar clicks
    document.querySelectorAll('.np-timeline-bar-wrap').forEach((wrap) => {
      wrap.onclick = () => {
        const d = wrap.getAttribute('data-date');
        if (d) {
          selectedDate = d;
          loadData(selectedDate);
        }
      };
    });
  }

  // Parse optional ?date= parameter from URL
  const urlParams = new URLSearchParams(window.location.search);
  const qDate = urlParams.get('date');
  if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) {
    selectedDate = qDate;
  }

  await loadData(selectedDate);
}

