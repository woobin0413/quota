"""Regression tests against an isolated, network-disabled PostgreSQL container.
Run: python3 scripts/security-db.test.py github-publication-postgres-dgm1um
No cloud database URL or application environment is loaded.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse, json, subprocess, uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('container', help='Existing PostgreSQL container launched with --network none; synthetic data only')
container = parser.parse_args().container
config = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert config['HostConfig']['NetworkMode'] == 'none', 'An isolated container is required'
database = 'publication_test_' + uuid.uuid4().hex[:12]
def sql(statement, fail=False, db=None):
    proc = subprocess.run(['docker','exec','-i',container,'psql','-U','postgres','-d',db or database,'-v','ON_ERROR_STOP=1','-Atq'], input=statement, text=True, capture_output=True)
    if fail:
        assert proc.returncode != 0, 'Expected SQL rejection'
    elif proc.returncode:
        raise RuntimeError(proc.stderr)
    return proc.stdout.strip()
sql('CREATE DATABASE '+database, db='postgres')
sql("""DO $$ BEGIN
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text);
""")
root = Path(__file__).resolve().parents[1]
for migration in sorted((root/'supabase/migrations').glob('*.sql')):
    sql(migration.read_text())
uid='11111111-1111-4111-8111-111111111111'
sql(f"INSERT INTO users(id,auth0_user_id,email,subscription_tier,stripe_customer_id) VALUES ('{uid}','auth0|synthetic','fixture@example.invalid','free','cus_synthetic');")
def quote(user=uid, line='[{"description":"Synthetic line","quantity":1,"unitPrice":10}]'):
    return f"SELECT quota_exceeded FROM create_quote_atomic('{user}',NULL,'{{\"name\":\"Synthetic client\"}}','Synthetic quote',0,NULL,NULL,'{line}');"
for _ in range(2): assert sql(quote()) == 'f'
with ThreadPoolExecutor(max_workers=8) as executor:
    results=list(executor.map(lambda _:sql(quote()), range(8)))
assert results.count('f') == 1 and results.count('t') == 7, results
assert sql(f"SELECT count(*) FROM quotes WHERE user_id='{uid}'") == '3'
# Defensive null handling even if an older installation has not applied NOT NULL.
sql('ALTER TABLE users ALTER COLUMN subscription_tier DROP NOT NULL;')
sql(f"UPDATE users SET subscription_tier=NULL WHERE id='{uid}';")
assert sql(quote()) == 't'
# Dependent-write failure must roll back contact, quote and schedule together.
other='22222222-2222-4222-8222-222222222222'
sql(f"INSERT INTO users(id,auth0_user_id,email) VALUES ('{other}','auth0|synthetic2','other@example.invalid');")
sql(quote(other,'[{"description":"Synthetic line","quantity":"invalid","unitPrice":10}]'),fail=True)
assert sql(f"SELECT count(*) FROM contacts WHERE user_id='{other}'") == '0'
assert sql(f"SELECT count(*) FROM quotes WHERE user_id='{other}'") == '0'
# Shared budgets remain bounded under separate concurrent database sessions.
with ThreadPoolExecutor(max_workers=10) as executor:
    results=list(executor.map(lambda _:sql("SET ROLE service_role; SELECT consume_request_budget('"+'a'*64+"',3,60000)->>'allowed';"),range(10)))
assert results.count('true') == 3 and results.count('false') == 7, results
# Newer snapshots win even if an older request finishes last. Duplicates don't apply.
def billing(revision,tier,event):
    return f"SET ROLE service_role; SELECT apply_billing_state('{uid}','cus_synthetic',{revision},'{tier}','active',false,NULL,'{event}');"
assert sql(billing(0,'ultimate','evt_new')) == 'applied'
assert sql(billing(0,'free','evt_old')) == 'conflict'
assert sql(billing(1,'free','evt_new')) == 'duplicate'
assert sql(f"SELECT subscription_tier FROM users WHERE id='{uid}'") == 'ultimate'
sql("SET ROLE anon; SELECT consume_request_budget('"+'a'*64+"',3,60000);",fail=True)
sql(f"SET ROLE authenticated; SELECT apply_billing_state('{uid}','cus_synthetic',999,'ultimate','active',false,NULL,NULL);",fail=True)
print('Passed: full migrations, final-slot concurrency, nullable-tier gate, rollback, shared budget concurrency, billing ordering/deduplication and RPC permissions.')
sql('DROP DATABASE '+database, db='postgres')
