-- 028_announcement_polls.sql
-- Poll announcements: the gym publishes an announcement with choices (e.g. "Which outdoor game?
-- Badminton / Cricket / Football") and members vote on the ones they are interested in.
-- Additive only: one new column with a default, two new tables. No existing data changes.
-- Undo: 028_announcement_polls_down.sql
BEGIN;

-- false = each member picks one choice; true = members may pick several.
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS poll_multiple BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS announcement_poll_options (
    id               SERIAL PRIMARY KEY,
    announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    label            VARCHAR(80) NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
    position         SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 10),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_poll_option_position UNIQUE (announcement_id, position)
);
CREATE INDEX IF NOT EXISTS idx_poll_options_announcement ON announcement_poll_options (announcement_id);

-- One row per (choice, member). Changing a vote replaces the member's rows for that poll.
CREATE TABLE IF NOT EXISTS announcement_poll_votes (
    option_id        INTEGER NOT NULL REFERENCES announcement_poll_options(id) ON DELETE CASCADE,
    announcement_id  INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
    member_id        INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    voted_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (option_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_announcement_member ON announcement_poll_votes (announcement_id, member_id);

COMMIT;
