import { query, withTransaction } from '../config/database.js';

/**
 * List all personal trainer assignments with member and trainer details
 */
export async function getAssignments({ search = '', trainerId = null, status = 'all', paymentStatus = 'all' } = {}) {
  let conditions = [];
  let params = [];
  let idx = 1;

  if (trainerId && trainerId !== 'all') {
    conditions.push(`a.trainer_id = $${idx++}`);
    params.push(parseInt(trainerId, 10));
  }

  if (status && status !== 'all') {
    conditions.push(`a.status = $${idx++}`);
    params.push(status);
  }

  if (paymentStatus && paymentStatus !== 'all') {
    conditions.push(`a.payment_status = $${idx++}`);
    params.push(paymentStatus);
  }

  if (search && search.trim()) {
    conditions.push(`(
      m.full_name ILIKE $${idx} OR 
      m.member_code ILIKE $${idx} OR 
      m.phone ILIKE $${idx} OR 
      t.full_name ILIKE $${idx} OR
      t.trainer_code ILIKE $${idx}
    )`);
    params.push(`%${search.trim()}%`);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      a.id,
      a.member_id,
      m.member_code,
      m.full_name AS member_name,
      m.phone AS member_phone,
      m.email AS member_email,
      m.plan_name AS membership_plan,
      a.trainer_id,
      t.trainer_code,
      t.full_name AS trainer_name,
      t.specialty AS trainer_specialty,
      t.phone AS trainer_phone,
      t.status AS trainer_floor_status,
      COALESCE(a.monthly_fee, 0) AS monthly_fee,
      COALESCE(a.fee_paid, 0) AS fee_paid,
      COALESCE(a.fee_due, 0) AS fee_due,
      a.start_date,
      a.end_date,
      a.sessions_per_week,
      a.preferred_slot,
      a.training_goal,
      a.payment_status,
      a.status,
      a.notes,
      a.created_at,
      a.updated_at,
      CASE 
        WHEN a.end_date < CURRENT_DATE THEN (CURRENT_DATE - a.end_date)
        ELSE 0
      END AS days_expired,
      CASE 
        WHEN a.end_date >= CURRENT_DATE THEN (a.end_date - CURRENT_DATE)
        ELSE 0
      END AS days_remaining
    FROM personal_trainer_assignments a
    JOIN members m ON m.id = a.member_id
    JOIN trainers t ON t.id = a.trainer_id
    ${whereClause}
    ORDER BY a.created_at DESC;
  `;

  const res = await query(sql, params);
  return res.rows;
}

/**
 * Get summary stats for personal trainer assignments
 */
export async function getAssignmentsSummary() {
  const sql = `
    SELECT 
      COUNT(*) AS total_assignments,
      COUNT(CASE WHEN status = 'active' THEN 1 END) AS active_assignments,
      COUNT(DISTINCT trainer_id) AS trainers_with_clients,
      COALESCE(SUM(CASE WHEN status = 'active' THEN monthly_fee ELSE 0 END), 0) AS total_monthly_revenue,
      COALESCE(SUM(CASE WHEN status = 'active' THEN fee_due ELSE 0 END), 0) AS pending_fees_total,
      COUNT(CASE WHEN status = 'active' AND end_date <= CURRENT_DATE + INTERVAL '7 days' THEN 1 END) AS expiring_soon_count
    FROM personal_trainer_assignments;
  `;
  const res = await query(sql);
  return res.rows[0];
}

/**
 * Get assignment by ID
 */
export async function getAssignmentById(id) {
  const sql = `
    SELECT 
      a.*,
      m.member_code,
      m.full_name AS member_name,
      m.phone AS member_phone,
      m.email AS member_email,
      t.trainer_code,
      t.full_name AS trainer_name,
      t.specialty AS trainer_specialty
    FROM personal_trainer_assignments a
    JOIN members m ON m.id = a.member_id
    JOIN trainers t ON t.id = a.trainer_id
    WHERE a.id = $1
    LIMIT 1;
  `;
  const res = await query(sql, [id]);
  return res.rows[0] || null;
}

/**
 * Create a new personal trainer assignment
 */
export async function createAssignment(data) {
  const {
    memberId,
    trainerId,
    monthlyFee = 5000,
    feePaid = null,
    feeDue = null,
    startDate = new Date().toISOString().split('T')[0],
    endDate = null,
    sessionsPerWeek = 3,
    preferredSlot = 'Morning (07:00 AM - 08:00 AM)',
    trainingGoal = 'General Fitness',
    paymentStatus = 'paid',
    status = 'active',
    notes = '',
  } = data;

  const numFee = parseFloat(monthlyFee) || 0;
  let paid = feePaid !== null ? parseFloat(feePaid) : (paymentStatus === 'paid' ? numFee : 0);
  let due = feeDue !== null ? parseFloat(feeDue) : Math.max(0, numFee - paid);

  let calculatedEndDate = endDate;
  if (!calculatedEndDate) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + 30);
    calculatedEndDate = d.toISOString().split('T')[0];
  }

  const sql = `
    INSERT INTO personal_trainer_assignments (
      member_id, trainer_id, monthly_fee, fee_paid, fee_due,
      start_date, end_date, sessions_per_week, preferred_slot,
      training_goal, payment_status, status, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *;
  `;

  const res = await query(sql, [
    parseInt(memberId, 10),
    parseInt(trainerId, 10),
    numFee,
    paid,
    due,
    startDate,
    calculatedEndDate,
    parseInt(sessionsPerWeek, 10) || 3,
    preferredSlot,
    trainingGoal,
    paymentStatus,
    status,
    notes,
  ]);

  return await getAssignmentById(res.rows[0].id);
}

/**
 * Update an existing assignment
 */
export async function updateAssignment(id, data) {
  const existing = await getAssignmentById(id);
  if (!existing) {
    throw new Error('Assignment not found');
  }

  const monthlyFee = data.monthlyFee !== undefined ? parseFloat(data.monthlyFee) : parseFloat(existing.monthly_fee);
  const feePaid = data.feePaid !== undefined ? parseFloat(data.feePaid) : parseFloat(existing.fee_paid);
  const feeDue = data.feeDue !== undefined ? parseFloat(data.feeDue) : Math.max(0, monthlyFee - feePaid);
  const paymentStatus = data.paymentStatus || (feeDue <= 0 ? 'paid' : (feePaid > 0 ? 'partial' : 'pending'));

  // REASSIGNMENT (different trainer on a live assignment): preserve history.
  // The old row is closed ('completed', end_date = today) and stays linked to the old
  // trainer; a NEW row is created for the new trainer. Trainer-scoped access checks
  // only honour active/paused assignments, so the old trainer loses access immediately
  // and the new trainer gains it immediately.
  const newTrainerId = data.trainerId ? parseInt(data.trainerId, 10) : null;
  if (newTrainerId && newTrainerId !== existing.trainer_id && ['active', 'paused'].includes(existing.status)) {
    const newId = await withTransaction(async (client) => {
      await client.query(
        `UPDATE personal_trainer_assignments
            SET status = 'completed',
                end_date = LEAST(end_date, CURRENT_DATE),
                notes = TRIM(BOTH ' ' FROM COALESCE(notes, '') || ' [Reassigned to trainer #' || $2::text || ' on ' || CURRENT_DATE::text || ']'),
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [id, newTrainerId]
      );
      const startDate = data.startDate || new Date().toISOString().split('T')[0];
      let endDate = data.endDate || (existing.end_date ? new Date(existing.end_date).toISOString().split('T')[0] : null);
      if (!endDate || endDate < startDate) {
        const d = new Date(startDate);
        d.setDate(d.getDate() + 30);
        endDate = d.toISOString().split('T')[0];
      }
      const ins = await client.query(
        `INSERT INTO personal_trainer_assignments (
           member_id, trainer_id, monthly_fee, fee_paid, fee_due, start_date, end_date,
           sessions_per_week, preferred_slot, training_goal, payment_status, status, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12)
         RETURNING id`,
        [
          existing.member_id,
          newTrainerId,
          monthlyFee,
          feePaid,
          feeDue,
          startDate,
          endDate,
          data.sessionsPerWeek ? parseInt(data.sessionsPerWeek, 10) : existing.sessions_per_week,
          data.preferredSlot || existing.preferred_slot,
          data.trainingGoal || existing.training_goal,
          paymentStatus,
          data.notes !== undefined ? data.notes : `Reassigned from assignment #${id}`,
        ]
      );
      return ins.rows[0].id;
    });
    return await getAssignmentById(newId);
  }

  const sql = `
    UPDATE personal_trainer_assignments
    SET 
      trainer_id = COALESCE($1, trainer_id),
      monthly_fee = $2,
      fee_paid = $3,
      fee_due = $4,
      start_date = COALESCE($5, start_date),
      end_date = COALESCE($6, end_date),
      sessions_per_week = COALESCE($7, sessions_per_week),
      preferred_slot = COALESCE($8, preferred_slot),
      training_goal = COALESCE($9, training_goal),
      payment_status = $10,
      status = COALESCE($11, status),
      notes = COALESCE($12, notes),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $13
    RETURNING *;
  `;

  await query(sql, [
    data.trainerId ? parseInt(data.trainerId, 10) : null,
    monthlyFee,
    feePaid,
    feeDue,
    data.startDate || null,
    data.endDate || null,
    data.sessionsPerWeek ? parseInt(data.sessionsPerWeek, 10) : null,
    data.preferredSlot || null,
    data.trainingGoal || null,
    paymentStatus,
    data.status || null,
    data.notes !== undefined ? data.notes : null,
    id,
  ]);

  return await getAssignmentById(id);
}

/**
 * "Delete" assignment = END it, preserving history (rule: keep records when assignments end).
 * Marks it cancelled and closes end_date at today; the row, its fees and its links remain.
 * Trainer access checks ignore cancelled assignments, so the trainer loses access immediately.
 */
export async function deleteAssignment(id) {
  const sql = `
    UPDATE personal_trainer_assignments
       SET status = 'cancelled',
           end_date = LEAST(end_date, CURRENT_DATE),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id;`;
  const res = await query(sql, [id]);
  return res.rowCount > 0;
}

