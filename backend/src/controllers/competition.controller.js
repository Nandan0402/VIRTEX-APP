import * as compRepo from '../repositories/competition.repository.js';

export async function getCompetitions(req, res) {
  try {
    const { type, status, search } = req.query;
    const comps = await compRepo.getCompetitions({ type, status, search });
    res.json({
      success: true,
      count: comps.length,
      data: comps
    });
  } catch (error) {
    console.error('Error in getCompetitions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch competitions.' });
  }
}

export async function getCompetitionById(req, res) {
  try {
    const { id } = req.params;
    const comp = await compRepo.getCompetitionById(id);
    if (!comp) {
      return res.status(404).json({ success: false, message: 'Competition not found.' });
    }
    res.json({ success: true, data: comp });
  } catch (error) {
    console.error('Error in getCompetitionById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch competition details.' });
  }
}

export async function createCompetition(req, res) {
  try {
    const {
      title,
      type,
      description,
      start_date,
      end_date,
      registration_deadline,
      status,
      organizer_trainer_id,
      metric_type,
      prize_pool,
      rules,
      banner_url,
      is_outdoor,
      outdoor_details
    } = req.body;

    if (!title || !type || !description || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: 'Title, competition type, description, start date, and end date are required.'
      });
    }

    // Same checks as Edit (lengths, dates, custom type / metric, outdoor-sport details).
    const { data, error } = cleanCompetition({
      title, type, description, start_date, end_date, registration_deadline, status, organizer_trainer_id,
      metric_type: metric_type || 'Max Repetitions', prize_pool, rules, banner_url, outdoor_details, is_outdoor, icon: req.body.icon,
    });
    if (error) return res.status(400).json({ success: false, message: error });
    const newComp = await compRepo.createCompetition(data);
    if (newComp) { const icon = await compRepo.setCompetitionIcon(newComp.id, data.icon); if (icon !== undefined) newComp.icon = icon; }

    res.status(201).json({
      success: true,
      message: 'Fitness competition created successfully.',
      data: newComp
    });
  } catch (error) {
    console.error('Error in createCompetition:', error);
    res.status(500).json({ success: false, message: 'Failed to create competition.' });
  }
}

// ---------------------------------------------------------------- edit / delete (owner, manager)

const STATUSES = ['upcoming', 'in_progress', 'completed', 'cancelled'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Validate a full competition form (used by Edit). Returns { data } or { error }. */
function cleanCompetition(body = {}) {
  const title = str(body.title, 151);
  const type = str(body.type, 51);
  const metric = str(body.metric_type, 31);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : '';
  if (!title || !type || !description || !body.start_date || !body.end_date) return { error: 'Title, competition type, description, start date and end date are required.' };
  if (title.length > 150) return { error: 'Title can be at most 150 characters.' };
  if (type.length > 50) return { error: 'Competition type can be at most 50 characters.' };
  if (!metric) return { error: 'Choose or type a metric (how the winner is decided).' };
  if (metric.length > 30) return { error: 'Metric can be at most 30 characters.' };
  for (const [k, v] of [['start date', body.start_date], ['end date', body.end_date], ['registration deadline', body.registration_deadline]]) {
    if (v && (!ISO.test(String(v)) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()))) return { error: `Invalid ${k}.` };
  }
  if (body.end_date < body.start_date) return { error: 'End date cannot be before the start date.' };
  if (body.registration_deadline && body.registration_deadline > body.end_date) return { error: 'Registration deadline cannot be after the end date.' };
  if (body.status !== undefined && body.status !== null && !STATUSES.includes(body.status)) return { error: 'Invalid competition status.' };
  const banner = str(body.banner_url, 1000);
  if (banner && !/^https?:\/\//i.test(banner)) return { error: 'Banner image must be a http(s) link.' };
  const trainer = body.organizer_trainer_id ? Number(body.organizer_trainer_id) : null;
  if (trainer !== null && (!Number.isInteger(trainer) || trainer <= 0)) return { error: 'Invalid coach / referee.' };
  const o = body.outdoor_details && typeof body.outdoor_details === 'object' ? body.outdoor_details : {};
  const num = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
  const outdoor = {
    sport: str(o.sport, 80), venue: str(o.venue, 120), team_format: str(o.team_format, 60),
    max_teams: num(o.max_teams, 2, 64), players_per_team: num(o.players_per_team, 1, 30),
    equipment: str(o.equipment, 200), weather_plan: str(o.weather_plan, 200),
  };
  // Icon: one emoji (or a very short symbol), empty = automatic icon from the type.
  let icon = typeof body.icon === 'string' ? body.icon.trim() : '';
  if (icon && ([...icon].length > 8 || /[<>"'`&\\]|[A-Za-z0-9]/.test(icon))) return { error: 'Pick an emoji icon (letters, numbers and symbols like < > are not allowed).' };
  return { data: {
    icon: icon || null,
    title, type, description, metric_type: metric, start_date: body.start_date, end_date: body.end_date,
    registration_deadline: body.registration_deadline || null, status: body.status || null, organizer_trainer_id: trainer,
    prize_pool: str(body.prize_pool, 150), rules: typeof body.rules === 'string' ? body.rules.trim().slice(0, 4000) : '',
    banner_url: banner, is_outdoor: type === 'Outdoor Games', outdoor_details: outdoor,
  } };
}

/** PUT /api/v1/admin/competitions/:id — edit everything about a competition. */
export async function updateCompetition(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid competition id.' });
    const { data, error } = cleanCompetition(req.body);
    if (error) return res.status(400).json({ success: false, message: error });
    const updated = await compRepo.updateCompetition(id, data);
    if (!updated) return res.status(404).json({ success: false, message: 'Competition not found.' });
    const icon = await compRepo.setCompetitionIcon(id, data.icon); if (icon !== undefined) updated.icon = icon;
    res.json({ success: true, message: 'Competition updated.', data: updated });
  } catch (error) {
    console.error('Error in updateCompetition:', error);
    res.status(500).json({ success: false, message: 'Failed to update competition.' });
  }
}

/** DELETE /api/v1/admin/competitions/:id — removes the competition, its registrations and certificates (copy kept in the audit log). */
export async function deleteCompetition(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'Invalid competition id.' });
    const result = await compRepo.deleteCompetition(id, req.user || {});
    if (!result) return res.status(404).json({ success: false, message: 'Competition not found.' });
    res.json({ success: true, message: `Deleted "${result.title}".`, data: result });
  } catch (error) {
    console.error('Error in deleteCompetition:', error);
    res.status(500).json({ success: false, message: 'Failed to delete competition.' });
  }
}

export { cleanCompetition };

export async function updateCompetitionStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['upcoming', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid competition status.' });
    }
    const updated = await compRepo.updateCompetitionStatus(id, status);
    res.json({
      success: true,
      message: `Competition status updated to ${status}.`,
      data: updated
    });
  } catch (error) {
    console.error('Error in updateCompetitionStatus:', error);
    res.status(500).json({ success: false, message: 'Failed to update competition status.' });
  }
}

export async function getParticipants(req, res) {
  try {
    const { competition_id, member_id, status } = req.query;
    const participants = await compRepo.getParticipants({ competition_id, member_id, status });
    res.json({
      success: true,
      count: participants.length,
      data: participants
    });
  } catch (error) {
    console.error('Error in getParticipants:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch competition participants.' });
  }
}

export async function registerParticipant(req, res) {
  try {
    const { competition_id, member_id, division, score_unit } = req.body;
    if (!competition_id || !member_id) {
      return res.status(400).json({
        success: false,
        message: 'Competition ID and Member ID are required.'
      });
    }

    const participant = await compRepo.registerParticipant({
      competition_id,
      member_id,
      division,
      score_unit
    });

    res.status(201).json({
      success: true,
      message: 'Member successfully registered for competition.',
      data: participant
    });
  } catch (error) {
    console.error('Error in registerParticipant:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Member is already registered for this competition.' });
    }
    res.status(500).json({ success: false, message: 'Failed to register participant.' });
  }
}

export async function submitScore(req, res) {
  try {
    const { participantId } = req.params;
    const { score, notes } = req.body;

    if (score === undefined || score === null) {
      return res.status(400).json({ success: false, message: 'Score value is required.' });
    }

    // verified_by_trainer_id references trainers(id) — never a users(id). A trainer verifies as
    // themselves; owner/manager may name the verifying trainer, otherwise it stays empty.
    const bodyTrainer = Number(req.body.verified_by_trainer_id);
    const verifiedByTrainerId = req.user?.trainerId
      || (Number.isInteger(bodyTrainer) && bodyTrainer > 0 ? bodyTrainer : null);
    const result = await compRepo.submitScore(
      participantId,
      parseFloat(score),
      verifiedByTrainerId,
      notes || ''
    );

    res.json({
      success: true,
      message: 'Score submitted and leaderboard rankings recalculated.',
      data: result
    });
  } catch (error) {
    console.error('Error in submitScore:', error);
    res.status(500).json({ success: false, message: 'Failed to submit score.' });
  }
}

export async function getLeaderboard(req, res) {
  try {
    const { competitionId } = req.params;
    const leaderboard = await compRepo.getLeaderboard(competitionId);
    res.json({
      success: true,
      count: leaderboard.length,
      data: leaderboard
    });
  } catch (error) {
    console.error('Error in getLeaderboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard.' });
  }
}

export async function issueCertificate(req, res) {
  try {
    const { competition_id, member_id, award_title, rank_awarded } = req.body;
    if (!competition_id || !member_id || !award_title) {
      return res.status(400).json({
        success: false,
        message: 'Competition ID, Member ID, and Award Title are required.'
      });
    }

    const cert = await compRepo.issueCertificate({
      competition_id,
      member_id,
      award_title,
      rank_awarded,
      issued_by: req.user?.username ? `Virtex (${req.user.username})` : 'Virtex Athletics'
    });

    res.status(201).json({
      success: true,
      message: 'Official competition award certificate issued successfully.',
      data: cert
    });
  } catch (error) {
    console.error('Error in issueCertificate:', error);
    res.status(500).json({ success: false, message: 'Failed to issue award certificate.' });
  }
}

export async function getCertificates(req, res) {
  try {
    const { member_id, competition_id } = req.query;
    const certs = await compRepo.getCertificates({ member_id, competition_id });
    res.json({
      success: true,
      count: certs.length,
      data: certs
    });
  } catch (error) {
    console.error('Error in getCertificates:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch certificates.' });
  }
}

export async function getCompetitionModuleKpis(req, res) {
  try {
    const kpis = await compRepo.getCompetitionModuleKpis();
    res.json({
      success: true,
      data: kpis
    });
  } catch (error) {
    console.error('Error in getCompetitionModuleKpis:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch competition module KPIs.' });
  }
}

