import { query, isDatabaseConnected } from '../config/database.js';

const MOCK_TRAINERS = [
  {
    id: 1,
    trainer_code: 'TRN001',
    full_name: 'Arjun Reddy',
    specialty: 'CrossFit & Olympic Weightlifting',
    phone: '9876500001',
    email: 'arjun@pulsecorefitness.in',
    status: 'on_floor',
    shift_hours: '06:00 AM - 02:00 PM',
    certifications: ['CSCS', 'CrossFit L2', 'CPR/AED'],
  },
  {
    id: 2,
    trainer_code: 'TRN002',
    full_name: 'Meera Rao',
    specialty: 'Functional Mobility & Hatha Yoga',
    phone: '9876500002',
    email: 'meera@pulsecorefitness.in',
    status: 'in_session',
    shift_hours: '08:00 AM - 04:00 PM',
    certifications: ['RYT-500', 'Core Rehab Specialist'],
  },
  {
    id: 3,
    trainer_code: 'TRN003',
    full_name: 'Karan Verma',
    specialty: 'Hypertrophy & Physique Coach',
    phone: '9876500003',
    email: 'karan@pulsecorefitness.in',
    status: 'off_duty',
    shift_hours: '02:00 PM - 10:00 PM',
    certifications: ['ACE Personal Trainer', 'ISSN Sports Nutritionist'],
  },
];

/**
 * Fetch trainers with optional floor status filter (e.g. 'on_floor', 'in_session')
 * @param {object} filter - { status }
 */
export async function getTrainers({ status } = {}) {
  if (isDatabaseConnected()) {
    const params = [];
    let statusClause = '';

    if (status) {
      statusClause = 'WHERE t.status = $1';
      params.push(status);
    }

    const sql = `
      SELECT 
        t.id, 
        t.trainer_code, 
        t.full_name, 
        t.specialty, 
        t.phone, 
        t.email, 
        t.bio, 
        t.certifications, 
        t.status,
        s.shift_start, 
        s.shift_end
      FROM trainers t
      LEFT JOIN trainer_schedules s 
        ON t.id = s.trainer_id 
        AND s.day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP)::smallint
      ${statusClause}
      ORDER BY 
        CASE t.status 
          WHEN 'on_floor' THEN 1 
          WHEN 'in_session' THEN 2 
          ELSE 3 
        END,
        t.full_name ASC;
    `;
    const result = await query(sql, params);
    return result.rows;
  }

  // Fallback mock
  return MOCK_TRAINERS.filter((t) => (!status ? true : t.status === status));
}

