/**
 * passwordToggle.js — adds a "Show / Hide" button to every password box on the page,
 * including boxes added later (forms drawn by JavaScript). Load with:
 *   <script type="module" src="js/components/passwordToggle.js"></script>
 * Only shows what the person is typing; saved passwords are hashed and can never be shown.
 */
const STYLE = `
.pt-wrap { position: relative; display: block; }
.pt-wrap > input { width: 100%; box-sizing: border-box; padding-right: 4.6rem !important; }
.pt-btn { position: absolute; top: 50%; right: 8px; transform: translateY(-50%); display: inline-flex; align-items: center; gap: 4px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); color: #cbd5e1; border-radius: 7px;
  padding: 3px 8px; font: inherit; font-size: .74rem; font-weight: 700; cursor: pointer; line-height: 1.4; }
.pt-btn:hover { color: #fff; border-color: rgba(0,230,118,.55); }
.pt-btn:focus-visible { outline: 2px solid #00e676; outline-offset: 2px; }
.pt-btn[aria-pressed="true"] { color: #00e676; border-color: rgba(0,230,118,.55); }`;

function addStyle() {
  if (document.getElementById('pt-style')) return;
  const s = document.createElement('style'); s.id = 'pt-style'; s.textContent = STYLE; document.head.appendChild(s);
}

function enhance(input) {
  if (input.dataset.ptDone || input.closest('.pt-wrap')) return;
  // Pages that already have their own show/hide button next to the box are left alone.
  const sib = input.nextElementSibling;
  if (sib && sib.tagName === 'BUTTON' && /show|hide|👁|🙈|🐵/i.test(sib.textContent + (sib.getAttribute('aria-label') || ''))) { input.dataset.ptDone = '1'; return; }
  input.dataset.ptDone = '1';
  const wrap = document.createElement('span'); wrap.className = 'pt-wrap';
  input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'pt-btn'; btn.setAttribute('aria-pressed', 'false');
  const label = input.labels?.[0]?.textContent?.trim() || 'password';
  const set = (show) => {
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.innerHTML = show ? '<span aria-hidden="true">🙈</span> Hide' : '<span aria-hidden="true">👁</span> Show';
    btn.setAttribute('aria-label', `${show ? 'Hide' : 'Show'} ${label}`);
  };
  btn.addEventListener('click', () => { const pos = input.selectionStart; set(input.type === 'password'); input.focus(); try { input.setSelectionRange(pos, pos); } catch { /* */ } });
  // Hide again when the form is submitted or reset, so the password is not left visible.
  input.form?.addEventListener('submit', () => set(false));
  input.form?.addEventListener('reset', () => set(false));
  set(false);
  wrap.appendChild(btn);
}

function scan(root = document) { root.querySelectorAll('input[type="password"]').forEach(enhance); }

function start() {
  addStyle(); scan();
  new MutationObserver((list) => {
    for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches?.('input[type="password"]')) enhance(n); else scan(n); } });
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
