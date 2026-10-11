-- Rollback 007: remove logos bucket and its read policy
DROP POLICY IF EXISTS "Public read logos" ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id = 'logos';
DELETE FROM storage.buckets WHERE id = 'logos';
