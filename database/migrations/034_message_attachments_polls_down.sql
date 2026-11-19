-- Reverts 034. WARNING: removes all message attachments (records), polls and votes. Stored files under
-- backend/storage/message-files are NOT deleted by this script. Back up first.
BEGIN;
DROP TABLE IF EXISTS message_poll_votes;
DROP TABLE IF EXISTS message_poll_options;
DROP TABLE IF EXISTS message_polls;
DROP TABLE IF EXISTS message_attachments;
COMMIT;
