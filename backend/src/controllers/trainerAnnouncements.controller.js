/**
 * Gym announcements & polls for personal trainers (Trainer Hub → Notifications).
 *   GET    /api/v1/trainer/announcements              active announcements for everyone or for trainers, with polls
 *   POST   /api/v1/trainer/announcements/:id/vote     { optionIds: [...] }  vote / change vote (trainers only)
 *   DELETE /api/v1/trainer/announcements/:id/vote     take the vote back
 * The trainer is always the signed-in trainer (trainerScope); owners viewing a trainer's hub can read but not vote.
 */
import * as announcementService from '../services/announcement.service.js';
import * as pollRepo from '../repositories/poll.repository.js';

const fail = (res, status, error) => res.status(status).json({ success: false, error });
const isTrainer = (req) => String(req.user?.role || '').toLowerCase() === 'trainer';

const present = (p) => (p ? {
  multiple: p.multiple, totalVoters: p.totalVoters,
  options: p.options.map((o) => ({ id: o.id, label: o.label, votes: o.votes, mine: o.mine })),
  myOptionIds: p.options.filter((o) => o.mine).map((o) => o.id),
} : null);

async function visibleAnnouncements() {
  return announcementService.getAnnouncements({ activeOnly: true, audience: 'trainers', limit: 50 });
}

export async function list(req, res, next) {
  try {
    const rows = await visibleAnnouncements();
    const polls = rows.length && (await pollRepo.pollsAvailable().catch(() => false))
      ? await pollRepo.pollsFor(rows.map((r) => r.id), { trainerId: req.trainerId }) : {};
    const canVote = isTrainer(req) && (await pollRepo.audienceAndTrainerVotesAvailable().catch(() => false));
    res.json({ success: true, data: {
      canVote,
      announcements: rows.map((a) => ({
        id: a.id, title: a.title, message: a.message, priority: a.priority_ui || 'medium', audience: a.audience, category: a.category,
        postedAt: a.created_at, endDate: a.end_date, poll: present(polls[a.id]),
      })),
    } });
  } catch (err) { next(err); }
}

async function vote(req, res, next, optionIdsRaw) {
  try {
    if (!isTrainer(req)) return fail(res, 403, 'Only trainers can vote here.');
    const annId = Number(req.params.id);
    if (!Number.isInteger(annId) || annId <= 0) return fail(res, 404, 'Announcement not found.');
    if (!(await pollRepo.audienceAndTrainerVotesAvailable())) return fail(res, 503, 'Trainer voting is waiting for a database update (migration 030).');
    const visible = (await visibleAnnouncements()).some((a) => a.id === annId);
    if (!visible) return fail(res, 404, 'This poll is not open.');
    const poll = (await pollRepo.pollsFor([annId], { trainerId: req.trainerId }))[annId];
    if (!poll) return fail(res, 404, 'This announcement is not a poll.');
    if (!Array.isArray(optionIdsRaw)) return fail(res, 400, 'optionIds must be a list.');
    const ids = [...new Set(optionIdsRaw.map(Number))];
    if (ids.some((n) => !Number.isInteger(n) || n <= 0)) return fail(res, 400, 'Invalid choice.');
    if (!poll.multiple && ids.length > 1) return fail(res, 400, 'You can pick only one choice in this poll.');
    const r = await pollRepo.setVote(annId, { trainerId: req.trainerId }, ids);
    if (r.unavailable) return fail(res, 503, 'Trainer voting is waiting for a database update (migration 030).');
    if (r.invalid) return fail(res, 400, 'That choice is not part of this poll.');
    res.json({ success: true, data: present((await pollRepo.pollsFor([annId], { trainerId: req.trainerId }))[annId]) });
  } catch (err) { next(err); }
}

export const castVote = (req, res, next) => vote(req, res, next, req.body?.optionIds);
export const withdrawVote = (req, res, next) => vote(req, res, next, []);
