/** Virtex Member Portal — member-courses.html: Courses.
 *  Uses: GET  /api/v1/member/courses                                  (published catalogue + my enrolments)
 *        GET  /api/v1/member/courses/:id                              (lessons/videos/assessment only when enrolled)
 *        POST /api/v1/member/courses/:id/enrol
 *        POST /api/v1/member/courses/:id/lessons/:lessonId/complete   (lessons are completed in order)
 *        POST /api/v1/member/courses/:id/assessment                   (graded on the server)
 *  Courses, lessons, videos and assessments are created by staff in the Admin Classes & Learning module.
 *  Certificates are issued by staff — this page never issues one.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'courses', title: 'Courses', subtitle: 'Fitness and learning courses from your gym' });

const hours = (h, mins) => (mins ? `${Math.round(mins)} min of lessons` : h ? `About ${h} h` : '');
const dDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const instructor = (i) => (i ? `👤 ${esc(i.name)}${i.specialty ? ` · ${esc(i.specialty)}` : ''}` : '👤 Instructor not assigned');
const bar = (pct) => `<div class="cl-bar co-bar" role="img" aria-label="${pct}% complete"><span style="width:${pct}%"></span></div>`;

if (shell) {
  const { content } = shell;
  let list = null; let course = null; let flash = null; let busy = false; let cat = 'all'; let search = '';
  const courseId = () => { const v = new URLSearchParams(location.search).get('id'); return /^\d+$/.test(v || '') ? Number(v) : null; };
  const go = (id) => { history.pushState(null, '', id ? `member-courses.html?id=${id}` : 'member-courses.html'); flash = null; route(); };
  window.addEventListener('popstate', () => { flash = null; route(); });
  const flashHtml = () => (flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : '');

  // ------------------------------------------------------------------ catalogue
  function statusChip(c) {
    const off = c.available ? '' : '<span class="cl-reg cl-reg-closed" title="Your access continues">No longer offered</span>';
    if (!c.enrolment) return off;
    if (c.enrolment.status === 'completed') return `<span class="cl-reg cl-reg-mine">Completed</span>${off}`;
    return `<span class="cl-reg cl-reg-open">${c.enrolment.progressPct}% done</span>${off}`;
  }
  function courseCard(c) {
    return `<article class="oc-vod co-card">
      <div class="oc-vod-top"><span class="cl-group">${esc(c.category)}${c.level ? ` · ${esc(c.level)}` : ''}</span>${statusChip(c)}</div>
      <h3>${esc(c.title)}</h3>
      <p class="cl-meta">${instructor(c.instructor)}</p>
      ${c.description ? `<p class="cl-desc co-clamp">${esc(c.description)}</p>` : ''}
      <p class="cl-meta co-facts">📚 ${c.lessonsCount} lesson${c.lessonsCount === 1 ? '' : 's'}${hours(c.estimatedHours, c.totalMins) ? ` · ${esc(hours(c.estimatedHours, c.totalMins))}` : ''}${c.hasAssessment ? ' · 📝 Assessment' : ''}${c.certificate ? ' · 🎓 Certificate issued' : ''}</p>
      ${c.enrolment ? bar(c.enrolment.progressPct) : ''}
      <div class="oc-vod-act"><button type="button" class="btn ${c.enrolment ? 'btn-green' : 'btn-outline'}" data-open="${c.id}">${c.enrolment ? (c.enrolment.status === 'completed' ? 'Review course' : 'Continue') : 'View course'}</button></div>
    </article>`;
  }
  function renderList() {
    const mine = list.filter((c) => c.enrolment);
    const cats = [...new Set(list.filter((c) => c.available).map((c) => c.category))].sort();
    const q = search.trim().toLowerCase();
    const avail = list.filter((c) => c.available && !c.enrolment && (cat === 'all' || c.category === cat)
      && (!q || `${c.title} ${c.description} ${c.instructor?.name || ''}`.toLowerCase().includes(q)));
    content.innerHTML = `<div class="pg-wrap">${flashHtml()}
      <section class="pg-card"><h2 class="pg-h">My courses</h2>
        ${mine.length ? `<div class="oc-grid">${mine.map(courseCard).join('')}</div>` : '<p class="pg-muted">You are not enrolled in any course yet. Choose one from the catalogue below.</p>'}</section>
      <section class="pg-card"><div class="cl-head"><h2 class="pg-h">Course catalogue</h2>
          <input type="search" id="co-search" class="co-search" placeholder="Search courses" value="${esc(search)}" aria-label="Search courses"></div>
        ${cats.length ? `<div class="ac-chips" role="group" aria-label="Filter by category">${['all', ...cats].map((k) => `<button type="button" class="ac-chip${cat === k ? ' on' : ''}" data-cat="${esc(k)}" aria-pressed="${cat === k}">${esc(k === 'all' ? 'All' : k)}</button>`).join('')}</div>` : ''}
        ${avail.length ? `<div class="oc-grid">${avail.map(courseCard).join('')}</div>`
          : `<p class="pg-muted">${list.some((c) => c.available) ? 'No other courses match.' : 'No courses are published yet. Courses appear here when the gym publishes them.'}</p>`}
      </section></div>`;
    content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.open))));
    content.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; renderList(); }));
    const s = content.querySelector('#co-search');
    s?.addEventListener('input', () => { search = s.value; renderList(); const n = content.querySelector('#co-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  }

  // ------------------------------------------------------------------ course detail
  function lessonsHtml(c) {
    if (!c.lessons.length) return '<p class="pg-muted">No lessons have been added to this course yet.</p>';
    return `<ol class="co-lessons">${c.lessons.map((l) => {
      if (!c.enrolled) return `<li class="co-lesson is-preview"><span class="oc-l-num">${l.order}</span><div><b>${esc(l.title)}</b><small>${l.durationMins ? `${l.durationMins} min` : ''}</small></div><span class="co-lock" title="Enrol to open">🔒</span></li>`;
      const state = l.completed ? 'done' : l.isNext ? 'next' : 'locked';
      return `<li class="co-lesson is-${state}"><span class="oc-l-num">${l.completed ? '✓' : l.order}</span>
        <div class="co-l-main"><b>${esc(l.title)}</b><small>${l.durationMins ? `${l.durationMins} min` : ''}${l.locked ? ' · finish the earlier lessons first' : ''}</small>
          ${!l.locked && l.notes ? `<details class="co-notes"><summary>Lesson notes</summary><p>${esc(l.notes).replace(/\n/g, '<br>')}</p></details>` : ''}</div>
        <div class="co-l-act">${!l.locked ? (l.videoUrl ? `<a class="btn btn-outline" href="${esc(l.videoUrl)}" target="_blank" rel="noopener noreferrer">▶ Watch ↗</a>` : '<small class="oc-note">No video for this lesson</small>') : ''}
          ${l.isNext ? `<button type="button" class="btn btn-green" data-complete="${l.id}">Mark complete</button>` : ''}</div></li>`;
    }).join('')}</ol>`;
  }
  function assessmentHtml(c) {
    const a = c.assessment;
    if (!a) return '';
    const e = c.enrolment;
    let body;
    if (!c.enrolled) body = `<p class="pg-muted">${a.questionCount} question${a.questionCount === 1 ? '' : 's'} · pass mark ${a.passPct}%. Enrol to take the assessment.</p>`;
    else if (!a.unlocked) body = `<p class="pg-muted">${a.questionCount ? `Unlocks when you finish all lessons. ${a.questionCount} question${a.questionCount === 1 ? '' : 's'} · pass mark ${a.passPct}%.` : 'The assessment has no questions yet.'}</p>`;
    else {
      body = `${e.assessmentScorePct !== null ? `<p class="co-result ${e.assessmentPassed ? 'ok' : 'no'}">${e.assessmentPassed ? '✓ Passed' : 'Not passed yet'} — best score ${e.assessmentScorePct}% (pass mark ${a.passPct}%)</p>` : ''}
        <form id="co-quiz">${a.questions.map((q) => `<fieldset class="co-q"><legend>${q.index + 1}. ${esc(q.question)}</legend>
          ${q.options.map((o, i) => `<label><input type="radio" name="q${q.index}" value="${i}"> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
          <p class="mm-err" id="co-err" role="alert"></p>
          <button type="submit" class="btn btn-green">${e.assessmentScorePct !== null ? 'Submit another attempt' : 'Submit answers'}</button>
          <span class="pg-muted co-inline">Pass mark ${a.passPct}%. Your answers are marked by the gym's system; your best score is kept.</span></form>`;
    }
    return `<section class="pg-card"><h2 class="pg-h">📝 ${esc(a.title || 'Assessment')}</h2>${body}</section>`;
  }
  function certificateHtml(c) {
    if (!c.enrolled) return '';
    if (c.certificate) {
      return `<section class="pg-card co-cert"><h2 class="pg-h">🎓 Certificate</h2>
        <p>Issued ${esc(dDate(c.certificate.issuedAt))}${c.certificate.issuedBy ? ` by ${esc(c.certificate.issuedBy)}` : ''}${c.certificate.grade ? ` · Grade ${esc(c.certificate.grade)}` : ''}</p>
        <code>${esc(c.certificate.code)}</code> <a class="btn btn-outline" href="member-achievements.html">View &amp; print in Achievements</a></section>`;
    }
    return `<section class="pg-card"><h2 class="pg-h">🎓 Certificate</h2><p class="pg-muted">${c.enrolment?.status === 'completed'
      ? 'You have completed this course. Certificates are issued by gym staff — yours has not been issued yet.'
      : 'Complete every lesson' + (c.assessment ? ' and pass the assessment' : '') + '. Certificates are then issued by gym staff.'}</p></section>`;
  }
  function renderCourse() {
    const c = course; const e = c.enrolment;
    content.innerHTML = `<div class="pg-wrap">${flashHtml()}
      <p><button type="button" class="btn btn-outline co-back" id="co-back">‹ All courses</button></p>
      <section class="pg-card co-head">
        <div class="cl-top"><span class="cl-group">${esc(c.category)}${c.level ? ` · ${esc(c.level)}` : ''}</span>${!c.available ? '<span class="cl-reg cl-reg-closed">No longer offered — your access continues</span>' : ''}</div>
        <h2 class="co-title">${esc(c.title)}</h2>
        <p class="cl-meta">${instructor(c.instructor)}${c.estimatedHours ? ` · about ${c.estimatedHours} h` : ''} · ${c.lessons.length} lesson${c.lessons.length === 1 ? '' : 's'}${c.assessment ? ' · assessment' : ''}</p>
        ${c.description ? `<p class="co-desc">${esc(c.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${e ? `<div class="co-progress"><div class="cl-slots">${bar(e.progressPct)}<small>${e.lessonsCompleted} of ${e.totalLessons} lessons · ${e.progressPct}%${e.status === 'completed' ? ` · completed ${esc(dDate(e.completedAt))}` : ''}</small></div><small class="pg-muted">Enrolled ${esc(dDate(e.enrolledAt))}</small></div>`
          : c.available ? '<button type="button" class="btn btn-green" id="co-enrol">Enrol in this course</button>' : ''}
      </section>
      <section class="pg-card"><h2 class="pg-h">Lessons</h2>${!c.enrolled && c.lessons.length ? '<p class="pg-muted">Enrol to open lessons and videos.</p>' : ''}${lessonsHtml(c)}</section>
      ${assessmentHtml(c)}${certificateHtml(c)}</div>`;
    content.querySelector('#co-back').addEventListener('click', () => go(null));
    content.querySelector('#co-enrol')?.addEventListener('click', (ev) => act(ev.target, () => api.post(`/courses/${c.id}/enrol`, {}), `You're enrolled in ${c.title}.`));
    content.querySelectorAll('[data-complete]').forEach((b) => b.addEventListener('click', () => act(b, () => api.post(`/courses/${c.id}/lessons/${b.dataset.complete}/complete`, {}), 'Lesson marked complete.')));
    content.querySelector('#co-quiz')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const qs = c.assessment.questions;
      const answers = qs.map((q) => { const v = ev.target.querySelector(`input[name="q${q.index}"]:checked`); return v ? Number(v.value) : null; });
      const missing = answers.findIndex((a) => a === null);
      if (missing >= 0) { content.querySelector('#co-err').textContent = `Answer question ${missing + 1}.`; return; }
      act(ev.target.querySelector('button[type=submit]'), async () => {
        const r = (await api.post(`/courses/${c.id}/assessment`, { answers })).data;
        return { msg: r.passed ? `Passed — ${r.scorePct}% (${r.correct} of ${r.total} correct).` : `Not passed — ${r.scorePct}% (${r.correct} of ${r.total} correct). The pass mark is ${r.passPct}%. Review the lessons and try again.`, error: !r.passed };
      });
    });
  }

  async function act(btn, fn, okText) {
    if (busy) return;
    busy = true; if (btn) btn.disabled = true;
    try { const r = await fn(); flash = r && r.msg ? { text: r.msg, error: r.error } : { text: okText }; }
    catch (e) { flash = { text: e instanceof ApiError ? e.message : 'Something went wrong — please try again.', error: true }; }
    finally { busy = false; await route(); }
  }

  async function route() {
    const id = courseId();
    try {
      if (id) { course = (await api.get(`/courses/${id}`)).data; renderCourse(); }
      else { list = (await api.get('/courses')).data; renderList(); }
      window.scrollTo(0, 0);
    } catch (e) {
      content.innerHTML = `<div class="pg-wrap">${notice(id ? 'Course not available' : 'Could not load courses', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true })}
        ${id ? '<p><button type="button" class="btn btn-outline" id="co-back">‹ All courses</button></p>' : ''}</div>`;
      content.querySelector('#co-back')?.addEventListener('click', () => go(null));
    }
  }

  content.innerHTML = '<div class="mp-loading">Loading courses…</div>';
  await route();
}
