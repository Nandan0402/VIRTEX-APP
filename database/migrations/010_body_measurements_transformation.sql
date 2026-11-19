-- Migration 010: Body Measurements and Transformation Schema
-- Enhances member_body_measurements and member_transformation_photos
-- Supports Weight, Height, BMI, Body-Fat %, Muscle Mass, Circumferences (Chest, Waist, Hips, Arms, Thighs, Calves),
-- Measurement History, Before-and-After Photos with Consent, and Transformation Timelines.

ALTER TABLE member_body_measurements 
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(5,1) DEFAULT 175.0,
  ADD COLUMN IF NOT EXISTS bmi NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS hips_cm NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS calves_cm NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS shoulders_cm NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS neck_cm NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS measured_by VARCHAR(50) DEFAULT 'Trainer';

ALTER TABLE member_transformation_photos
  ADD COLUMN IF NOT EXISTS pose VARCHAR(30) DEFAULT 'Front',
  ADD COLUMN IF NOT EXISTS phase VARCHAR(50) DEFAULT 'Baseline',
  ADD COLUMN IF NOT EXISTS weight_at_photo NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS body_fat_at_photo NUMERIC(4,1),
  ADD COLUMN IF NOT EXISTS consent_signature VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_body_meas_member_date ON member_body_measurements(member_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_trans_photos_member_phase ON member_transformation_photos(member_id, phase);

