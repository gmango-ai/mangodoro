-- Team ownership (co-owners + transfer).
--
-- "Owner" is modeled as a boolean flag on top of the existing role,
-- not a new role value. That way every place that already checks
-- `role = 'admin'` keeps working — owners are always admins too. We
-- only need new server-side checks at the points where ownership
-- matters (granting/revoking owners, deleting the org, etc).
--
-- Multiple owners per team are allowed (co-owners). The "last owner"
-- can NOT demote themselves — they must transfer to someone else
-- first. This prevents orphaning a team with no owner.

alter table public.team_members
  add column if not exists is_owner boolean not null default false;

-- Backfill: every team's `created_by` user becomes the first owner.
-- Also force them to role='admin' so existing RLS keeps working —
-- in practice they already are admin (set by the create-team flow),
-- but the COALESCE keeps the migration idempotent.
update public.team_members tm
  set is_owner = true,
      role = 'admin'
  from public.teams t
  where tm.team_id = t.id
    and tm.user_id = t.created_by
    and coalesce(tm.is_owner, false) = false;

create index if not exists team_members_owner_idx
  on public.team_members (team_id) where is_owner = true;

-- ── RPCs ──────────────────────────────────────────────────────

-- grant_team_owner: promote an existing member to co-owner. Caller
-- must already be an owner. Target must be a member.
create or replace function public.grant_team_owner(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and is_owner = true
  ) then
    raise exception 'Only owners can grant ownership';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id
  ) then
    raise exception 'User is not a member of this team';
  end if;

  update public.team_members
    set is_owner = true,
        role = 'admin' -- owners are always admins
    where team_id = p_team_id and user_id = p_user_id;
end;
$$;

grant execute on function public.grant_team_owner(uuid, uuid) to authenticated;

-- revoke_team_owner: demote an owner back to plain admin. Caller
-- must be an owner. Last-owner guard prevents orphaning the team.
create or replace function public.revoke_team_owner(
  p_team_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_count integer;
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and is_owner = true
  ) then
    raise exception 'Only owners can revoke ownership';
  end if;

  select count(*) into v_owner_count
  from public.team_members
  where team_id = p_team_id and is_owner = true;

  if v_owner_count <= 1 then
    raise exception 'Cannot revoke the last owner — transfer ownership first';
  end if;

  update public.team_members
    set is_owner = false
    where team_id = p_team_id
      and user_id = p_user_id
      and is_owner = true;
end;
$$;

grant execute on function public.revoke_team_owner(uuid, uuid) to authenticated;

-- transfer_team_ownership: hand the team off in one step. Caller
-- (current owner) loses is_owner; target gains it. Caller keeps
-- their admin role. Disallows self-transfer.
create or replace function public.transfer_team_ownership(
  p_team_id uuid,
  p_new_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id
      and user_id = auth.uid()
      and is_owner = true
  ) then
    raise exception 'Only owners can transfer ownership';
  end if;

  if auth.uid() = p_new_owner_id then
    raise exception 'Cannot transfer to yourself';
  end if;

  if not exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_new_owner_id
  ) then
    raise exception 'User is not a member of this team';
  end if;

  update public.team_members
    set is_owner = true,
        role = 'admin'
    where team_id = p_team_id and user_id = p_new_owner_id;

  update public.team_members
    set is_owner = false
    where team_id = p_team_id and user_id = auth.uid();
end;
$$;

grant execute on function public.transfer_team_ownership(uuid, uuid) to authenticated;

-- Extend get_team_member_profiles to return is_owner. The members UI
-- in TeamPage reads the result to decide who shows the "owner" crown
-- and who can be granted/revoked.
create or replace function public.get_team_member_profiles(p_team_id uuid)
returns table (
  user_id uuid,
  name text,
  avatar_url text,
  status text,
  presence_state text,
  status_updated_at timestamptz,
  role text,
  is_owner boolean,
  joined_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    tm.user_id,
    coalesce(us.name, 'Team member')::text       as name,
    coalesce(us.avatar_url, '')::text            as avatar_url,
    coalesce(us.status, '')::text                as status,
    coalesce(us.presence_state, 'active')::text  as presence_state,
    us.status_updated_at,
    tm.role,
    coalesce(tm.is_owner, false)                 as is_owner,
    tm.joined_at
  from public.team_members tm
  left join public.user_settings us on us.user_id = tm.user_id
  where tm.team_id = p_team_id
    and exists (
      select 1
      from public.team_members tm2
      where tm2.team_id = p_team_id
        and tm2.user_id = auth.uid()
    )
  order by tm.joined_at asc;
$$;

grant execute on function public.get_team_member_profiles(uuid) to authenticated;

notify pgrst, 'reload schema';
