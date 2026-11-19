-- Migration 013: Fitness Books, Digital Library, Secure Document Storage, and E-Book Publishing
-- Provides book catalogue, digital uploads, fitness/bodybuilding/anatomy/nutrition/exercise science libraries,
-- e-book publishing, paid & free tiers, secure access control, purchase history, and reading progress.

CREATE TABLE IF NOT EXISTS library_books (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE,
  author VARCHAR(255) NOT NULL,
  category VARCHAR(50) NOT NULL, -- 'Fitness & Training', 'Bodybuilding & Hypertrophy', 'Human Anatomy & Biomechanics', 'Nutrition & Dietetics', 'Exercise Physiology & Science', 'Gym Facility Rulebook'
  description TEXT,
  cover_url TEXT,
  secure_file_path TEXT NOT NULL,
  file_format VARCHAR(10) NOT NULL DEFAULT 'PDF', -- 'PDF', 'EPUB'
  file_size_mb NUMERIC(5,2) NOT NULL DEFAULT 8.50,
  page_count INTEGER NOT NULL DEFAULT 200,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  price_amount NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  access_tier VARCHAR(30) NOT NULL DEFAULT 'all_members', -- 'all_members', 'vip_tier', 'staff_only', 'purchased_only'
  status VARCHAR(20) NOT NULL DEFAULT 'published', -- 'draft', 'published', 'archived'
  downloads_count INTEGER NOT NULL DEFAULT 0,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_library_books_category ON library_books(category);
CREATE INDEX IF NOT EXISTS idx_library_books_status ON library_books(status);
CREATE INDEX IF NOT EXISTS idx_library_books_is_paid ON library_books(is_paid);

CREATE TABLE IF NOT EXISTS book_purchases (
  id SERIAL PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  amount_paid NUMERIC(8,2) NOT NULL DEFAULT 0.00,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Wallet / Online Payment',
  invoice_code VARCHAR(100) UNIQUE NOT NULL,
  purchased_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_book_purchases_member ON book_purchases(member_id);
CREATE INDEX IF NOT EXISTS idx_book_purchases_book ON book_purchases(book_id);

CREATE TABLE IF NOT EXISTS book_reading_progress (
  id SERIAL PRIMARY KEY,
  book_id INTEGER NOT NULL REFERENCES library_books(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL DEFAULT 1,
  total_pages INTEGER NOT NULL DEFAULT 100,
  progress_pct INTEGER NOT NULL DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  last_read_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(book_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_book_reading_progress_member ON book_reading_progress(member_id);

-- Seed Data using existing Members (Rahul Sharma, Priya Patel, David Miller)
DO $$
DECLARE
  v_member_rahul INTEGER;
  v_member_priya INTEGER;
  v_member_david INTEGER;
  v_book_periodization INTEGER;
  v_book_hypertrophy INTEGER;
  v_book_anatomy INTEGER;
  v_book_nutrition INTEGER;
  v_book_physiology INTEGER;
  v_book_rulebook INTEGER;
BEGIN
  -- Lookup members
  SELECT id INTO v_member_rahul FROM members WHERE full_name ILIKE '%Rahul%' LIMIT 1;
  SELECT id INTO v_member_priya FROM members WHERE full_name ILIKE '%Priya%' LIMIT 1;
  SELECT id INTO v_member_david FROM members WHERE full_name ILIKE '%David%' LIMIT 1;

  IF v_member_rahul IS NULL THEN SELECT id INTO v_member_rahul FROM members LIMIT 1; END IF;
  IF v_member_priya IS NULL THEN SELECT id INTO v_member_priya FROM members LIMIT 1; END IF;
  IF v_member_david IS NULL THEN SELECT id INTO v_member_david FROM members LIMIT 1; END IF;

  -- 1. Seed Books across all requested categories
  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'Periodization Principles & Strength Conditioning',
    'periodization-principles-strength',
    'Dr. Tudor Bompa & Carlo Buzzichelli',
    'Fitness & Training',
    'The foundational scientific text on linear, undulating, and block periodization models for competitive athletic development.',
    'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=700',
    'vault/books/periodization_principles_v6.pdf',
    'PDF',
    14.20,
    380,
    false,
    0.00,
    'INR',
    'all_members',
    'published',
    42
  )
  RETURNING id INTO v_book_periodization;

  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'The Hypertrophy Blueprint: Mechanical Tension & Volume',
    'hypertrophy-blueprint-volume-tension',
    'Dr. Brad Schoenfeld',
    'Bodybuilding & Hypertrophy',
    'Evidence-based muscle building protocols focusing on effective reps, progressive tension overload, and muscle damage optimization.',
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    'vault/books/hypertrophy_blueprint_ed2.pdf',
    'PDF',
    18.50,
    320,
    true,
    799.00,
    'INR',
    'purchased_only',
    'published',
    28
  )
  RETURNING id INTO v_book_hypertrophy;

  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'Clinical Kinesiology & Human Skeletal Biomechanics',
    'clinical-kinesiology-skeletal-biomechanics',
    'Donald A. Neumann, PT, PhD',
    'Human Anatomy & Biomechanics',
    'In-depth anatomical treatise illustrating force vectors, articular kinematics, spinal mechanics, and musculoskeletal leverage.',
    'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=700',
    'vault/books/clinical_kinesiology_neumann.pdf',
    'PDF',
    26.80,
    450,
    false,
    0.00,
    'INR',
    'vip_tier',
    'published',
    19
  )
  RETURNING id INTO v_book_anatomy;

  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'Advanced Sports Nutrition & Macronutrient Partitioning',
    'advanced-sports-nutrition-partitioning',
    'Dr. Dan Benardot, FACSM',
    'Nutrition & Dietetics',
    'Physiological guidelines on intra-workout carbohydrate feeding, leucine thresholds, micronutrient bioavailability, and cellular hydration.',
    'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=700',
    'vault/books/sports_nutrition_benardot.pdf',
    'PDF',
    11.40,
    280,
    true,
    949.00,
    'INR',
    'purchased_only',
    'published',
    35
  )
  RETURNING id INTO v_book_nutrition;

  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'Exercise Physiology: Energy Systems & Metabolic Adaptation',
    'exercise-physiology-metabolic-adaptation',
    'Jack H. Wilmore & David L. Costill',
    'Exercise Physiology & Science',
    'Comprehensive examination of phosphagen, glycolytic, and oxidative energy systems during maximal power and sustained endurance output.',
    'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=700',
    'vault/books/exercise_physiology_wilmore.pdf',
    'PDF',
    21.30,
    510,
    false,
    0.00,
    'INR',
    'staff_only',
    'published',
    15
  )
  RETURNING id INTO v_book_physiology;

  INSERT INTO library_books (
    title, slug, author, category, description, cover_url, secure_file_path,
    file_format, file_size_mb, page_count, is_paid, price_amount, currency, access_tier, status, downloads_count
  )
  VALUES (
    'Virtex Official Facility Rulebook & Equipment Etiquette',
    'virtex-facility-rulebook-etiquette',
    'Virtex Executive Athletics Board',
    'Gym Facility Rulebook',
    'Official code of conduct, barbell collar mandates, chalk usage protocols, and emergency safety directives for all club patrons.',
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=700',
    'vault/books/virtex_rulebook_2026.pdf',
    'PDF',
    4.10,
    48,
    false,
    0.00,
    'INR',
    'all_members',
    'published',
    89
  )
  RETURNING id INTO v_book_rulebook;

  -- 2. Seed Book Purchases
  IF v_member_rahul IS NOT NULL AND v_book_hypertrophy IS NOT NULL THEN
    INSERT INTO book_purchases (book_id, member_id, amount_paid, currency, payment_method, invoice_code, purchased_at)
    VALUES (v_book_hypertrophy, v_member_rahul, 799.00, 'INR', 'UPI / Virtex Pay', 'INV-BK-2026-001', NOW() - INTERVAL '5 days');
  END IF;

  IF v_member_priya IS NOT NULL AND v_book_nutrition IS NOT NULL THEN
    INSERT INTO book_purchases (book_id, member_id, amount_paid, currency, payment_method, invoice_code, purchased_at)
    VALUES (v_book_nutrition, v_member_priya, 949.00, 'INR', 'Credit Card (Visa)', 'INV-BK-2026-002', NOW() - INTERVAL '3 days');
  END IF;

  -- 3. Seed Reading Progress
  IF v_member_rahul IS NOT NULL AND v_book_hypertrophy IS NOT NULL THEN
    INSERT INTO book_reading_progress (book_id, member_id, current_page, total_pages, progress_pct, completed, last_read_at, notes)
    VALUES (v_book_hypertrophy, v_member_rahul, 180, 320, 56, false, NOW() - INTERVAL '1 day', 'Studying volume progression for chest and lats.')
    ON CONFLICT (book_id, member_id) DO NOTHING;
  END IF;

  IF v_member_priya IS NOT NULL AND v_book_nutrition IS NOT NULL THEN
    INSERT INTO book_reading_progress (book_id, member_id, current_page, total_pages, progress_pct, completed, last_read_at, notes)
    VALUES (v_book_nutrition, v_member_priya, 245, 280, 88, false, NOW() - INTERVAL '2 hours', 'Reviewing carbohydrate timing guidelines.')
    ON CONFLICT (book_id, member_id) DO NOTHING;
  END IF;

  IF v_member_david IS NOT NULL AND v_book_anatomy IS NOT NULL THEN
    INSERT INTO book_reading_progress (book_id, member_id, current_page, total_pages, progress_pct, completed, last_read_at, notes)
    VALUES (v_book_anatomy, v_member_david, 45, 450, 10, false, NOW() - INTERVAL '4 days', 'Initial review of glenohumeral biomechanics.')
    ON CONFLICT (book_id, member_id) DO NOTHING;
  END IF;

END $$;

