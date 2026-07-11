-- Meetings — Phase 1b: transcripts + summaries + the doc-export stamp RPC.
--
-- Both tables hang off meeting_recordings (one each per recording). Written by
-- the process-recording pipeline (service role); members of the recording's team
-- can read. The Google-Doc export is a client-side foreground action, so it
-- stamps its result through a narrow SECURITY DEFINER RPC rather than a broad
-- client UPDATE grant.

create table public.meeting_transcripts (
  id           uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.meeting_recordings(id) on delete cascade,
  language     text,
  full_text    text not null default '',
  -- [{ chunk_index, start, end, text }] — one entry per Whisper segment/chunk,
  -- so long meetings recorded as multiple audio segments concatenate in order.
  segments     jsonb not null default '[]'::jsonb,
  provider     text not null default 'whisper',
  created_at   timestamptz not null default now()
);
create unique index meeting_transcripts_one_per_recording
  on public.meeting_transcripts (recording_id);

create table public.meeting_summaries (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid not null references public.meeting_recordings(id) on delete cascade,
  summary_md    text not null default '',
  key_points    jsonb not null default '[]'::jsonb,   -- ["...", "..."]
  action_items  jsonb not null default '[]'::jsonb,   -- [{ text, assignee? }]
  model         text not null default 'deepseek-chat',
  -- Google Docs export (stamped by record_doc_export after a foreground create):
  exported_doc_id  text,
  exported_doc_url text,
  exported_by      uuid references auth.users(id) on delete set null,
  exported_at      timestamptz,
  created_at    timestamptz not null default now()
);
create unique index meeting_summaries_one_per_recording
  on public.meeting_summaries (recording_id);

alter table public.meeting_transcripts enable row level security;
alter table public.meeting_summaries  enable row level security;

create policy "meeting_transcripts: team reads"
  on public.meeting_transcripts for select
  using (exists (
    select 1 from public.meeting_recordings r
     where r.id = recording_id and public.is_team_member(r.team_id)
  ));

create policy "meeting_summaries: team reads"
  on public.meeting_summaries for select
  using (exists (
    select 1 from public.meeting_recordings r
     where r.id = recording_id and public.is_team_member(r.team_id)
  ));

-- Record a Google-Doc export against a summary. Any team member who exported the
-- doc (foreground, into their own Drive) can stamp the link. SECURITY DEFINER so
-- we don't have to open a general UPDATE grant on meeting_summaries.
create or replace function public.record_doc_export(
  p_recording_id uuid,
  p_doc_id text,
  p_doc_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  select r.team_id into v_team
    from public.meeting_recordings r
   where r.id = p_recording_id;
  if v_team is null then
    raise exception 'recording not found';
  end if;
  if not public.is_team_member(v_team) then
    raise exception 'not a team member';
  end if;
  update public.meeting_summaries
     set exported_doc_id  = p_doc_id,
         exported_doc_url = p_doc_url,
         exported_by      = auth.uid(),
         exported_at      = now()
   where recording_id = p_recording_id;
end;
$$;

grant execute on function public.record_doc_export(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
