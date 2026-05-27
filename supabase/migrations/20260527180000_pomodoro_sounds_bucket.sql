-- Custom pomodoro alarm sounds.
--
-- Each user can upload one custom audio file to use as their alarm. The
-- file lives in a public 'pomodoro-sounds' bucket under their own
-- user_id prefix; the resulting URL is mirrored to user_settings so it
-- syncs across the user's devices.

alter table public.user_settings
  add column if not exists pomodoro_sound_url text,
  add column if not exists pomodoro_sound_name text;

-- Storage bucket (idempotent).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'pomodoro-sounds',
    'pomodoro-sounds',
    true,
    5242880, -- 5 MB
    array[
      'audio/mpeg', 'audio/mp3',
      'audio/wav', 'audio/x-wav', 'audio/wave',
      'audio/ogg',
      'audio/webm',
      'audio/mp4', 'audio/aac',
      'audio/flac'
    ]
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS — anyone can read (public bucket); users may write only under their own
-- user_id prefix.

drop policy if exists "pomodoro-sounds: public read" on storage.objects;
create policy "pomodoro-sounds: public read"
  on storage.objects for select
  using (bucket_id = 'pomodoro-sounds');

drop policy if exists "pomodoro-sounds: users write own" on storage.objects;
create policy "pomodoro-sounds: users write own"
  on storage.objects for insert
  with check (
    bucket_id = 'pomodoro-sounds'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "pomodoro-sounds: users update own" on storage.objects;
create policy "pomodoro-sounds: users update own"
  on storage.objects for update
  using (
    bucket_id = 'pomodoro-sounds'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "pomodoro-sounds: users delete own" on storage.objects;
create policy "pomodoro-sounds: users delete own"
  on storage.objects for delete
  using (
    bucket_id = 'pomodoro-sounds'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

notify pgrst, 'reload schema';
