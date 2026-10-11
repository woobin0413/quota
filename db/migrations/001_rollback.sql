-- =====================================================
-- Quota Database Schema - Rollback Migration
-- =====================================================
-- Description: Rollback for initial schema migration
-- Version: 1.0.0
-- Date: 2026-01-18
-- =====================================================

-- Drop all triggers first
DROP TRIGGER IF EXISTS trigger_increment_quote_count ON quotes;
DROP TRIGGER IF EXISTS trigger_generate_quote_number ON quotes;
DROP TRIGGER IF EXISTS trigger_calculate_totals_on_line_item ON quote_line_items;
DROP TRIGGER IF EXISTS trigger_log_quote_activity ON quotes;
DROP TRIGGER IF EXISTS trigger_update_contact_stats_on_quote ON quotes;

DROP TRIGGER IF EXISTS update_audio_updated_at ON audio_recordings;
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
DROP TRIGGER IF EXISTS update_line_items_updated_at ON quote_line_items;
DROP TRIGGER IF EXISTS update_quotes_updated_at ON quotes;
DROP TRIGGER IF EXISTS update_contacts_updated_at ON contacts;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- Drop all functions
DROP FUNCTION IF EXISTS reset_monthly_quote_counts();
DROP FUNCTION IF EXISTS check_quote_expiration();
DROP FUNCTION IF EXISTS increment_user_quote_count();
DROP FUNCTION IF EXISTS generate_quote_number();
DROP FUNCTION IF EXISTS calculate_quote_totals();
DROP FUNCTION IF EXISTS log_quote_activity();
DROP FUNCTION IF EXISTS update_contact_stats();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Drop all tables (in reverse order of dependencies)
DROP TABLE IF EXISTS audio_recordings;
DROP TABLE IF EXISTS quote_activity;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS quote_line_items;
DROP TABLE IF EXISTS quotes;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS users;

-- Drop custom types
DROP TYPE IF EXISTS activity_action;
DROP TYPE IF EXISTS payment_status;
DROP TYPE IF EXISTS quote_status;

-- Drop extensions (only if not used by other schemas)
-- DROP EXTENSION IF EXISTS pg_trgm;
-- DROP EXTENSION IF EXISTS "uuid-ossp";

-- =====================================================
-- ROLLBACK COMPLETE
-- =====================================================
