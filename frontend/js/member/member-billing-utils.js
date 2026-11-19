/**
 * Virtex Member Portal — shared formatting for the membership, payments and invoices pages.
 * Values are displayed exactly as stored; nothing is estimated or defaulted.
 */
import { esc } from './member-navigation.js';

export const NONE = '<span class="bl-none">Not recorded</span>';

export function money(v) {
  if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return NONE;
  return `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtDate(v, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!v) return NONE;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? esc(v) : esc(d.toLocaleDateString(undefined, opts));
}

const TONE = {
  active: 'ok', completed: 'ok', paid: 'ok', success: 'ok', approved: 'ok', processed: 'ok',
  pending: 'warn', partial: 'warn', due: 'warn', frozen: 'warn', requested: 'warn', processing: 'warn',
  failed: 'bad', overdue: 'bad', expired: 'bad', inactive: 'bad', cancelled: 'bad', rejected: 'bad', refunded: 'dim',
};
/** Status label exactly as stored, coloured by meaning (text always shown — never colour alone). */
export function statusPill(v) {
  if (!v) return NONE;
  const s = String(v);
  return `<span class="bl-pill bl-pill-${TONE[s.toLowerCase()] || 'dim'}">${esc(s.replace(/_/g, ' '))}</span>`;
}

const ACRONYMS = { upi: 'UPI', neft: 'NEFT', imps: 'IMPS', rtgs: 'RTGS', emi: 'EMI', pt: 'PT', gst: 'GST' };
export const label = (v) => (v ? esc(String(v).replace(/_/g, ' ').replace(/\b\w+/g, (w) => ACRONYMS[w.toLowerCase()] || w[0].toUpperCase() + w.slice(1))) : NONE);

/** Simple pager; calls onPage(n). */
export function pager(el, pagination, onPage) {
  if (!pagination || pagination.totalPages <= 1) { el.innerHTML = pagination ? `<span>${pagination.total} record${pagination.total === 1 ? '' : 's'}</span>` : ''; return; }
  const { page, totalPages, total } = pagination;
  el.innerHTML = `<span>${total} records · page ${page} of ${totalPages}</span>
    <button class="btn btn-outline" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <button class="btn btn-outline" data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>`;
  el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
}

export const PAY_AT_DESK = 'Online payment is not enabled. Payments and renewals are handled at the front desk.';
