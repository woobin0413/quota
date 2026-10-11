-- =====================================================
-- Quota Development Seed Data
-- =====================================================
-- Description: Synthetic fixtures for development and testing.
-- No real customer names, addresses, mailboxes, or Auth0 identities.
-- Link your own local account with npm run db:link-seed after resetting the DB.
-- Version: 2.0.0
-- Date: 2026-07-11
-- Schema: matches migrations 001–003 (is_paid model, work catalog,
--         no quote lifecycle status)
-- =====================================================

-- WARNING: This seed data is for DEVELOPMENT ONLY
-- DO NOT run this in production!

-- =====================================================
-- SEED DATA: Users (contractors)
-- =====================================================

INSERT INTO users (
  id,
  auth0_user_id,
  email,
  first_name,
  last_name,
  company_name,
  phone,
  subscription_tier,
  monthly_quote_limit,
  quotes_this_month
) VALUES
  -- Contractor 1 is synthetic. Link it to E2E_AUTH0_USER_ID from .env.local
  -- with npm run db:link-seed to make its data visible after logging in.
  (
    '00000000-0000-0000-0000-000000000001',
    'user_demo_contractor_1',
    'demo-1@example.invalid',
    'Demo',
    'Plumber',
    'Example Plumbing & Heating',
    '(408) 555-0134',
    'pro',
    100,
    5
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'user_demo_contractor_2',
    'demo-2@example.invalid',
    'Demo',
    'Electrician',
    'Example Electric',
    '(510) 555-0198',
    'free',
    10,
    3
  );

-- =====================================================
-- SEED DATA: Work Catalog (per-contractor)
-- =====================================================

INSERT INTO work_items (
  id,
  user_id,
  name,
  description,
  unit_of_measure,
  default_unit_price,
  category,
  sort_order
) VALUES
  -- Example Plumbing & Heating catalog
  (
    '40000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Water heater replacement (50 gal)',
    'Remove old unit, install new 50-gallon gas water heater, haul away',
    'each',
    1850.00,
    'plumbing',
    1
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Toilet install',
    'Remove existing toilet, install customer-supplied or standard unit',
    'each',
    375.00,
    'plumbing',
    2
  ),
  (
    '40000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Drain cleaning (main line)',
    'Snake main sewer line up to 100 ft',
    'each',
    295.00,
    'plumbing',
    3
  ),
  (
    '40000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    'Copper repipe',
    'Replace supply lines with Type L copper',
    'lf',
    18.50,
    'plumbing',
    4
  ),
  (
    '40000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000001',
    'Service call / diagnostics',
    'First hour of on-site labor and diagnosis',
    'hours',
    145.00,
    'plumbing',
    5
  ),
  -- Example Electric catalog
  (
    '40000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000002',
    'Panel upgrade (200A)',
    'Replace existing panel with 200A service, permit included',
    'each',
    3200.00,
    'electrical',
    1
  ),
  (
    '40000000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000002',
    'Recessed light install',
    'LED recessed fixture, includes patching',
    'each',
    185.00,
    'electrical',
    2
  ),
  (
    '40000000-0000-0000-0000-000000000008',
    '00000000-0000-0000-0000-000000000002',
    'EV charger circuit (240V)',
    'Dedicated 50A circuit and NEMA 14-50 outlet',
    'each',
    950.00,
    'electrical',
    3
  );

-- =====================================================
-- SEED DATA: Contacts (clients)
-- =====================================================

INSERT INTO contacts (
  id,
  user_id,
  name,
  email,
  phone,
  company,
  address,
  city,
  state,
  zip_code,
  tags,
  notes
) VALUES
  -- Clients of Example Plumbing & Heating
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Demo Property Manager',
    'demo-3@example.invalid',
    '(408) 555-0171',
    'Example Property Management',
    '100 Example Street, Suite 100',
    'Example City',
    'CA',
    '00000',
    ARRAY['commercial', 'property-management'],
    'Synthetic property-management scenario; email preference and net-30 terms.'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Demo Homeowners',
    'demo-4@example.invalid',
    '(650) 555-0142',
    NULL,
    '200 Example Lane',
    'Example City',
    'CA',
    '00000',
    ARRAY['residential', 'repeat-client'],
    'Synthetic repeat-client scenario for a bathroom remodel.'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    'Demo Restaurant Owner',
    'demo-5@example.invalid',
    '(408) 555-0163',
    'Example Cafe',
    '300 Example Avenue',
    'Example City',
    'CA',
    '00000',
    ARRAY['commercial', 'restaurant'],
    'Synthetic restaurant build-out scenario for grease trap and floor sinks.'
  ),
  -- Clients of Example Electric
  (
    '10000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    'Demo Office Manager',
    'demo-6@example.invalid',
    '(510) 555-0189',
    'Example Dental',
    '400 Example Road',
    'Example City',
    'CA',
    '00000',
    ARRAY['commercial', 'new-client'],
    'New operatory build-out; needs dedicated circuits for chairs and sterilizer.'
  );

-- =====================================================
-- SEED DATA: Quotes
-- =====================================================
-- Status model: is_paid is the only status. Sending is tracked by
-- sent_at / email_sent_count / recipient_email.

INSERT INTO quotes (
  id,
  user_id,
  contact_id,
  quote_number,
  project_name,
  description,
  valid_until,
  tax_rate,
  terms_and_conditions,
  notes,
  sent_at,
  recipient_email,
  email_sent_count,
  last_email_sent_at,
  is_paid,
  paid_at
) VALUES
  -- Quote 1: sent, unpaid
  (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Q-2026-901',
    'Unit 4B Repipe — Example Properties',
    'Full copper repipe of unit 4B including water heater replacement and two toilet installs.',
    CURRENT_DATE + INTERVAL '30 days',
    9.125,
    'Payment terms: 50% deposit, balance on completion. Warranty: 1 year on all workmanship.',
    'Synthetic scheduling example for a vacant unit.',
    NOW() - INTERVAL '3 days',
    'demo-3@example.invalid',
    1,
    NOW() - INTERVAL '3 days',
    FALSE,
    NULL
  ),
  -- Quote 2: draft (never sent)
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'Q-2026-902',
    'Master Bath Rough-In — Example Residence',
    'Plumbing rough-in for master bathroom remodel: relocate shower drain, new supply lines, fixture set.',
    NULL,
    9.125,
    NULL,
    'Waiting on fixture selection before sending.',
    NULL,
    NULL,
    0,
    NULL,
    FALSE,
    NULL
  ),
  -- Quote 3: sent and paid
  -- is_paid/paid_at are FALSE/NULL here — the recalc_quote_payment_state
  -- trigger derives both from quote_payments once those rows are inserted
  -- below (after totals are computed).
  (
    '20000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000003',
    'Q-2026-903',
    'Grease Trap & Floor Sinks — Example Cafe',
    'Install 75-gallon grease interceptor and three floor sinks per county health code.',
    CURRENT_DATE + INTERVAL '15 days',
    9.375,
    'Payment due within 15 days of invoice.',
    NULL,
    NOW() - INTERVAL '10 days',
    'demo-5@example.invalid',
    2,
    NOW() - INTERVAL '8 days',
    FALSE,
    NULL
  ),
  -- Quote 4: sent, unpaid (second contractor)
  (
    '20000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000004',
    'Q-2026-904',
    'Operatory Circuits — Example Dental',
    'Panel upgrade to 200A plus six dedicated circuits for dental chairs, compressor, and sterilizer.',
    CURRENT_DATE + INTERVAL '45 days',
    10.25,
    'Payment terms: 30% deposit, balance on final inspection.',
    'Coordinate with GC on wall-close schedule.',
    NOW() - INTERVAL '1 day',
    'demo-6@example.invalid',
    1,
    NOW() - INTERVAL '1 day',
    FALSE,
    NULL
  );

-- =====================================================
-- SEED DATA: Payment Milestones
-- =====================================================
-- Default 10/30/30/30 schedule (lib/payment-schedule.ts DEFAULT_SCHEDULE)
-- for all four seeded quotes. Amounts are derived from percentage of the
-- quote total at read time — nothing to compute here.

INSERT INTO payment_milestones (
  id,
  quote_id,
  user_id,
  name,
  percentage,
  sort_order
) VALUES
  -- Quote 1 (Q-2026-901)
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Deposit', 10, 0),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Before construction starts', 30, 1),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'During the work', 30, 2),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'On completion', 30, 3),
  -- Quote 2 (Q-2026-902)
  ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Deposit', 10, 0),
  ('60000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Before construction starts', 30, 1),
  ('60000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'During the work', 30, 2),
  ('60000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'On completion', 30, 3),
  -- Quote 3 (Q-2026-903) — referenced by the payments insert below
  ('60000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Deposit', 10, 0),
  ('60000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Before construction starts', 30, 1),
  ('60000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'During the work', 30, 2),
  ('60000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'On completion', 30, 3),
  -- Quote 4 (Q-2026-904, second contractor)
  ('60000000-0000-0000-0000-00000000000d', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'Deposit', 10, 0),
  ('60000000-0000-0000-0000-00000000000e', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'Before construction starts', 30, 1),
  ('60000000-0000-0000-0000-00000000000f', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'During the work', 30, 2),
  ('60000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'On completion', 30, 3);

-- =====================================================
-- SEED DATA: Quote Line Items
-- =====================================================
-- work_item_id links back to the contractor's catalog; NULL = ad-hoc line.

-- Line items for Quote 1 (Unit 4B Repipe)
INSERT INTO quote_line_items (
  quote_id,
  work_item_id,
  description,
  quantity,
  unit_price,
  total,
  unit_of_measure,
  category,
  sort_order
) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000004',
    'Copper repipe',
    140,
    18.50,
    2590.00,
    'lf',
    'plumbing',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    'Water heater replacement (50 gal)',
    1,
    1850.00,
    1850.00,
    'each',
    'plumbing',
    2
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000002',
    'Toilet install',
    2,
    375.00,
    750.00,
    'each',
    'plumbing',
    3
  ),
  (
    '20000000-0000-0000-0000-000000000001',
    NULL,
    'Drywall patch and paint after repipe',
    1,
    1200.00,
    1200.00,
    'job',
    'general',
    4
  );

-- Line items for Quote 2 (Master Bath Rough-In)
INSERT INTO quote_line_items (
  quote_id,
  work_item_id,
  description,
  quantity,
  unit_price,
  total,
  unit_of_measure,
  category,
  sort_order
) VALUES
  (
    '20000000-0000-0000-0000-000000000002',
    NULL,
    'Relocate shower drain and trap',
    1,
    1450.00,
    1450.00,
    'job',
    'plumbing',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '40000000-0000-0000-0000-000000000004',
    'Copper repipe',
    60,
    18.50,
    1110.00,
    'lf',
    'plumbing',
    2
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    NULL,
    'Set fixtures (customer-supplied)',
    6,
    145.00,
    870.00,
    'hours',
    'plumbing',
    3
  );

-- Line items for Quote 3 (Grease Trap & Floor Sinks)
INSERT INTO quote_line_items (
  quote_id,
  work_item_id,
  description,
  quantity,
  unit_price,
  total,
  unit_of_measure,
  category,
  sort_order
) VALUES
  (
    '20000000-0000-0000-0000-000000000003',
    NULL,
    '75-gallon grease interceptor, installed',
    1,
    4800.00,
    4800.00,
    'each',
    'plumbing',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    NULL,
    'Floor sink with trap and vent',
    3,
    650.00,
    1950.00,
    'each',
    'plumbing',
    2
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    '40000000-0000-0000-0000-000000000005',
    'Service call / diagnostics',
    2,
    145.00,
    290.00,
    'hours',
    'plumbing',
    3
  );

-- Line items for Quote 4 (Operatory Circuits)
INSERT INTO quote_line_items (
  quote_id,
  work_item_id,
  description,
  quantity,
  unit_price,
  total,
  unit_of_measure,
  category,
  sort_order
) VALUES
  (
    '20000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000006',
    'Panel upgrade (200A)',
    1,
    3200.00,
    3200.00,
    'each',
    'electrical',
    1
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    NULL,
    'Dedicated 20A circuit for dental equipment',
    6,
    425.00,
    2550.00,
    'each',
    'electrical',
    2
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000007',
    'Recessed light install',
    8,
    185.00,
    1480.00,
    'each',
    'electrical',
    3
  );

-- =====================================================
-- Update quote totals based on line items
-- =====================================================
-- Note: This happens automatically via triggers,
-- but we're forcing it here to ensure consistency in seed data

UPDATE quotes q
SET
  subtotal = (
    SELECT COALESCE(SUM(total), 0)
    FROM quote_line_items
    WHERE quote_id = q.id
  ),
  tax_amount = (
    SELECT COALESCE(SUM(total), 0) * (q.tax_rate / 100)
    FROM quote_line_items
    WHERE quote_id = q.id
  ),
  total = (
    SELECT COALESCE(SUM(total), 0) * (1 + q.tax_rate / 100)
    FROM quote_line_items
    WHERE quote_id = q.id
  );

-- =====================================================
-- SEED DATA: Recorded Payments
-- =====================================================
-- Two payments against Quote 3's schedule (deposit + closing) that
-- together cover the full total. Must run after the totals UPDATE above
-- so the recalc_quote_payment_state trigger derives is_paid/paid_at
-- correctly (amount_paid >= total). Amounts reference milestones
-- 60000000-…-0009 (Deposit) and …-000c (On completion, standing in as
-- the closing payment) created for Quote 3 above.

INSERT INTO quote_payments (
  id,
  quote_id,
  milestone_id,
  user_id,
  amount,
  paid_at,
  method,
  note,
  created_at
) VALUES
  -- Deposit: 10% of quote 3's total
  (
    '70000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000009',
    '00000000-0000-0000-0000-000000000001',
    (SELECT ROUND(total * 0.10, 2) FROM quotes WHERE id = '20000000-0000-0000-0000-000000000003'),
    CURRENT_DATE - INTERVAL '9 days',
    'check',
    'Deposit — check #2179',
    NOW() - INTERVAL '9 days'
  ),
  -- Closing payment: remainder of the total
  (
    '70000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-00000000000c',
    '00000000-0000-0000-0000-000000000001',
    (SELECT total - ROUND(total * 0.10, 2) FROM quotes WHERE id = '20000000-0000-0000-0000-000000000003'),
    CURRENT_DATE - INTERVAL '6 days',
    'check',
    'Paid by check #2183',
    NOW() - INTERVAL '6 days'
  );

-- =====================================================
-- SEED COMPLETE
-- =====================================================
-- Summary:
--   Users: 2 (Example Plumbing & Heating, Example Electric)
--   Work Items: 8
--   Contacts: 4
--   Quotes: 4 (1 draft, 2 sent/unpaid, 1 sent/paid)
--   Quote Line Items: 13
--   Payment Milestones: 16 (default 10/30/30/30 schedule × 4 quotes)
--   Quote Payments: 2 (deposit + closing on Quote 3, sum = total)
-- =====================================================
