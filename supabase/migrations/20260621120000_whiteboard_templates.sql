-- User-defined whiteboard templates. A template is just a saved snapshot
-- ({nodes, edges}) that "New whiteboard" can seed a fresh board from. Two
-- scopes:
--   • personal — visible only to its creator
--   • org      — visible to everyone on the team it was saved to
-- This replaces the hard-coded built-in templates (blank stays implicit: a
-- new board with no template is just an empty canvas).

create table if not exists public.whiteboard_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled template',
  scope text not null check (scope in ('personal', 'org')),
  -- The creator. Always set; drives personal-scope visibility + ownership.
  owner_id uuid not null references auth.users(id) on delete cascade,
  -- Set for org-scoped templates (the team they belong to); null for personal.
  team_id uuid references public.teams(id) on delete cascade,
  snapshot jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- org templates must name a team; personal ones must not.
  constraint whiteboard_templates_scope_team_check
    check (
      (scope = 'org' and team_id is not null)
      or (scope = 'personal' and team_id is null)
    )
);

create index if not exists whiteboard_templates_owner_idx
  on public.whiteboard_templates (owner_id, created_at desc);
create index if not exists whiteboard_templates_team_idx
  on public.whiteboard_templates (team_id, created_at desc);

-- ─── RLS ────────────────────────────────────────────────────────────
-- Reuse the security-definer helpers (get_my_team_ids / get_my_admin_team_ids)
-- so policies don't recurse through team_members.

alter table public.whiteboard_templates enable row level security;

-- Read: your own personal templates + org templates for any team you're on.
drop policy if exists "Read own + org whiteboard templates" on public.whiteboard_templates;
create policy "Read own + org whiteboard templates"
  on public.whiteboard_templates for select
  using (
    (scope = 'personal' and owner_id = auth.uid())
    or (scope = 'org' and team_id in (select public.get_my_team_ids()))
  );

-- Create: you must be the owner. Org templates must target a team you're on.
drop policy if exists "Create whiteboard templates" on public.whiteboard_templates;
create policy "Create whiteboard templates"
  on public.whiteboard_templates for insert
  with check (
    owner_id = auth.uid()
    and (
      (scope = 'personal' and team_id is null)
      or (scope = 'org' and team_id in (select public.get_my_team_ids()))
    )
  );

-- Update: the owner, or an admin of the org template's team.
drop policy if exists "Update whiteboard templates" on public.whiteboard_templates;
create policy "Update whiteboard templates"
  on public.whiteboard_templates for update
  using (
    owner_id = auth.uid()
    or (scope = 'org' and team_id in (select public.get_my_admin_team_ids()))
  )
  with check (
    owner_id = auth.uid()
    or (scope = 'org' and team_id in (select public.get_my_admin_team_ids()))
  );

-- Delete: the owner, or an admin of the org template's team.
drop policy if exists "Delete whiteboard templates" on public.whiteboard_templates;
create policy "Delete whiteboard templates"
  on public.whiteboard_templates for delete
  using (
    owner_id = auth.uid()
    or (scope = 'org' and team_id in (select public.get_my_admin_team_ids()))
  );

create or replace function public.tg_whiteboard_templates_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists tr_whiteboard_templates_touch on public.whiteboard_templates;
create trigger tr_whiteboard_templates_touch
  before update on public.whiteboard_templates
  for each row execute function public.tg_whiteboard_templates_touch();

notify pgrst, 'reload schema';
