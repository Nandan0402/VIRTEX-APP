/**
 * performance.controller.js - Controller for Client Performance Center
 */

import { performanceRepository } from '../repositories/performance.repository.js';
import { buildProgressReport } from '../services/progressReport.service.js';

export async function getPerformanceCards(req, res, next) {
  try {
    const { search, trainer_id, goal, status } = req.query;
    const cards = await performanceRepository.getPerformanceCards({
      search,
      trainerId: trainer_id ? parseInt(trainer_id, 10) : null,
      goal,
      status,
    });

    res.json({
      success: true,
      data: cards,
      meta: {
        total: cards.length,
        on_track: cards.filter(c => c.progress_status === 'on_track').length,
        improving: cards.filter(c => c.progress_status === 'improving').length,
        needs_attention: cards.filter(c => c.progress_status === 'needs_attention').length,
        insufficient_data: cards.filter(c => c.progress_status === 'insufficient_data').length,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getMemberDetails(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (!memberId) {
      return res.status(400).json({ success: false, error: 'Invalid Member ID' });
    }

    const details = await performanceRepository.getMemberPerformanceDetails(memberId);
    if (!details) {
      return res.status(404).json({ success: false, error: 'Member performance profile not found' });
    }

    // Owner / manager only (admin router denies trainer & member). Same calculated report the
    // member sees — summaries only, no invented percentages.
    const progressReport = await buildProgressReport(memberId);
    res.json({
      success: true,
      data: { ...details, progressReport },
    });
  } catch (err) {
    next(err);
  }
}

export async function logStrength(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    const { exercise_name, weight_kg, reps } = req.body;

    if (!memberId || !exercise_name || !weight_kg) {
      return res.status(400).json({ success: false, error: 'Missing required fields: exercise_name and weight_kg' });
    }

    const log = await performanceRepository.addStrengthLog({
      memberId,
      exerciseName: exercise_name,
      weightKg: parseFloat(weight_kg),
      reps: reps ? parseInt(reps, 10) : 1,
    });

    res.status(201).json({
      success: true,
      data: log,
      message: 'Strength progression record saved successfully',
    });
  } catch (err) {
    next(err);
  }
}

export async function logBodyMeasurement(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    const { weight_kg, body_fat_pct, muscle_mass_kg, chest_cm, waist_cm, arms_cm, thighs_cm, notes } = req.body;

    if (!memberId || !weight_kg) {
      return res.status(400).json({ success: false, error: 'Weight in kg is required' });
    }

    const measurement = await performanceRepository.addBodyMeasurement({
      memberId,
      weightKg: parseFloat(weight_kg),
      bodyFatPct: body_fat_pct ? parseFloat(body_fat_pct) : null,
      muscleMassKg: muscle_mass_kg ? parseFloat(muscle_mass_kg) : null,
      chestCm: chest_cm ? parseFloat(chest_cm) : null,
      waistCm: waist_cm ? parseFloat(waist_cm) : null,
      armsCm: arms_cm ? parseFloat(arms_cm) : null,
      thighsCm: thighs_cm ? parseFloat(thighs_cm) : null,
      notes,
    });

    res.status(201).json({
      success: true,
      data: measurement,
      message: 'Body measurements logged successfully',
    });
  } catch (err) {
    next(err);
  }
}

export async function addComment(req, res, next) {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    const { trainer_id, comment_type, comment_text } = req.body;

    if (!memberId || !comment_text) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }

    const comment = await performanceRepository.addTrainerComment({
      memberId,
      trainerId: trainer_id ? parseInt(trainer_id, 10) : null,
      commentType: comment_type || 'weekly_checkin',
      commentText: comment_text,
    });

    res.status(201).json({
      success: true,
      data: comment,
      message: 'Trainer feedback comment posted successfully',
    });
  } catch (err) {
    next(err);
  }
}

