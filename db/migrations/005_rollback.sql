-- Rollback for migration 005: Atomic send-tracking functions

DROP FUNCTION IF EXISTS record_quote_send(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS record_receipt_send(UUID, UUID);
