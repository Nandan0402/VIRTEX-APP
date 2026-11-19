-- 034_message_attachments_polls.sql  (additive only — four new tables, no existing rows change)
--
-- Attachments (PDF, Word, Excel, PowerPoint, images, text/CSV) and polls inside Messages, for every
-- conversation type (member↔trainer, member↔gym team, trainer↔gym team, groups) in all three portals.
-- Each attachment / poll belongs to one message (messages.id); deleting a message removes its extras.
-- Files are stored on the server OUTSIDE the public web folder (storage_name), and are only downloadable by
-- people who can open that conversation.

BEGIN;

CREATE TABLE IF NOT EXISTS message_attachments (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_name VARCHAR(160) NOT NULL,
    mime_type VARCHAR(120) NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
    storage_name VARCHAR(80) NOT NULL UNIQUE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_polls (
    id BIGSERIAL PRIMARY KEY,
    public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    message_id BIGINT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
    question VARCHAR(200) NOT NULL,
    allow_multiple BOOLEAN NOT NULL DEFAULT FALSE,
    closed_at TIMESTAMPTZ,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_poll_options (
    id BIGSERIAL PRIMARY KEY,
    poll_id BIGINT NOT NULL REFERENCES message_polls(id) ON DELETE CASCADE,
    label VARCHAR(100) NOT NULL,
    position SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_message_poll_options_poll ON message_poll_options(poll_id, position);

CREATE TABLE IF NOT EXISTS message_poll_votes (
    id BIGSERIAL PRIMARY KEY,
    poll_id BIGINT NOT NULL REFERENCES message_polls(id) ON DELETE CASCADE,
    option_id BIGINT NOT NULL REFERENCES message_poll_options(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_message_poll_vote UNIQUE (option_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_poll_votes_poll ON message_poll_votes(poll_id, user_id);

COMMIT;
