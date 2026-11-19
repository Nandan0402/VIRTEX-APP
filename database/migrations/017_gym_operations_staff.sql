-- Migration 017: Gym Operations and Staff Management
-- Integrates staff registration & profiles, roles & permissions, attendance reports (from routine_punches),
-- staff shift management, branch management, facility zones management & maintenance logs,
-- staff performance reports, and branch-wise analytics.
-- Preserves existing Routine Tracker, Working Hours, and Gym Calendar with zero duplication.

-- 1. Gym Multi-Branch Directory
CREATE TABLE IF NOT EXISTS gym_branches (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL DEFAULT 'Bengaluru',
  phone VARCHAR(50),
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  operating_hours VARCHAR(100) NOT NULL DEFAULT '06:00 - 22:00',
  max_capacity INTEGER NOT NULL DEFAULT 150,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Staff Extended Profiles (Directly links to users table, preserving staff records)
CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  branch_id INTEGER REFERENCES gym_branches(id) ON DELETE SET NULL,
  employee_id VARCHAR(50) UNIQUE NOT NULL,
  department VARCHAR(50) NOT NULL DEFAULT 'Operations', -- 'Operations', 'Fitness & Training', 'Front Desk', 'Maintenance', 'Management'
  designation VARCHAR(100) NOT NULL,
  employment_type VARCHAR(30) NOT NULL DEFAULT 'Full-Time', -- 'Full-Time', 'Part-Time', 'Contract', 'Intern'
  date_of_joining DATE NOT NULL DEFAULT CURRENT_DATE,
  base_salary NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Staff Shift Management & Roster
CREATE TABLE IF NOT EXISTS staff_shifts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES gym_branches(id) ON DELETE CASCADE,
  shift_date DATE NOT NULL,
  shift_type VARCHAR(50) NOT NULL, -- 'Morning (06:00 - 14:00)', 'General (09:00 - 17:00)', 'Evening (14:00 - 22:00)', 'Night (22:00 - 06:00)'
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'completed', 'swapped', 'absent'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_staff_shifts_user ON staff_shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_date ON staff_shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_staff_shifts_branch ON staff_shifts(branch_id);

-- 4. Facility Zones Management
CREATE TABLE IF NOT EXISTS gym_facilities (
  id SERIAL PRIMARY KEY,
  branch_id INTEGER NOT NULL REFERENCES gym_branches(id) ON DELETE CASCADE,
  zone_name VARCHAR(100) NOT NULL,
  facility_type VARCHAR(50) NOT NULL, -- 'Strength Training', 'Cardiovascular', 'Recovery & Wellness', 'Group Studio', 'Functional Rig', 'Hygiene & Amenities'
  capacity INTEGER NOT NULL DEFAULT 30,
  floor_number VARCHAR(20) NOT NULL DEFAULT 'Ground Floor',
  status VARCHAR(30) NOT NULL DEFAULT 'open', -- 'open', 'maintenance', 'closed'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_facilities_branch ON gym_facilities(branch_id);

-- 5. Facility Maintenance & Inspection Logs
CREATE TABLE IF NOT EXISTS facility_maintenance_logs (
  id SERIAL PRIMARY KEY,
  facility_id INTEGER NOT NULL REFERENCES gym_facilities(id) ON DELETE CASCADE,
  branch_id INTEGER NOT NULL REFERENCES gym_branches(id) ON DELETE CASCADE,
  maintenance_type VARCHAR(100) NOT NULL, -- 'Deep Sanitization & Ozone Wash', 'HVAC Air Filter Cleaning', 'Sauna Heating Element Inspection', 'Lighting & Power Systems', 'Audio & Sensor Rig Service'
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  technician_name VARCHAR(100) NOT NULL,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'overdue'
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facility_maint_branch ON facility_maintenance_logs(branch_id);

-- Seed Branches, Facilities, Staff Profiles, Shifts, and Maintenance Logs
DO $$
DECLARE
  v_branch_indiranagar INTEGER;
  v_branch_koramangala INTEGER;
  v_branch_whitefield INTEGER;
  v_fac_arena INTEGER;
  v_fac_cardio INTEGER;
  v_fac_sauna INTEGER;
  v_fac_studio INTEGER;
  v_user_priya INTEGER;
  v_user_kavya INTEGER;
  v_user_arjun INTEGER;
  v_user_nandan INTEGER;
BEGIN
  -- Find key existing staff user IDs
  SELECT id INTO v_user_priya FROM users WHERE role = 'manager' LIMIT 1;
  SELECT id INTO v_user_kavya FROM users WHERE role = 'reception_staff' LIMIT 1;
  SELECT id INTO v_user_arjun FROM users WHERE role = 'trainer' LIMIT 1;
  SELECT id INTO v_user_nandan FROM users WHERE role = 'owner' LIMIT 1;

  -- 1. Seed Branches
  INSERT INTO gym_branches (code, name, address, city, phone, manager_id, operating_hours, max_capacity, is_active)
  VALUES ('BLR-IND', 'Virtex Flagship Indiranagar', '42, 100 Feet Road, Indiranagar', 'Bengaluru', '+91 98765 00000', v_user_priya, '06:00 - 22:00', 180, true)
  RETURNING id INTO v_branch_indiranagar;

  INSERT INTO gym_branches (code, name, address, city, phone, manager_id, operating_hours, max_capacity, is_active)
  VALUES ('BLR-KOR', 'Virtex Arena Koramangala', '15, 80 Feet Road, 4th Block, Koramangala', 'Bengaluru', '+91 98765 00001', v_user_priya, '06:00 - 22:00', 140, true)
  RETURNING id INTO v_branch_koramangala;

  INSERT INTO gym_branches (code, name, address, city, phone, manager_id, operating_hours, max_capacity, is_active)
  VALUES ('BLR-WHT', 'Virtex Tech Hub Whitefield', 'Plot 10, EPIP Zone, Whitefield', 'Bengaluru', '+91 98765 00002', v_user_priya, '06:00 - 23:00', 200, true)
  RETURNING id INTO v_branch_whitefield;

  -- 2. Seed Facilities in Flagship
  INSERT INTO gym_facilities (branch_id, zone_name, facility_type, capacity, floor_number, status, notes)
  VALUES (v_branch_indiranagar, 'Olympic Strength & Free Weight Arena', 'Strength Training', 60, 'Ground Floor', 'open', 'Eleiko platforms and dumbbell twin racks')
  RETURNING id INTO v_fac_arena;

  INSERT INTO gym_facilities (branch_id, zone_name, facility_type, capacity, floor_number, status, notes)
  VALUES (v_branch_indiranagar, 'Aerobic & Curved Treadmill Cardio Loft', 'Cardiovascular', 40, '1st Floor', 'open', 'Woodway slat-belt treadmills and stair climbers')
  RETURNING id INTO v_fac_cardio;

  INSERT INTO gym_facilities (branch_id, zone_name, facility_type, capacity, floor_number, status, notes)
  VALUES (v_branch_indiranagar, 'Nordic Sauna & Contrast Recovery Suite', 'Recovery & Wellness', 15, 'Basement', 'open', 'Finnish cedar dry sauna and cold plunges')
  RETURNING id INTO v_fac_sauna;

  INSERT INTO gym_facilities (branch_id, zone_name, facility_type, capacity, floor_number, status, notes)
  VALUES (v_branch_indiranagar, 'Mind-Body & HIIT Group Fitness Studio', 'Group Studio', 35, '2nd Floor', 'open', 'Sprung hardwood floor and surround sound')
  RETURNING id INTO v_fac_studio;

  -- 3. Seed Extended Staff Profiles for existing staff users
  IF v_user_nandan IS NOT NULL THEN
    INSERT INTO staff_profiles (user_id, branch_id, employee_id, department, designation, employment_type, base_salary, emergency_contact_name, emergency_contact_phone)
    VALUES (v_user_nandan, v_branch_indiranagar, 'PC-EMP-001', 'Management', 'Managing Director & Facility Owner', 'Full-Time', 150000.00, 'Operations Desk', '+91 83104 25800')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF v_user_priya IS NOT NULL THEN
    INSERT INTO staff_profiles (user_id, branch_id, employee_id, department, designation, employment_type, base_salary, emergency_contact_name, emergency_contact_phone)
    VALUES (v_user_priya, v_branch_indiranagar, 'PC-EMP-002', 'Operations', 'General Floor Operations Manager', 'Full-Time', 65000.00, 'Suresh Deshmukh', '+91 98765 44001')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF v_user_kavya IS NOT NULL THEN
    INSERT INTO staff_profiles (user_id, branch_id, employee_id, department, designation, employment_type, base_salary, emergency_contact_name, emergency_contact_phone)
    VALUES (v_user_kavya, v_branch_indiranagar, 'PC-EMP-003', 'Front Desk', 'Senior Front Desk & Reception Lead', 'Full-Time', 35000.00, 'Ravi Gowda', '+91 98765 44002')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF v_user_arjun IS NOT NULL THEN
    INSERT INTO staff_profiles (user_id, branch_id, employee_id, department, designation, employment_type, base_salary, emergency_contact_name, emergency_contact_phone)
    VALUES (v_user_arjun, v_branch_indiranagar, 'PC-EMP-004', 'Fitness & Training', 'Head Strength & Conditioning Coach', 'Full-Time', 55000.00, 'Anita Sharma', '+91 98765 44003')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 4. Seed Staff Shifts
  IF v_user_priya IS NOT NULL THEN
    INSERT INTO staff_shifts (user_id, branch_id, shift_date, shift_type, start_time, end_time, status, notes)
    VALUES (v_user_priya, v_branch_indiranagar, CURRENT_DATE, 'General (09:00 - 17:00)', '09:00:00', '17:00:00', 'completed', 'Floor inspection and equipment audit');
  END IF;

  IF v_user_kavya IS NOT NULL THEN
    INSERT INTO staff_shifts (user_id, branch_id, shift_date, shift_type, start_time, end_time, status, notes)
    VALUES 
      (v_user_kavya, v_branch_indiranagar, CURRENT_DATE, 'Morning (06:00 - 14:00)', '06:00:00', '14:00:00', 'completed', 'Turnstile check-in reception & WhatsApp desk'),
      (v_user_kavya, v_branch_indiranagar, CURRENT_DATE + INTERVAL '1 day', 'Morning (06:00 - 14:00)', '06:00:00', '14:00:00', 'scheduled', 'Early morning reception duty');
  END IF;

  IF v_user_arjun IS NOT NULL THEN
    INSERT INTO staff_shifts (user_id, branch_id, shift_date, shift_type, start_time, end_time, status, notes)
    VALUES 
      (v_user_arjun, v_branch_indiranagar, CURRENT_DATE, 'Evening (14:00 - 22:00)', '14:00:00', '22:00:00', 'scheduled', 'Prime-time strength coaching and PT consultations'),
      (v_user_arjun, v_branch_indiranagar, CURRENT_DATE + INTERVAL '1 day', 'Evening (14:00 - 22:00)', '14:00:00', '22:00:00', 'scheduled', 'PT block & deadlift clinic');
  END IF;

  -- 5. Seed Facility Maintenance Logs
  INSERT INTO facility_maintenance_logs (facility_id, branch_id, maintenance_type, scheduled_date, completed_date, technician_name, cost, status, notes)
  VALUES 
    (v_fac_sauna, v_branch_indiranagar, 'Sauna Heating Element & Thermostat Inspection', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '3 days', 'ThermalTech HVAC Co.', 3500.00, 'completed', 'Calibrated digital thermostats and sanitized cedar benching.'),
    (v_fac_cardio, v_branch_indiranagar, 'HVAC Air Filter Cleaning & Slat-Belt Alignment', CURRENT_DATE + INTERVAL '4 days', NULL, 'CleanAir Services', 2200.00, 'scheduled', 'Quarterly HEPA filter replacement for Cardio Loft.');

END $$;

