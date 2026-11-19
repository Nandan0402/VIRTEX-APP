-- Migration 027: Outdoor Games Customization for Fitness Competitions
-- Adds support for outdoor sports, games, ground locations, team formats, and custom gear requirements.

ALTER TABLE fitness_competitions 
  ADD COLUMN IF NOT EXISTS is_outdoor BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS outdoor_details JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_competitions_is_outdoor ON fitness_competitions(is_outdoor);
