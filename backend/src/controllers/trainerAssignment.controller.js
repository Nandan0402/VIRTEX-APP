import * as assignmentRepo from '../repositories/trainerAssignment.repository.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * GET /api/v1/trainers/assignments
 * List personal trainer assignments
 */
export async function getTrainerAssignments(req, res, next) {
  try {
    const { search, trainerId, status, paymentStatus } = req.query;
    const assignments = await assignmentRepo.getAssignments({
      search,
      trainerId,
      status,
      paymentStatus,
    });
    const summary = await assignmentRepo.getAssignmentsSummary();

    res.json({
      success: true,
      data: assignments,
      summary,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/trainers/assignments/summary
 */
export async function getTrainerAssignmentsSummary(req, res, next) {
  try {
    const summary = await assignmentRepo.getAssignmentsSummary();
    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/trainers/assignments
 * Assign member to personal trainer
 */
export async function createTrainerAssignment(req, res, next) {
  try {
    const { memberId, trainerId, monthlyFee } = req.body;
    if (!memberId || !trainerId) {
      return res.status(400).json({
        success: false,
        error: 'Both Member and Trainer selections are required.',
      });
    }

    const created = await assignmentRepo.createAssignment(req.body);
    broadcast('TRAINER_ASSIGNED', created, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });

    res.status(201).json({
      success: true,
      message: `Member ${created.member_name} successfully assigned to Coach ${created.trainer_name} with monthly fee of ₹${Number(created.monthly_fee).toLocaleString('en-IN')}.`,
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/v1/trainers/assignments/:id
 * Update assignment
 */
export async function updateTrainerAssignment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await assignmentRepo.updateAssignment(id, req.body);
    broadcast('TRAINER_ASSIGNMENT_UPDATED', updated, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });

    res.json({
      success: true,
      message: 'Personal trainer assignment updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/v1/trainers/assignments/:id
 * Delete assignment
 */
export async function deleteTrainerAssignment(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = await assignmentRepo.deleteAssignment(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Assignment record not found.' });
    }

    broadcast('TRAINER_ASSIGNMENT_DELETED', { id }, { channel: 'admin', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'Personal trainer assignment removed successfully.',
    });
  } catch (err) {
    next(err);
  }
}

