/**
 * Automatic birthday wishes + trainer birthdays (Birthday Alert page). Owner / manager only (member.routes.js).
 *   GET   /api/v1/members/birthday-auto                 status: on/off, channels, wished today, last run
 *   POST  /api/v1/members/birthday-auto/run             send today's wishes now (ignores the 8 AM start time)
 *   GET   /api/v1/members/birthday-trainers             trainers with birthday info
 *   PATCH /api/v1/members/birthday-trainers/:id/dob     { dateOfBirth: 'YYYY-MM-DD' | null }
 */
import * as wishes from '../services/birthdayWishes.service.js';
import * as repo from '../repositories/birthday.repository.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };
const bad = (res, status, error) => res.status(status).json({ success: false, error });

export const autoStatus = wrap(async (req, res) => ok(res, await wishes.getAutoWishStatus()));
export const runNow = wrap(async (req, res) => {
  const result = await wishes.runBirthdayWishes({ force: true, trigger: `manual:${req.user?.username || 'admin'}` });
  ok(res, { result, status: await wishes.getAutoWishStatus() });
});

export const listTrainers = wrap(async (req, res) => {
  if (!(await repo.trainerBirthdaysAvailable())) return ok(res, { available: false, trainers: [] });
  ok(res, { available: true, trainers: await repo.listTrainerBirthdays() });
});

export const setTrainerDob = wrap(async (req, res) => {
  if (!(await repo.trainerBirthdaysAvailable())) return bad(res, 503, 'Trainer birthdays need database migration 027.');
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return bad(res, 400, 'Invalid trainer id.');
  const raw = req.body?.dateOfBirth;
  let dob = null;
  if (raw !== null && raw !== '' && raw !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return bad(res, 400, 'dateOfBirth must be YYYY-MM-DD.');
    const d = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) return bad(res, 400, 'That date does not exist.');
    if (d.getUTCFullYear() < 1900 || d > new Date()) return bad(res, 400, 'Date of birth must be between 1900 and today.');
    dob = raw;
  }
  const row = await repo.setTrainerDob(id, dob);
  if (!row) return bad(res, 404, 'Trainer not found.');
  ok(res, row);
});
