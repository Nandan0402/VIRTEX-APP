/** Virtex Member Portal — member-faq.html: FAQ & Help.
 *  Uses the EXISTING knowledge base: GET /api/v1/faqs?language=… — the same FAQ records the Admin FAQ manager
 *  and the FitBot kiosk use. Only active (approved) FAQs are returned. Nothing is copied or stored here.
 *  Admin categories (general, timings, pricing, facilities, trainers, rules) are grouped into member topics for
 *  browsing; the FAQ text itself is shown exactly as written by staff. Languages are never machine-translated.
 */
import { api } from './member-api.js';
import { initShell, esc, notice } from './member-navigation.js';

const shell = await initShell({ page: 'faq', title: 'FAQ & Help', subtitle: 'Answers from the gym, in English, Kannada and Hindi' });

const LANGS = [['en-IN', 'English'], ['kn-IN', 'ಕನ್ನಡ'], ['hi-IN', 'हिंदी']];
const TOPICS = [
  ['membership', '🪪', 'Membership'], ['workout', '🏋️', 'Workouts'], ['diet', '🥗', 'Diet'], ['pt', '🤝', 'Personal training'],
  ['payments', '💳', 'Payments'], ['rules', '📋', 'Gym rules'], ['facilities', '🏢', 'Facilities & timings'], ['general', '💬', 'General support'],
];
// Keyword hints (English + Kannada + Hindi) used only to place a FAQ under a browsing topic.
const HINTS = [
  ['payments', /pay|payment|upi|card|cash|invoice|receipt|refund|fee due|ಪಾವತಿ|ಶುಲ್ಕ|भुगतान|शुल्क|रसीद/i],
  ['diet', /diet|nutrition|meal|food|protein|calorie|ಆಹಾರ|ಡಯಟ್|आहार|डाइट|भोजन/i],
  ['pt', /personal train|\bpt\b|1-on-1|one.on.one|ವೈಯಕ್ತಿಕ ತರಬೇತ|पर्सनल ट्रेन|निजी प्रशिक्षक/i],
  ['workout', /workout|exercise|program|routine|class|ವ್ಯಾಯಾಮ|ವರ್ಕೌಟ್|व्यायाम|वर्कआउट|कसरत/i],
  ['membership', /member|plan|join|renew|freeze|cancel|ಸದಸ್ಯ|ಯೋಜನೆ|सदस्य|प्लान|योजना/i],
];
const BASE_TOPIC = { pricing: 'membership', trainers: 'pt', rules: 'rules', facilities: 'facilities', timings: 'facilities', general: 'general' };

function topicFor(f) {
  if (f.category === 'rules') return 'rules';
  if (f.category === 'facilities' || f.category === 'timings') return 'facilities';
  const text = `${f.question} ${(f.keywords || []).join(' ')}`;
  const hit = HINTS.find(([, rx]) => rx.test(text));
  return hit ? hit[0] : BASE_TOPIC[f.category] || 'general';
}

if (shell) {
  const { content } = shell;
  const params = new URLSearchParams(location.search);
  let lang = LANGS.some(([k]) => k === params.get('lang')) ? params.get('lang') : null;
  let topic = TOPICS.some(([k]) => k === params.get('topic')) ? params.get('topic') : 'all';
  let q = params.get('q') || '';
  let faqs = []; let loadErr = null; let open = null;

  async function load() {
    loadErr = null;
    try {
      const res = await fetch(`/api/v1/faqs?language=${encodeURIComponent(lang)}`, { headers: { Accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || json.message || `Request failed (${res.status}).`);
      faqs = (json.data || []).filter((f) => f.is_active !== false).map((f) => ({ ...f, topic: topicFor(f) }));
    } catch (e) { faqs = []; loadErr = e.message || 'Network error.'; }
  }

  const highlight = (text, term) => {
    const safe = esc(text);
    if (!term) return safe;
    const re = new RegExp(`(${esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  };

  function render() {
    const term = q.trim().toLowerCase();
    const matches = faqs.filter((f) => !term || `${f.question} ${f.answer} ${(f.keywords || []).join(' ')}`.toLowerCase().includes(term));
    const list = matches.filter((f) => topic === 'all' || f.topic === topic);
    const count = (k) => matches.filter((f) => k === 'all' || f.topic === k).length;
    content.innerHTML = `<div class="pg-wrap">
      <section class="pg-card"><div class="fq-top">
          <div class="ac-chips" role="radiogroup" aria-label="Language">${LANGS.map(([k, l]) => `<button type="button" role="radio" aria-checked="${lang === k}" class="ac-chip${lang === k ? ' on' : ''}" data-lang="${k}" lang="${k.slice(0, 2)}">${esc(l)}</button>`).join('')}</div>
          <label class="fq-search"><span class="sr-only">Search FAQs</span><input type="search" id="fq-q" placeholder="Search questions…" value="${esc(q)}" autocomplete="off"></label></div>
        <div class="ac-chips fq-topics" role="group" aria-label="Topics">${[['all', '📚', 'All'], ...TOPICS].filter(([k]) => k === 'all' || count(k)).map(([k, i, l]) => `<button type="button" class="ac-chip${topic === k ? ' on' : ''}" data-topic="${k}" aria-pressed="${topic === k}">${i} ${esc(l)} (${count(k)})</button>`).join('')}</div>
      </section>
      <section class="pg-card" lang="${lang.slice(0, 2)}">
        ${loadErr ? notice('Could not load FAQs', loadErr, { error: true })
          : !faqs.length ? `<p class="pg-muted">No FAQs have been published in ${esc(LANGS.find(([k]) => k === lang)[1])} yet.${lang !== 'en-IN' ? ' <button type="button" class="btn btn-outline fq-en" data-lang="en-IN">Show English FAQs</button>' : ''}</p>`
            : list.length ? `<ul class="fq-list">${list.map((f) => `<li class="fq-item${open === f.id ? ' open' : ''}">
                <button type="button" class="fq-q" data-open="${f.id}" aria-expanded="${open === f.id}" aria-controls="fq-a-${f.id}"><span>${highlight(f.question, term)}</span><span class="fq-chev" aria-hidden="true">${open === f.id ? '−' : '+'}</span></button>
                <div class="fq-a" id="fq-a-${f.id}"${open === f.id ? '' : ' hidden'}>${highlight(f.answer, term).replace(/\n/g, '<br>')}<small class="fq-tag">${esc((TOPICS.find(([k]) => k === f.topic) || [])[2] || '')}</small></div></li>`).join('')}</ul>`
              : `<p class="pg-muted">No questions match${term ? ` “${esc(q)}”` : ''}${topic !== 'all' ? ' in this topic' : ''}.</p>`}
      </section>
      <section class="pg-card fq-help"><b>Still need help?</b>
        <p class="pg-muted">Send a question to the front desk — you'll get a ticket and the reply will appear on your Feedback page.</p>
        <a class="btn btn-green" href="member-feedback.html">Ask the gym</a> <a class="btn btn-outline" href="member-messages.html">Message my trainer</a></section></div>`;
    content.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', async () => { lang = b.dataset.lang; open = null; content.querySelector('.pg-card + .pg-card').innerHTML = '<p class="pg-muted">Loading…</p>'; await load(); render(); }));
    content.querySelectorAll('[data-topic]').forEach((b) => b.addEventListener('click', () => { topic = b.dataset.topic; render(); content.querySelector(`[data-topic="${topic}"]`)?.focus(); }));
    content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { const id = Number(b.dataset.open); open = open === id ? null : id; render(); content.querySelector(`[data-open="${id}"]`)?.focus(); }));
    const s = content.querySelector('#fq-q');
    s.addEventListener('input', () => { q = s.value; open = null; render(); const n = content.querySelector('#fq-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  }

  content.innerHTML = '<div class="mp-loading">Loading FAQs…</div>';
  if (!lang) {
    try { const me = (await api.get('/me')).data; lang = LANGS.some(([k]) => k === me?.preferred_language) ? me.preferred_language : 'en-IN'; } catch { lang = 'en-IN'; }
  }
  await load();
  render();
}
