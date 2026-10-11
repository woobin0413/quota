-- 007: Business-logo storage bucket
-- Public READ (logos appear on invoices/emails); writes happen only
-- through the service-role API route — no anon/authenticated write policy.

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
CREATE POLICY "Public read logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');
