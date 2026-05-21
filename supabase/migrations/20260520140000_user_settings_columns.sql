-- Ensure user_settings has every column the app writes/reads.
-- Idempotent — safe to run repeatedly. Required because the table was
-- originally created out-of-band (no prior CREATE TABLE migration) and
-- newer columns (e.g. default_entry_mode) drifted from the schema.

alter table public.user_settings
  add column if not exists user_id uuid,
  add column if not exists name text,
  add column if not exists default_start text,
  add column if not exists default_end text,
  add column if not exists default_template_id uuid,
  add column if not exists hourly_rate numeric not null default 0,
  add column if not exists deepseek_key text,
  add column if not exists reminder_time text,
  add column if not exists time_rounding text not null default 'none',
  add column if not exists daily_target numeric not null default 0,
  add column if not exists weekly_target numeric not null default 0,
  add column if not exists default_entry_mode text not null default 'manual',
  add column if not exists active_clock jsonb,
  add column if not exists google_access_token text,
  add column if not exists google_token_expiry bigint,
  add column if not exists updated_at timestamptz not null default now();

-- onConflict("user_id") in the client requires a unique constraint on user_id.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and contype = 'u'
      and conname = 'user_settings_user_id_key'
  ) then
    alter table public.user_settings
      add constraint user_settings_user_id_key unique (user_id);
  end if;
end $$;

-- Force PostgREST to reload its schema cache so PGRST204 ("column not found")
-- clears immediately after this migration runs.
notify pgrst, 'reload schema';
