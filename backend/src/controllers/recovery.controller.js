import * as recoveryRepo from '../repositories/recovery.repository.js';

export async function getRecoveryLogs(req, res) {
  try {
    const { member_id, start_date, end_date, readiness_status, limit } = req.query;
    const logs = await recoveryRepo.getRecoveryLogs({
      member_id,
      start_date,
      end_date,
      readiness_status,
      limit: limit ? parseInt(limit, 10) : 30
    });
    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('Error in getRecoveryLogs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recovery logs.' });
  }
}

export async function getRecoveryLogById(req, res) {
  try {
    const { id } = req.params;
    const log = await recoveryRepo.getRecoveryLogById(id);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Recovery log not found.' });
    }
    res.json({ success: true, data: log });
  } catch (error) {
    console.error('Error in getRecoveryLogById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recovery log details.' });
  }
}

export async function logMemberRecovery(req, res) {
  try {
    const {
      member_id,
      log_date,
      sleep_hours,
      sleep_quality,
      energy_level,
      stress_level,
      hydration_liters,
      overall_soreness_rating,
      user_notes,
      is_rest_day,
      rest_day_activity,
      sorenessItems
    } = req.body;

    if (!member_id || sleep_hours === undefined || sleep_quality === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Member ID, sleep hours, and sleep quality rating are required.'
      });
    }

    const savedLog = await recoveryRepo.logMemberRecovery({
      member_id,
      log_date,
      sleep_hours,
      sleep_quality,
      energy_level,
      stress_level,
      hydration_liters,
      overall_soreness_rating,
      user_notes,
      is_rest_day,
      rest_day_activity,
      logged_by: req.user?.username || 'Admin'
    }, sorenessItems || []);

    res.status(201).json({
      success: true,
      message: 'Recovery and wellness assessment recorded successfully.',
      data: savedLog
    });
  } catch (error) {
    console.error('Error in logMemberRecovery:', error);
    res.status(500).json({ success: false, message: 'Failed to log recovery assessment.' });
  }
}

export async function getMuscleSorenessHeatmap(req, res) {
  try {
    const { memberId } = req.params;
    const heatmap = await recoveryRepo.getMuscleSorenessHeatmap(memberId);
    res.json({
      success: true,
      data: heatmap
    });
  } catch (error) {
    console.error('Error in getMuscleSorenessHeatmap:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch muscle soreness heatmap.' });
  }
}

export async function getTrainerRecoveryOverview(req, res) {
  try {
    const { trainer_id } = req.query;
    const overview = await recoveryRepo.getTrainerRecoveryOverview({ trainer_id });
    res.json({
      success: true,
      count: overview.length,
      data: overview
    });
  } catch (error) {
    console.error('Error in getTrainerRecoveryOverview:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch trainer recovery overview.' });
  }
}

export async function addTrainerRecoveryReview(req, res) {
  try {
    const { member_id, trainer_id, review_date, fatigue_risk_level, trainer_advice, suggested_rest_days } = req.body;
    if (!member_id || !trainer_advice) {
      return res.status(400).json({
        success: false,
        message: 'Member ID and trainer advice are required.'
      });
    }

    const review = await recoveryRepo.addTrainerRecoveryReview({
      member_id,
      trainer_id,
      review_date,
      fatigue_risk_level,
      trainer_advice,
      suggested_rest_days
    });

    res.status(201).json({
      success: true,
      message: 'Trainer recovery advice recorded.',
      data: review
    });
  } catch (error) {
    console.error('Error in addTrainerRecoveryReview:', error);
    res.status(500).json({ success: false, message: 'Failed to record trainer recovery advice.' });
  }
}

export async function getMemberRecoveryReport(req, res) {
  try {
    const { memberId } = req.params;
    const { days } = req.query;
    const report = await recoveryRepo.getMemberRecoveryReport({
      member_id: memberId,
      days: days ? parseInt(days, 10) : 14
    });

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getMemberRecoveryReport:', error);
    res.status(500).json({ success: false, message: 'Failed to generate member recovery report.' });
  }
}

export async function getRecoveryModuleKpis(req, res) {
  try {
    const kpis = await recoveryRepo.getRecoveryModuleKpis();
    res.json({
      success: true,
      data: kpis
    });
  } catch (error) {
    console.error('Error in getRecoveryModuleKpis:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch recovery module KPIs.' });
  }
}

