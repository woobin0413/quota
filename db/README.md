# Quota Database Schema

## Overview

This directory contains the PostgreSQL database schema, migrations, and seed data for the Quota application.

> **Current-state notes** (this doc predates several changes — CLAUDE.md + the numbered migrations in `db/migrations/` are the source of truth):
> - **12 tables**, not 7 (added: `payment_milestones`, `quote_payments`, `usage_sessions`, `waitlist_signups`, `quote_activity`).
> - **UUID defaults use `gen_random_uuid()`** (Postgres core), not `uuid_generate_v4()` — the latter fails on hosted Supabase.
> - **`tax_rate` column is retained but unused** — sales tax was removed from the app (total = subtotal − discount).
> - **Migration `011_lockdown_anon_access`** revokes all `anon`/`authenticated` DB access; only the service-role backend reads/writes. Verify with `scripts/verify-anon-lockdown.sh`.
> - Ignore "set up a database on Vercel" — Vercel Postgres is discontinued; use hosted **Supabase**.

## Quick Start

### 1. Set Up Database

Create a PostgreSQL database on Vercel or your preferred hosting platform.

### 2. Run Initial Migration

```bash
# Using psql
psql $POSTGRES_URL -f db/migrations/001_initial_schema.sql

# Or via Vercel dashboard: Copy and paste the migration file
```

### 3. Load Development Data (Optional)

```bash
psql "$POSTGRES_URL" -f db/seeds/dev_seed.sql
# Optional, only for a local Supabase database; reads .env.local:
npm run db:link-seed
```

## Schema Summary

### Tables (7 total)

| Table | Purpose | Key Features |
|-------|---------|--------------|
| `users` | User accounts (Clerk sync) | Subscription tracking, monthly quotas |
| `contacts` | Client contacts | Auto-stats, full-text search, deduplication |
| `quotes` | Quote documents | Auto-numbering, versioning, status tracking |
| `quote_line_items` | Quote items | Auto-total calculation |
| `payments` | Stripe transactions | Payment intent tracking |
| `quote_activity` | Audit log | Auto-logging all changes |
| `audio_recordings` | Voice recordings | Transcription processing |

### Custom Types

```sql
CREATE TYPE quote_status AS ENUM (
  'draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'
);

CREATE TYPE payment_status AS ENUM (
  'pending', 'processing', 'succeeded', 'failed', 'refunded', 'canceled'
);

CREATE TYPE activity_action AS ENUM (
  'created', 'updated', 'sent', 'viewed', 'accepted',
  'rejected', 'expired', 'deleted', 'restored'
);
```

## Key Features

### Automated Business Logic

#### 1. Quote Number Generation
```sql
-- Auto-generates: Q-2026-001, Q-2026-002, etc.
CREATE TRIGGER trigger_generate_quote_number
  BEFORE INSERT ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION generate_quote_number();
```

#### 2. Quote Total Calculation
```sql
-- Automatically recalculates when line items change
CREATE TRIGGER trigger_calculate_totals_on_line_item
  AFTER INSERT OR UPDATE OR DELETE ON quote_line_items
  FOR EACH ROW
  EXECUTE FUNCTION calculate_quote_totals();
```

#### 3. Contact Statistics
```sql
-- Auto-updates total_quotes, accepted_quotes, total_revenue
CREATE TRIGGER trigger_update_contact_stats_on_quote
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_stats();
```

#### 4. Activity Logging
```sql
-- Logs all quote changes with before/after values
CREATE TRIGGER trigger_log_quote_activity
  AFTER INSERT OR UPDATE ON quotes
  FOR EACH ROW
  EXECUTE FUNCTION log_quote_activity();
```

### Performance Optimizations

#### Indexes (40+ total)

**Users:**
- `idx_users_clerk_id` - Fast Clerk ID lookups
- `idx_users_email` - Email searches

**Contacts:**
- `idx_contacts_user_id` - User's contacts
- `idx_contacts_name_trgm` - Full-text search on names (GIN)
- `idx_contacts_company_trgm` - Full-text search on companies (GIN)
- `idx_contacts_user_active` - Active contacts per user

**Quotes:**
- `idx_quotes_user_status` - Dashboard queries (user + status)
- `idx_quotes_user_date_range` - Date-filtered lists
- `idx_quotes_valid_until` - Expiration checking
- `idx_quotes_project_name_trgm` - Full-text search

**Payments:**
- `idx_payments_stripe_intent` - Stripe webhook lookups
- `idx_payments_user_status` - Payment history

### Data Integrity

#### Foreign Key Relationships

```sql
-- Contacts cascade delete when user is deleted
contact_id REFERENCES users(id) ON DELETE CASCADE

-- Prevent deleting contacts with active quotes
contact_id REFERENCES contacts(id) ON DELETE RESTRICT

-- Payments block quote deletion
quote_id REFERENCES quotes(id) ON DELETE RESTRICT
```

#### CHECK Constraints

```sql
-- Financial validation
CONSTRAINT valid_financial_amounts CHECK (
  subtotal >= 0 AND
  tax_amount >= 0 AND
  discount_amount >= 0 AND
  total >= 0
)

-- Email format
CONSTRAINT email_format CHECK (
  email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
)

-- Tax rate range
CONSTRAINT valid_tax_rate CHECK (
  tax_rate >= 0 AND tax_rate <= 100
)
```

### Soft Deletes

Tables with soft delete support (via `deleted_at` timestamp):
- users
- contacts
- quotes
- audio_recordings

All queries in `lib/db.ts` filter `deleted_at IS NULL` automatically.

### Full-Text Search

Uses PostgreSQL's `pg_trgm` extension for fuzzy text matching:

```sql
-- Search contacts by name or company
SELECT * FROM contacts
WHERE name ILIKE '%search%'
   OR company ILIKE '%search%';
-- Optimized by GIN index: idx_contacts_name_trgm
```

## Maintenance Functions

### Monthly Quota Reset

```sql
-- Reset all users' quote counts (run on 1st of month)
SELECT reset_monthly_quote_counts();
```

### Quote Expiration

```sql
-- Expire quotes past their valid_until date (run daily)
SELECT check_quote_expiration();
```

### Recommended Cron Jobs

```bash
# Reset monthly quotas (1st of month at midnight)
0 0 1 * * psql $POSTGRES_URL -c "SELECT reset_monthly_quote_counts();"

# Check for expired quotes (daily at 1 AM)
0 1 * * * psql $POSTGRES_URL -c "SELECT check_quote_expiration();"
```

## Migration Management

### Applying Migrations

```bash
# Initial schema
psql $POSTGRES_URL -f db/migrations/001_initial_schema.sql

# Future migrations
psql $POSTGRES_URL -f db/migrations/002_add_feature.sql
```

### Rolling Back

```bash
# Rollback initial migration
psql $POSTGRES_URL -f db/migrations/001_rollback.sql
```

### Creating New Migrations

When adding features:

1. Create new migration file: `db/migrations/XXX_description.sql`
2. Create corresponding rollback: `db/migrations/XXX_rollback.sql`
3. Update `lib/db.ts` with new query functions
4. Update TypeScript types in `types/index.ts`
5. Document in this README

## Development Seed Data

The `dev_seed.sql` file contains:
- 2 demo users
- 4 contacts
- 4 quotes (various statuses)
- 17 line items
- 1 payment

**WARNING:** Never run seed data in production!

## Query Examples

### Get user's quotes with contact info

```typescript
import { getQuotes } from '@/lib/db';

const quotes = await getQuotes(userId, {
  status: 'sent',
  limit: 10
});
```

### Search contacts

```typescript
import { searchContacts } from '@/lib/db';

const results = await searchContacts(userId, 'Smith Construction');
```

### Create quote with line items

```typescript
import { createQuote, createQuoteLineItem } from '@/lib/db';

// Create quote
const quote = await createQuote(userId, {
  contactId: contact.id,
  projectName: 'Kitchen Remodel',
  taxRate: 8.5,
});

// Add line items
await createQuoteLineItem(quote.id, {
  description: 'Labor',
  quantity: 40,
  unitPrice: 75.00,
  total: 3000.00,
  unitOfMeasure: 'hours',
  category: 'labor',
});

// Totals are automatically calculated by trigger!
```

## Backup & Recovery

### Backup

```bash
# Backup entire database
pg_dump $POSTGRES_URL > backup_$(date +%Y%m%d).sql

# Backup schema only
pg_dump $POSTGRES_URL --schema-only > schema_backup.sql

# Backup data only
pg_dump $POSTGRES_URL --data-only > data_backup.sql
```

### Restore

```bash
psql $POSTGRES_URL < backup_20260118.sql
```

## Performance Monitoring

### Check Index Usage

```sql
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;
```

### Find Slow Queries

```sql
SELECT
  query,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

## Security Considerations

1. **Row-Level Security:** All queries filter by `user_id` to prevent unauthorized access
2. **Soft Deletes:** Preserves data for audit trails
3. **Activity Logging:** All quote changes tracked with IP/user agent
4. **Email Validation:** Enforced at database level
5. **Financial Constraints:** Prevents negative amounts

## Support

For database issues or questions, see:
- Migration files: `db/migrations/`
- Query functions: `lib/db.ts`
- Type definitions: `types/index.ts`
- Main docs: `CLAUDE.md`
