import * as workoutRepo from '../repositories/workout.repository.js';

export async function getExercises(req, res) {
  try {
    const { muscle_group, equipment, difficulty, search } = req.query;
    const exercises = await workoutRepo.getExercises({ muscle_group, equipment, difficulty, search });
    res.json({
      success: true,
      count: exercises.length,
      data: exercises
    });
  } catch (error) {
    console.error('Error in getExercises:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exercise library.' });
  }
}

export async function getExerciseById(req, res) {
  try {
    const { id } = req.params;
    const exercise = await workoutRepo.getExerciseById(id);
    if (!exercise) {
      return res.status(404).json({ success: false, message: 'Exercise not found.' });
    }
    res.json({ success: true, data: exercise });
  } catch (error) {
    console.error('Error in getExerciseById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch exercise.' });
  }
}

export async function createExercise(req, res) {
  try {
    const { name, muscle_group, equipment, difficulty, instructions, target_muscles, video_url } = req.body;
    if (!name || !muscle_group || !equipment || !instructions) {
      return res.status(400).json({
        success: false,
        message: 'Name, muscle group, equipment, and instructions are required.'
      });
    }
    const newExercise = await workoutRepo.createExercise({
      name,
      muscle_group,
      equipment,
      difficulty,
      instructions,
      target_muscles,
      video_url
    });
    res.status(201).json({
      success: true,
      message: 'Exercise successfully added to library.',
      data: newExercise
    });
  } catch (error) {
    console.error('Error in createExercise:', error);
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'An exercise with this name already exists.' });
    }
    res.status(500).json({ success: false, message: 'Failed to create exercise.' });
  }
}

export async function getWorkoutPrograms(req, res) {
  try {
    const { trainer_id, goal, split_type, search } = req.query;
    const programs = await workoutRepo.getWorkoutPrograms({ trainer_id, goal, split_type, search });
    res.json({
      success: true,
      count: programs.length,
      data: programs
    });
  } catch (error) {
    console.error('Error in getWorkoutPrograms:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch workout programs.' });
  }
}

export async function getWorkoutProgramById(req, res) {
  try {
    const { id } = req.params;
    const program = await workoutRepo.getWorkoutProgramById(id);
    if (!program) {
      return res.status(404).json({ success: false, message: 'Workout program not found.' });
    }
    res.json({ success: true, data: program });
  } catch (error) {
    console.error('Error in getWorkoutProgramById:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch workout program.' });
  }
}

export async function createWorkoutProgram(req, res) {
  try {
    const { name, trainer_id, difficulty_level, goal, split_type, description, is_template, days } = req.body;
    if (!name || !goal || !split_type) {
      return res.status(400).json({
        success: false,
        message: 'Program name, goal, and split type are required.'
      });
    }

    const newProgram = await workoutRepo.createWorkoutProgram(
      { name, trainer_id, difficulty_level, goal, split_type, description, is_template },
      days || []
    );

    res.status(201).json({
      success: true,
      message: 'Workout program successfully created.',
      data: newProgram
    });
  } catch (error) {
    console.error('Error in createWorkoutProgram:', error);
    res.status(500).json({ success: false, message: 'Failed to create workout program.' });
  }
}

export async function getMemberAssignments(req, res) {
  try {
    const { member_id, trainer_id, status } = req.query;
    const assignments = await workoutRepo.getMemberAssignments({ member_id, trainer_id, status });
    res.json({
      success: true,
      count: assignments.length,
      data: assignments
    });
  } catch (error) {
    console.error('Error in getMemberAssignments:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch member assignments.' });
  }
}

export async function assignProgramToMember(req, res) {
  try {
    const { member_id, program_id, assigned_by_trainer_id, start_date, notes } = req.body;
    if (!member_id || !program_id) {
      return res.status(400).json({
        success: false,
        message: 'Member ID and Program ID are required.'
      });
    }
    const assignment = await workoutRepo.assignProgramToMember({
      member_id,
      program_id,
      assigned_by_trainer_id,
      start_date,
      notes
    });
    res.status(201).json({
      success: true,
      message: 'Workout program successfully assigned to member.',
      data: assignment
    });
  } catch (error) {
    console.error('Error in assignProgramToMember:', error);
    res.status(500).json({ success: false, message: 'Failed to assign workout program.' });
  }
}

export async function updateAssignmentStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['active', 'completed', 'paused'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid assignment status.' });
    }
    const updated = await workoutRepo.updateAssignmentStatus(id, status);
    res.json({
      success: true,
      message: `Assignment status updated to ${status}.`,
      data: updated
    });
  } catch (error) {
    console.error('Error in updateAssignmentStatus:', error);
    res.status(500).json({ success: false, message: 'Failed to update assignment status.' });
  }
}

export async function getWorkoutSessionLogs(req, res) {
  try {
    const { member_id, program_id, limit } = req.query;
    const logs = await workoutRepo.getWorkoutSessionLogs({
      member_id,
      program_id,
      limit: limit ? parseInt(limit, 10) : 30
    });
    res.json({
      success: true,
      count: logs.length,
      data: logs
    });
  } catch (error) {
    console.error('Error in getWorkoutSessionLogs:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch workout session logs.' });
  }
}

export async function getWorkoutSessionDetail(req, res) {
  try {
    const { id } = req.params;
    const session = await workoutRepo.getWorkoutSessionDetail(id);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session log not found.' });
    }
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error in getWorkoutSessionDetail:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch session details.' });
  }
}

export async function logWorkoutSession(req, res) {
  try {
    const { member_id, program_id, day_id, completed_at, duration_minutes, rpe_rating, notes, logged_by, items } = req.body;
    if (!member_id) {
      return res.status(400).json({ success: false, message: 'Member ID is required to log a session.' });
    }
    const session = await workoutRepo.logWorkoutSession({
      member_id,
      program_id,
      day_id,
      completed_at,
      duration_minutes,
      rpe_rating,
      notes,
      logged_by: logged_by || req.user?.username || 'Admin'
    }, items || []);

    res.status(201).json({
      success: true,
      message: 'Workout session logged successfully.',
      data: session
    });
  } catch (error) {
    console.error('Error in logWorkoutSession:', error);
    res.status(500).json({ success: false, message: 'Failed to log workout session.' });
  }
}

export async function getMemberWorkoutProgress(req, res) {
  try {
    const { memberId } = req.params;
    const [personalBests, strengthProgression] = await Promise.all([
      workoutRepo.getPersonalBests(memberId),
      workoutRepo.getStrengthProgression(memberId)
    ]);

    res.json({
      success: true,
      data: {
        personalBests,
        strengthProgression
      }
    });
  } catch (error) {
    console.error('Error in getMemberWorkoutProgress:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch member workout progress.' });
  }
}

export async function getWorkoutAnalytics(req, res) {
  try {
    const analytics = await workoutRepo.getWorkoutAnalytics();
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error in getWorkoutAnalytics:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch workout analytics.' });
  }
}

