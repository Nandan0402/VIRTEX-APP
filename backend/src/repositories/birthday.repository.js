/**
 * birthday.repository.js — who has a birthday today, and the "already wished" claim used by the
 * automatic birthday wishes (members: migration 005 columns; trainers: migration 027 columns).
 * All dates use the database's CURRENT_DATE. Feb-29 birthdays are wished on Feb 28 in non-leap years.
 */
import { query } from '../config/database.js';

// Is <col> (a DATE) a birthday today?
const IS_BIRTHDAY_TODAY = (col) => `(
  to_char(${col}, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')
  OR (to_char(${col}, 'MM-DD') = '02-29' AND to_char(CURRENT_DATE, 'MM-DD') = '02-28'
      AND to_char((date_trunc('year', CURRENT_DATE) + interval '59 days')::date, 'MM-DD') <> '02-29'))`;

// A wish recorded in the last 30 days counts as "already wished" for this birthday
// (covers a manual WhatsApp wish sent a few days early from the Birthday Alert page).
const NOT_WISHED = (col) => `(${col} IS NULL OR ${col} < NOW() - interval '30 days')`;

let trainerCols = { at: 0, ok: false };
export async function trainerBirthdaysAvailable() {
  if (Date.now() - trainerCols.at < 60000) return trainerCols.ok;
  const r = await query(`SELECT COUNT(*)::int n FROM information_schema.columns
                          WHERE table_schema = 'public' AND table_name = 'trainers' AND column_name IN ('date_of_birth', 'birthday_wish_sent_at')`);
  trainerCols = { at: Date.now(), ok: r.rows[0].n === 2 };
  return trainerCols.ok;
}

export async function membersDueToday() {
  const r = await query(`SELECT id, full_name FROM members
                          WHERE date_of_birth IS NOT NULL AND ${IS_BIRTHDAY_TODAY('date_of_birth')} AND ${NOT_WISHED('birthday_wish_sent_at')}
                          ORDER BY id`);
  return r.rows;
}

export async function trainersDueToday() {
  if (!(await trainerBirthdaysAvailable())) return [];
  const r = await query(`SELECT id, full_name FROM trainers
                          WHERE date_of_birth IS NOT NULL AND ${IS_BIRTHDAY_TODAY('date_of_birth')} AND ${NOT_WISHED('birthday_wish_sent_at')}
                          ORDER BY id`);
  return r.rows;
}

/** Atomically claim a wish (so two server processes never wish twice). Returns the previous value, or undefined if already wished. */
export async function claimMemberWish(id) {
  const r = await query(`UPDATE members m SET birthday_wish_sent_at = NOW()
                           FROM (SELECT id, birthday_wish_sent_at AS prev FROM members WHERE id = $1 FOR UPDATE) p
                          WHERE m.id = p.id AND ${NOT_WISHED('p.prev')}
                          RETURNING p.prev`, [id]);
  return r.rowCount ? r.rows[0].prev : undefined;
}
export async function claimTrainerWish(id) {
  const r = await query(`UPDATE trainers t SET birthday_wish_sent_at = NOW()
                           FROM (SELECT id, birthday_wish_sent_at AS prev FROM trainers WHERE id = $1 FOR UPDATE) p
                          WHERE t.id = p.id AND ${NOT_WISHED('p.prev')}
                          RETURNING p.prev`, [id]);
  return r.rowCount ? r.rows[0].prev : undefined;
}
/** Undo a claim when delivery failed, so the next run retries. */
export async function releaseMemberWish(id, prev) {
  await query('UPDATE members SET birthday_wish_sent_at = $2 WHERE id = $1', [id, prev ?? null]);
}
export async function releaseTrainerWish(id, prev) {
  await query('UPDATE trainers SET birthday_wish_sent_at = $2 WHERE id = $1', [id, prev ?? null]);
}

/** Names wished today (for the Birthday Alert status banner). */
export async function wishedToday() {
  const m = await query(`SELECT full_name FROM members WHERE birthday_wish_sent_at >= CURRENT_DATE ORDER BY full_name`);
  const t = (await trainerBirthdaysAvailable())
    ? await query(`SELECT full_name FROM trainers WHERE birthday_wish_sent_at >= CURRENT_DATE ORDER BY full_name`)
    : { rows: [] };
  return { members: m.rows.map((x) => x.full_name), trainers: t.rows.map((x) => x.full_name) };
}

/** Trainers with birthday info for the Birthday Alert page (same shape as the member list). */
export async function listTrainerBirthdays() {
  // Next birthday = the first of (this year's, next year's) birthday that is today or later;
  // Feb 29 falls back to Feb 28 in non-leap years.
  const bday = (y) => `make_date(${y}, x.m, CASE WHEN x.m = 2 AND x.d = 29
                         AND NOT ((${y}) % 4 = 0 AND ((${y}) % 100 <> 0 OR (${y}) % 400 = 0)) THEN 28 ELSE x.d END)`;
  const r = await query(`
    SELECT t.id, t.trainer_code, t.full_name, t.phone, t.email, t.specialty, t.date_of_birth, t.birthday_wish_sent_at,
           to_char(t.date_of_birth, 'YYYY-MM-DD') AS dob_iso,
           to_char(t.date_of_birth, 'Mon DD') AS birthday_formatted,
           (n.next_bday - CURRENT_DATE) AS days_until_birthday,
           (EXTRACT(YEAR FROM n.next_bday) - EXTRACT(YEAR FROM t.date_of_birth))::int AS turning_age
      FROM trainers t
      LEFT JOIN LATERAL (SELECT EXTRACT(MONTH FROM t.date_of_birth)::int AS m, EXTRACT(DAY FROM t.date_of_birth)::int AS d,
                                EXTRACT(YEAR FROM CURRENT_DATE)::int AS y) x ON t.date_of_birth IS NOT NULL
      LEFT JOIN LATERAL (SELECT CASE WHEN ${bday('x.y')} >= CURRENT_DATE THEN ${bday('x.y')} ELSE ${bday('x.y + 1')} END AS next_bday) n
             ON t.date_of_birth IS NOT NULL
     ORDER BY (t.date_of_birth IS NULL), days_until_birthday NULLS LAST, t.full_name`);
  return r.rows;
}

export async function setTrainerDob(id, dob) {
  const r = await query(`UPDATE trainers SET date_of_birth = $2 WHERE id = $1
                         RETURNING id, full_name, to_char(date_of_birth, 'YYYY-MM-DD') AS dob_iso`, [id, dob]);
  return r.rows[0] || null;
}
