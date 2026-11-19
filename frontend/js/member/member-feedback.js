/** Virtex Member Portal — member-feedback.html: feedback, complaints, suggestions and enquiries.
 *  Uses: GET  /api/v1/member/feedback-centre   (my own submissions + the trainers/classes I can comment on)
 *        POST /api/v1/member/feedback-centre   (stored in member_feedbacks / member_complaints)
 *  Submissions go to the Admin Retention → Feedback & Complaints queues, where staff reply.
 *  Only the signed-in member's own submissions are ever returned.
 */
import { api, ApiError } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'feedback', title: 'Feedback', subtitle: 'Tell us what is working, what is not, and ask us anything' });

const ICONS = { gym: '🏢', trainer: '🧑‍🏫', class: '📅', suggestion: '💡', complaint: '🛠️', enquiry: '❓' };
const HINT = {
  gym: 'Your overall experience at the gym.', trainer: 'About a trainer you have worked with.', class: 'About a class you attended.',
  suggestion: 'An idea to make the gym better.', complaint: 'Something broken, unclean or not right — creates a ticket.', enquiry: 'A question for the front desk — creates a ticket.',
};
const STATUS = {
  received: ['Received', 'na'], responded: ['Responded', 'ok'], open: ['Open', 'na'], in_progress: ['In progress', 'warn'], resolved: ['Resolved', 'ok'], closed: ['Closed', 'ok'],
};
const dDate = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

if (shell) {
  const { content } = shell;
  let data = null; let type = 'gym'; let survey = null; let busy = false; let flash = null;
  const form = { rating: null, message: '', subject: '', category: '', priority: 'medium', trainerId: '', classId: '' };

  function fields() {
    const k = data.kinds.find((x) => x.key === type);
    const rating = k.needsRating ? `<fieldset class="rc-scale"><legend>${type === 'gym' || type === 'suggestion' ? 'How likely are you to recommend us to a friend?' : 'Your rating'} <i class="mm-req">required</i></legend>
        <div class="rc-scale-row">${Array.from({ length: 11 }, (_, i) => `<label><input type="radio" name="rating" value="${i}"${form.rating === i ? ' checked' : ''}><span>${i}</span></label>`).join('')}</div>
        <div class="rc-scale-ends"><span>0 = not at all</span><span>10 = extremely</span></div></fieldset>` : '';
    let about = '';
    if (type === 'trainer') {
      about = data.trainers.length ? `<label class="mm-field"><span>Trainer <i class="mm-req">required</i></span><select name="trainerId"><option value="">Choose…</option>${data.trainers.map((t) => `<option value="${t.id}"${String(form.trainerId) === String(t.id) ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`
        : '<p class="pg-muted">Trainer feedback is for trainers you have trained with or booked a class with — none yet. You can still send gym feedback.</p>';
    } else if (type === 'class') {
      about = data.classes.length ? `<label class="mm-field"><span>Class <i class="mm-req">required</i></span><select name="classId"><option value="">Choose…</option>${data.classes.map((c) => `<option value="${c.id}"${String(form.classId) === String(c.id) ? ' selected' : ''}>${esc(c.title)} — ${esc(new Date(c.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}${c.trainer ? ` (${esc(c.trainer)})` : ''}</option>`).join('')}</select></label>`
        : '<p class="pg-muted">Class feedback is for classes you booked in the last 90 days — none yet.</p>';
    } else if (type === 'complaint') {
      about = `<div class="fb-row"><label class="mm-field"><span>What is it about? <i class="mm-req">required</i></span><select name="category"><option value="">Choose…</option>${data.complaintCategories.map((c) => `<option${form.category === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="mm-field"><span>How urgent?</span><select name="priority">${[['low', 'Low'], ['medium', 'Medium'], ['high', 'High — affects safety or use']].map(([v, l]) => `<option value="${v}"${form.priority === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
    }
    const subject = k.needsRating ? '' : `<label class="mm-field"><span>Subject <i class="mm-req">required</i></span><input name="subject" maxlength="150" value="${esc(form.subject)}" placeholder="${type === 'enquiry' ? 'e.g. Can I freeze my membership?' : 'e.g. Treadmill 3 not starting'}"></label>`;
    const blocked = (type === 'trainer' && !data.trainers.length) || (type === 'class' && !data.classes.length);
    return `${about}${subject}${rating}
      <label class="mm-field"><span>${k.needsRating ? 'Your feedback' : type === 'enquiry' ? 'Your question' : 'Describe the issue'} <i class="mm-req">required</i></span>
        <textarea name="message" rows="4" maxlength="2000" placeholder="${type === 'suggestion' ? 'What would you like us to add or change?' : ''}">${esc(form.message)}</textarea><small class="fb-count"><span id="fb-len">${form.message.length}</span>/2000</small></label>
      <p class="mm-err" id="fb-err" role="alert"></p>
      <div class="mm-actions"><span class="pg-muted">Sent to the gym management team. ${data.remainingToday} submission${data.remainingToday === 1 ? '' : 's'} left today.</span>
        <button type="submit" class="btn btn-green" id="fb-send"${blocked || !data.remainingToday ? ' disabled' : ''}>${k.needsRating ? 'Send feedback' : 'Create ticket'}</button></div>`;
  }

  function history() {
    if (!data.submissions.length) return '<p class="pg-muted">Nothing sent yet. Your submissions and the gym\'s replies will appear here.</p>';
    return `<ul class="nt-list">${data.submissions.map((s) => {
      const [label, cls] = STATUS[s.status] || [s.status, 'na'];
      return `<li class="nt-item fb-item"><span class="nt-ic" aria-hidden="true">${ICONS[s.kind === 'feedback' ? ({ 'Trainer Quality': 'trainer', Classes: 'class', Suggestion: 'suggestion' }[s.category] || 'gym') : s.kind]}</span>
        <div class="nt-main"><b>${s.ticket ? `${esc(s.subject)} <code>${esc(s.ticket)}</code>` : esc(s.category === 'General' ? 'Gym feedback' : s.category)}</b>
          ${s.rating !== undefined && s.rating !== null ? `<small class="fb-rating">Rating ${s.rating}/10</small>` : ''}
          <p>${esc(s.text).replace(/\n/g, '<br>')}</p>
          ${s.response ? `<div class="fb-reply"><b>Reply from the gym</b><p>${esc(s.response).replace(/\n/g, '<br>')}</p></div>` : ''}
          <small>Sent ${esc(dDate(s.createdAt))}${s.resolvedAt ? ` · resolved ${esc(dDate(s.resolvedAt))}` : ''}</small></div>
        <span class="oc-out oc-out-${cls}">${esc(label)}</span></li>`;
    }).join('')}</ul>`;
  }

  function render() {
    content.innerHTML = `<div class="pg-wrap">${flash ? `<div class="${flash.error ? 'cl-flash err' : 'mm-flash'}" role="status">${esc(flash.text)}</div>` : ''}
      ${data.surveys.map((s) => `<section class="pg-card fb-survey"><b>📋 ${esc(s.title)}</b><p>${esc(s.message)}</p>
        <button type="button" class="btn btn-outline" data-survey="${s.id}">${survey === s.id ? '✓ Answering this survey' : 'Answer in the form below'}</button></section>`).join('')}
      <section class="pg-card"><h2 class="pg-h">What would you like to send?</h2>
        <div class="fb-types" role="radiogroup" aria-label="Type">${data.kinds.map((k) => `<button type="button" role="radio" aria-checked="${type === k.key}" class="fb-type${type === k.key ? ' on' : ''}" data-type="${k.key}">
          <span aria-hidden="true">${ICONS[k.key]}</span><b>${esc(k.label)}</b><small>${esc(HINT[k.key])}</small></button>`).join('')}</div>
        <form id="fb-form" class="fb-form" novalidate>${fields()}</form></section>
      <section class="pg-card"><h2 class="pg-h">My submissions</h2>${history()}<p class="pg-foot">Only you and gym staff can see your submissions.</p></section></div>`;
    content.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { type = b.dataset.type; render(); content.querySelector(`[data-type="${type}"]`)?.focus(); }));
    content.querySelectorAll('[data-survey]').forEach((b) => b.addEventListener('click', () => { survey = Number(b.dataset.survey); if (!['gym', 'suggestion'].includes(type)) type = 'gym'; render(); content.querySelector('#fb-form textarea')?.focus(); }));
    const f = content.querySelector('#fb-form');
    f.addEventListener('input', (e) => {
      const t = e.target;
      if (t.name === 'rating') form.rating = Number(t.value);
      else if (t.name in form) form[t.name] = t.value;
      if (t.name === 'message') content.querySelector('#fb-len').textContent = t.value.length;
    });
    f.addEventListener('change', (e) => { if (e.target.name in form && e.target.name !== 'rating') form[e.target.name] = e.target.value; if (e.target.name === 'rating') form.rating = Number(e.target.value); });
    f.addEventListener('submit', submit);
  }

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    const k = data.kinds.find((x) => x.key === type);
    const err = content.querySelector('#fb-err');
    const problems = [];
    if (type === 'trainer' && !form.trainerId) problems.push('Choose the trainer.');
    if (type === 'class' && !form.classId) problems.push('Choose the class.');
    if (type === 'complaint' && !form.category) problems.push('Choose what the complaint is about.');
    if (!k.needsRating && form.subject.trim().length < 3) problems.push('Add a short subject.');
    if (k.needsRating && form.rating === null) problems.push('Choose a rating from 0 to 10.');
    if (form.message.trim().length < 5) problems.push('Write a few words.');
    if (problems.length) { err.textContent = problems.join(' '); return; }
    const body = { type, message: form.message.trim() };
    if (k.needsRating) body.rating = form.rating;
    if (type === 'trainer') body.trainerId = Number(form.trainerId);
    if (type === 'class') body.classId = Number(form.classId);
    if (!k.needsRating) body.subject = form.subject.trim();
    if (type === 'complaint') { body.category = form.category; body.priority = form.priority; }
    if (survey && k.needsRating) body.surveyId = survey;
    busy = true; content.querySelector('#fb-send').disabled = true;
    try {
      const r = (await api.post('/feedback-centre', body)).data;
      flash = { text: r.ticket ? `Thanks — ticket ${r.ticket} created. The team will reply here.` : 'Thanks — your feedback was sent to the gym team.' };
      Object.assign(form, { rating: null, message: '', subject: '', category: '', priority: 'medium', trainerId: '', classId: '' }); survey = null;
      data = (await api.get('/feedback-centre')).data;
      render(); window.scrollTo(0, 0);
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : 'Could not send — please try again. Your text is kept.';
      content.querySelector('#fb-send').disabled = false;
    } finally { busy = false; }
  }

  content.innerHTML = '<div class="mp-loading">Loading…</div>';
  try { data = (await api.get('/feedback-centre')).data; render(); }
  catch (e) { content.innerHTML = notice('Could not load feedback', e instanceof ApiError ? e.message : 'Network error — please try again.', { error: true }); }
}
