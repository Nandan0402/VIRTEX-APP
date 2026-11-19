/**
 * Virtex — notification sound (shared by Admin, Trainer Hub and Member Portal).
 * The chime is generated with the Web Audio API, so no audio file is needed.
 * On/off is a per-browser setting (localStorage 'virtex_notify_sound'; default on).
 * Browsers only allow sound after the user has interacted with the page, so the audio
 * engine is unlocked on the first click/keypress; a sound requested before that is skipped.
 */
const PREF_KEY = 'virtex_notify_sound';
const SEEN_PREFIX = 'virtex_unread_seen:';
let ctx = null;
let lastPlayed = 0;

export function isSoundOn() {
  try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch { return true; }
}
export function setSoundOn(on) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
}

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}
function unlock() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, capture: true, passive: true }));

/**
 * Play the chime. kind: 'message' (default, soft two-note), 'alert' (lower, for warnings).
 * Pass { force: true } to play even when muted (used by the "Test sound" button).
 */
export function playNotificationSound(kind = 'message', { force = false } = {}) {
  if (!force && !isSoundOn()) return false;
  const now = Date.now();
  if (!force && now - lastPlayed < 1500) return false; // don't stack chimes when several arrive at once
  const a = audio();
  if (!a || a.state !== 'running') { unlock(); if (!a || a.state !== 'running') return false; }
  lastPlayed = now;
  const notes = kind === 'alert' ? [523.25, 392.0] : [880.0, 1318.5];
  const t0 = a.currentTime;
  notes.forEach((freq, i) => {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + i * 0.16;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    osc.connect(gain).connect(a.destination);
    osc.start(start);
    osc.stop(start + 0.5);
  });
  return true;
}

/**
 * Remember the unread count for `key` and chime when it goes UP (a new notification arrived).
 * The first value seen in a browser tab is only recorded, so opening a page never chimes for old items.
 */
export function trackUnread(key, count, kind = 'message') {
  const n = Number(count) || 0;
  let prev = null;
  try { const s = sessionStorage.getItem(SEEN_PREFIX + key); prev = s === null ? null : Number(s); } catch { /* ignore */ }
  try { sessionStorage.setItem(SEEN_PREFIX + key, String(n)); } catch { /* ignore */ }
  if (prev !== null && n > prev) return playNotificationSound(kind);
  return false;
}

/** Run `fn` every `ms` while the tab is visible (and once when it becomes visible again). */
export function pollWhileVisible(fn, ms = 60000) {
  const tick = () => { if (document.visibilityState === 'visible') fn(); };
  const timer = setInterval(tick, ms);
  document.addEventListener('visibilitychange', tick);
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
}
