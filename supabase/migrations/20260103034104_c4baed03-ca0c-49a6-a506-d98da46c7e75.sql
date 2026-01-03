-- Enable required extensions for cron jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule daily check for overdue invoices at 6:00 AM UTC
SELECT cron.schedule(
  'check-overdue-invoices-daily',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qybuufofocxsctwnpwon.supabase.co/functions/v1/check-overdue-invoices',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5YnV1Zm9mb2N4c2N0d25wd29uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0MTI2ODIsImV4cCI6MjA3ODk4ODY4Mn0.zCKj6fLRAGEiyg8gpyHah01VxCW3R12i_hbK-5yUCgc"}'::jsonb,
    body := '{"trigger": "cron"}'::jsonb
  ) AS request_id;
  $$
);