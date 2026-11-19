/**
 * poll.repository.js — poll announcements (migration 028; trainer votes from migration 030).
 * A voter is { memberId } or { trainerId }. Parameterised queries only; who may vote or see voter names
 * is decided in the services.
 */
import { query, withTransaction } from '../config/database.js';

let ready = { at: 0, ok: false };
export async function pollsAvailable() {
  if (Date.now() - ready.at < 60000) return ready.ok;
  const r = await query(`SELECT to_regclass('public.announcement_poll_votes') IS NOT NULL AS ok`);
  ready = { at: Date.now(), ok: r.rows[0].ok };
  return ready.ok;
}

/** Migration 030: votes may belong to trainers; announcements have audience + category. */
let v030 = { at: 0, ok: false };
export async function audienceAndTrainerVotesAvailable() {
  if (Date.now() - v030.at < 60000) return v030.ok;
  const r = await query(`SELECT COUNT(*)::int n FROM information_schema.columns WHERE table_schema = 'public'
                          AND ((table_name = 'announcement_poll_votes' AND column_name = 'trainer_id')
                            OR (table_name = 'announcements' AND column_name IN ('audience', 'category')))`);
  v030 = { at: Date.now(), ok: r.rows[0].n === 3 };
  return v030.ok;
}

/** Insert the choices of a new poll (inside the announcement's transaction). */
export async function insertOptions(client, announcementId, labels, multiple) {
  await client.query('UPDATE announcements SET poll_multiple = $2 WHERE id = $1', [announcementId, !!multiple]);
  for (let i = 0; i < labels.length; i++) {
    await client.query('INSERT INTO announcement_poll_options (announcement_id, label, position) VALUES ($1, $2, $3)', [announcementId, labels[i], i + 1]);
  }
}

/**
 * Poll data for several announcements: { [announcementId]: { multiple, totalVoters, options: [{ id, label, votes, mine }] } }.
 * voter (optional): { memberId } or { trainerId } — marks that person's own choices.
 */
export async function pollsFor(announcementIds, voter = null) {
  const ids = [...new Set(announcementIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return {};
  const withTrainers = await audienceAndTrainerVotesAvailable();
  // One "voter key" per person: m<id> for members, t<id> for trainers.
  const voterKey = withTrainers ? `COALESCE('m' || v.member_id, 't' || v.trainer_id)` : `'m' || v.member_id`;
  const mineCond = voter?.trainerId && withTrainers ? 'v.trainer_id = $2' : 'v.member_id = $2';
  const mineId = voter?.trainerId ? (withTrainers ? voter.trainerId : -1) : (voter?.memberId ?? null);
  const r = await query(
    `SELECT o.announcement_id, a.poll_multiple, o.id, o.label, o.position,
            (SELECT COUNT(*)::int FROM announcement_poll_votes v WHERE v.option_id = o.id) AS votes,
            EXISTS (SELECT 1 FROM announcement_poll_votes v WHERE v.option_id = o.id AND ${mineCond}) AS mine,
            (SELECT COUNT(DISTINCT ${voterKey})::int FROM announcement_poll_votes v WHERE v.announcement_id = o.announcement_id) AS total_voters
       FROM announcement_poll_options o JOIN announcements a ON a.id = o.announcement_id
      WHERE o.announcement_id = ANY($1::int[])
      ORDER BY o.announcement_id, o.position`,
    [ids, mineId]
  );
  const out = {};
  for (const row of r.rows) {
    const p = (out[row.announcement_id] ||= { multiple: row.poll_multiple, totalVoters: row.total_voters, options: [] });
    p.options.push({ id: row.id, label: row.label, votes: row.votes, mine: row.mine });
  }
  return out;
}

/** Replace a voter's vote on a poll (empty optionIds = withdraw). Options must belong to the poll. */
export async function setVote(announcementId, voter, optionIds) {
  const isTrainer = !!voter?.trainerId;
  if (isTrainer && !(await audienceAndTrainerVotesAvailable())) return { unavailable: true };
  const col = isTrainer ? 'trainer_id' : 'member_id';
  const who = isTrainer ? voter.trainerId : voter.memberId;
  return withTransaction(async (client) => {
    // Serialise one person's votes on one poll (double-clicks, two tabs). Trainers use a negative key so they
    // never share a lock with a member of the same id; a shared key would only make two requests wait briefly.
    await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [announcementId, isTrainer ? -who : who]);
    if (optionIds.length) {
      const ok = await client.query('SELECT COUNT(*)::int n FROM announcement_poll_options WHERE announcement_id = $1 AND id = ANY($2::int[])', [announcementId, optionIds]);
      if (ok.rows[0].n !== optionIds.length) return { invalid: true };
    }
    await client.query(`DELETE FROM announcement_poll_votes WHERE announcement_id = $1 AND ${col} = $2`, [announcementId, who]);
    for (const id of optionIds) {
      await client.query(`INSERT INTO announcement_poll_votes (option_id, announcement_id, ${col}) VALUES ($1, $2, $3)`, [id, announcementId, who]);
    }
    return { invalid: false };
  });
}

/** Who voted for what (gym team only): members and trainers. */
export async function votersFor(announcementId) {
  const withTrainers = await audienceAndTrainerVotesAvailable();
  const r = await query(
    `SELECT o.id AS option_id, o.label, o.position,
            m.id AS member_id, m.full_name AS member_name, m.member_code,
            ${withTrainers ? 't.id AS trainer_id, t.full_name AS trainer_name, t.trainer_code,' : 'NULL::int AS trainer_id, NULL AS trainer_name, NULL AS trainer_code,'}
            v.voted_at
       FROM announcement_poll_options o
       LEFT JOIN announcement_poll_votes v ON v.option_id = o.id
       LEFT JOIN members m ON m.id = v.member_id
       ${withTrainers ? 'LEFT JOIN trainers t ON t.id = v.trainer_id' : ''}
      WHERE o.announcement_id = $1
      ORDER BY o.position, COALESCE(m.full_name, ${withTrainers ? 't.full_name' : 'NULL'})`,
    [announcementId]
  );
  return r.rows;
}
