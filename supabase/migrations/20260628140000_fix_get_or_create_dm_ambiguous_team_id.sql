-- Fix: get_or_create_dm threw 42702 (ambiguous_column) on first DM creation.
--
-- The team-lookup self-joins team_members as a + b, then selected a bare
-- `team_id` — which exists on BOTH aliases, so Postgres couldn't resolve it and
-- raised "column reference \"team_id\" is ambiguous". Qualify it as a.team_id
-- (a.team_id = b.team_id by the join, so either is correct).
--
-- Forward migration: 20260627140000_messaging.sql is already applied on the
-- shared DB, so this re-creates the function with the qualified reference.
-- Body is otherwise identical to the original.

create or replace function public.get_or_create_dm(p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid; tid uuid;
begin
  if me is null or p_other is null or p_other = me then raise exception 'bad request'; end if;
  if not public.shares_team_with(p_other) then raise exception 'not a teammate'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(me::text, p_other::text) || greatest(me::text, p_other::text), 0));
  select c.id into cid
    from public.conversations c
    join public.conversation_participants p1 on p1.conversation_id = c.id and p1.user_id = me
    join public.conversation_participants p2 on p2.conversation_id = c.id and p2.user_id = p_other
   where c.is_group = false
     and (select count(*) from public.conversation_participants pp where pp.conversation_id = c.id) = 2
   limit 1;
  if cid is not null then return cid; end if;
  select a.team_id into tid from public.team_members a
    join public.team_members b on a.team_id = b.team_id
   where a.user_id = me and b.user_id = p_other limit 1;
  insert into public.conversations (team_id, is_group, created_by) values (tid, false, me) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id) values (cid, me), (cid, p_other);
  return cid;
end; $$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;
