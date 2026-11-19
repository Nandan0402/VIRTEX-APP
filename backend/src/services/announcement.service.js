import { isDatabaseConnected, withTransaction } from '../config/database.js';
import * as announcementRepository from '../repositories/announcement.repository.js';
import * as pollRepo from '../repositories/poll.repository.js';

const err = (status, message, code) => { const e = new Error(message); e.status = status; if (code) e.code = code; return e; };

// The admin form offers low / medium / high / critical; the database stores normal / urgent / event / maintenance
// (announcements_priority_check). Map form values on the way in, and give the admin page its value back.
const PRIORITY_IN = { low: 'normal', medium: 'normal', high: 'urgent', critical: 'urgent', normal: 'normal', urgent: 'urgent', event: 'event', maintenance: 'maintenance' };
const PRIORITY_UI = { normal: 'medium', urgent: 'high', event: 'medium', maintenance: 'low' };
function dbPriority(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const p = PRIORITY_IN[String(v).toLowerCase()];
  if (!p) throw err(400, 'priority must be low, medium, high or critical.');
  return p;
}

/** Validate { options: string[], multiple?: boolean } → { labels, multiple } or null when no poll was asked for. */
export function parsePoll(poll) {
  if (poll === undefined || poll === null || poll === false) return null;
  if (typeof poll !== 'object' || !Array.isArray(poll.options)) throw err(400, 'poll.options must be a list of choices.');
  const labels = poll.options.map((o) => (typeof o === 'string' ? o.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  if (labels.length < 2) throw err(400, 'A poll needs at least 2 choices.');
  if (labels.length > 10) throw err(400, 'A poll can have at most 10 choices.');
  if (labels.some((l) => l.length > 80)) throw err(400, 'Each choice can be at most 80 characters.');
  if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) throw err(400, 'Each choice must be different.');
  return { labels, multiple: poll.multiple === true };
}

const AUDIENCES = ['all', 'members', 'trainers'];
const AUDIENCE_IN = { all: 'all', members: 'members', trainers: 'trainers', member: 'members', trainer: 'trainers' };
const CATEGORIES = ['general', 'indoor_sport', 'outdoor_sport', 'event', 'fitness'];
function cleanAudience(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const a = AUDIENCE_IN[String(v).toLowerCase()];
  if (!a) throw err(400, 'audience must be all, members or trainers.');
  return a;
}
function cleanCategory(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const c = String(v).toLowerCase();
  if (!CATEGORIES.includes(c)) throw err(400, `category must be one of: ${CATEGORIES.join(', ')}.`);
  return c;
}
/** Store audience + category when migration 030 is in place (otherwise everyone sees it, as before). */
async function saveAudienceCategory(id, data, client) {
  const audience = cleanAudience(data.targetAudience ?? data.audience);
  const category = cleanCategory(data.category);
  if (audience === undefined && category === undefined) return null;
  if (!(await pollRepo.audienceAndTrainerVotesAvailable())) return null;
  return announcementRepository.setAudienceCategory(id, { audience, category }, client);
}

/** Add priority_ui and poll results (counts only) to announcement rows. */
async function decorate(rows) {
  const polls = (await pollRepo.pollsAvailable().catch(() => false)) ? await pollRepo.pollsFor(rows.map((r) => r.id)) : {};
  return rows.map((r) => ({ ...r, priority_ui: PRIORITY_UI[r.priority] || 'medium', poll: polls[r.id] || null }));
}

const mockAnnouncements = [
  {
    id: 1,
    title: 'Diwali Special Fitness Challenge',
    message: 'Join our 30-Day Lean & Strong Transformation Bootcamp starting next Monday. Exciting prizes for top finishers!',
    priority: 'event',
    target_language: 'all',
    start_date: '2026-11-01',
    end_date: '2026-11-30',
    is_active: true,
  },
  {
    id: 2,
    title: 'Steam Room Maintenance Notice',
    message: 'The steam room will undergo routine maintenance this Thursday between 2:00 PM and 4:00 PM.',
    priority: 'maintenance',
    target_language: 'all',
    start_date: '2026-11-03',
    end_date: '2026-11-10',
    is_active: true,
  },
];

export async function getAnnouncements({ activeOnly = false, priority, limit = 50, audience } = {}) {
  if (isDatabaseConnected()) {
    return decorate(await announcementRepository.findAnnouncements({ activeOnly, priority: dbPriority(priority), limit, audience }));
  }
  return mockAnnouncements.filter((a) => (!activeOnly || a.is_active));
}

export async function createAnnouncement(data) {
  if (isDatabaseConnected()) {
    const poll = parsePoll(data.poll);
    cleanAudience(data.targetAudience ?? data.audience); cleanCategory(data.category); // validate before writing
    const row = { ...data, priority: dbPriority(data.priority) || 'normal' };
    if (poll && !(await pollRepo.pollsAvailable())) throw err(503, 'Poll announcements need database migration 028.', 'MIGRATIONS_PENDING');
    const created = await withTransaction(async (client) => {
      const ann = await announcementRepository.createAnnouncement(row, client);
      if (poll) await pollRepo.insertOptions(client, ann.id, poll.labels, poll.multiple);
      await saveAudienceCategory(ann.id, data, client);
      return ann;
    });
    return (await decorate([await announcementRepository.findById(created.id)]))[0];
  }
  const newAnn = {
    id: mockAnnouncements.length + 1,
    ...data,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  mockAnnouncements.unshift(newAnn);
  return newAnn;
}

export async function updateAnnouncement(id, data) {
  if (isDatabaseConnected()) {
    // Poll choices are fixed once published (votes refer to them); only the notice itself can be edited.
    if (data.poll !== undefined) throw err(400, 'Poll choices cannot be changed after publishing. Delete the poll and publish a new one.');
    cleanAudience(data.targetAudience ?? data.audience); cleanCategory(data.category);
    const updated = await announcementRepository.updateAnnouncement(id, { ...data, priority: dbPriority(data.priority) });
    if (!updated) return null;
    await saveAudienceCategory(id, data);
    return (await decorate([await announcementRepository.findById(id)]))[0];
  }
  const item = mockAnnouncements.find((a) => a.id === Number(id));
  if (item) Object.assign(item, data);
  return item || null;
}

export async function deleteAnnouncement(id) {
  if (isDatabaseConnected()) {
    return await announcementRepository.deleteAnnouncement(id);
  }
  const idx = mockAnnouncements.findIndex((a) => a.id === Number(id));
  if (idx !== -1) mockAnnouncements.splice(idx, 1);
  return { id };
}


/** Gym team: who voted for each choice of a poll. */
export async function getPollVoters(id) {
  if (!(await pollRepo.pollsAvailable())) throw err(503, 'Poll announcements need database migration 028.', 'MIGRATIONS_PENDING');
  const ann = await announcementRepository.findById(id);
  if (!ann) throw err(404, 'Announcement not found.');
  const rows = await pollRepo.votersFor(id);
  if (!rows.length) throw err(404, 'This announcement is not a poll.');
  const options = [];
  for (const r of rows) {
    let o = options.find((x) => x.id === r.option_id);
    if (!o) { o = { id: r.option_id, label: r.label, voters: [] }; options.push(o); }
    if (r.member_id) o.voters.push({ kind: 'member', id: r.member_id, name: r.member_name, code: r.member_code, votedAt: r.voted_at });
    else if (r.trainer_id) o.voters.push({ kind: 'trainer', id: r.trainer_id, name: r.trainer_name, code: r.trainer_code, votedAt: r.voted_at });
  }
  const totalVoters = new Set(options.flatMap((o) => o.voters.map((v) => `${v.kind}${v.id}`))).size;
  return { id: ann.id, title: ann.title, totalVoters, options };
}
