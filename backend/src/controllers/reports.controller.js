/**
 * GET /api/v1/admin/reports/summary?from=YYYY-MM   (owner / manager — enforced in admin.routes.js)
 * Month-by-month leads, amount collected, new members / trainers from `from` (default: 5 months ago)
 * up to the current month, plus today's member / personal-trainer / general-trainer counts.
 */
import * as repo from '../repositories/reports.repository.js';

const MAX_MONTHS = 36;

export async function summary(req, res, next) {
  try {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    if (req.query.from !== undefined && req.query.from !== '') {
      const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.from));
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return res.status(400).json({ success: false, error: 'from must be a month like 2026-06.' });
      from = new Date(Number(m[1]), Number(m[2]) - 1, 1);
      if (from > thisMonth) return res.status(400).json({ success: false, error: 'from cannot be in the future.' });
      const earliest = new Date(now.getFullYear(), now.getMonth() - (MAX_MONTHS - 1), 1);
      if (from < earliest) return res.status(400).json({ success: false, error: `Reports go back at most ${MAX_MONTHS} months.` });
    }
    const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-01`;
    const [months, now_] = await Promise.all([repo.monthlySeries(fromIso), repo.snapshot()]);
    res.json({ success: true, data: { from: fromIso.slice(0, 7), to: months.at(-1)?.month || null, months, now: now_ } });
  } catch (err) {
    next(err);
  }
}
