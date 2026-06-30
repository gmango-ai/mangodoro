-- Messaging v2 — Phase 1: durable, org-scoped conversation list.
--
-- The DM/group inbox was scoped by participation only (RLS), so every org's
-- conversations piled into one list and switching orgs left other-org DMs
-- visible with "Member" name fallbacks. We stop trusting conversations.team_id
-- (the group RPC set it from an arbitrary membership) and instead COMPUTE an
-- org scope per conversation: a dm/group belongs to an org iff EVERY participant
-- is a member of that org. A DM between two people who share two orgs therefore
-- shows in both inboxes.
--
-- This migration:
--   - adds conversations.kind ('dm' | 'group' | 'channel'); keeps is_group in
--     lockstep (the live client still reads is_group — do NOT drop it yet),
--   - teaches the two creation RPCs to set kind alongside is_group,
--   - adds list_my_conversations(): one round-trip returning each accessible
--     conversation with its computed org_ids. PHASE 1 HANDLES dm/group ONLY —
--     channels (and org_team_id) arrive in Phase 2, which create-or-replaces
--     this function to add the channel branch.

-- ── kind column (keep is_group for the live bundle) ──────────────
alter table public.conversations
  add column if not exists kind text not null default 'dm'
  check (kind in ('dm', 'group', 'channel'));

-- Backfill existing groups; dms already default to 'dm'.
update public.conversations set kind = 'group' where is_group = true and kind <> 'group';

-- ── creation RPCs now set kind (and still write is_group) ────────
-- Based on the a.team_id-qualified body from 20260628140000 (the original in
-- 20260627140000 raised 42702 on the ambiguous team_id). Body otherwise
-- identical, plus `kind => 'dm'`.
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
  insert into public.conversations (team_id, is_group, kind, created_by)
    values (tid, false, 'dm', me) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id) values (cid, me), (cid, p_other);
  return cid;
end; $$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

create or replace function public.create_group_conversation(p_title text, p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); cid uuid; tid uuid; u uuid;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then raise exception 'no participants'; end if;
  foreach u in array p_user_ids loop
    if u <> me and not public.shares_team_with(u) then raise exception 'not a teammate'; end if;
  end loop;
  select team_id into tid from public.team_members where user_id = me limit 1;
  insert into public.conversations (team_id, is_group, kind, title, created_by)
    values (tid, true, 'group', nullif(btrim(coalesce(p_title, '')), ''), me) returning id into cid;
  insert into public.conversation_participants (conversation_id, user_id)
    select cid, x from (select unnest(p_user_ids) as x union select me) s
    on conflict do nothing;
  return cid;
end; $$;
grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

-- ── list_my_conversations() — computed org scope (dm/group only) ──
-- Returns, per conversation I participate in:
--   participant_ids = the OTHER participants (excludes me — matches the client),
--   org_ids         = orgs in which EVERY participant is a member (intersection),
--   org_team_id/color = NULL here (channels land in Phase 2).
-- SECURITY DEFINER so the intersection can read team_members across participants.
create or replace function public.list_my_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  participant_ids uuid[],
  org_team_id uuid,
  org_team_color text,
  org_ids uuid[]
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  acc as (   -- conversations I'm a participant of (+ my read cursor)
    select cp.conversation_id as cid, cp.last_read_at
      from public.conversation_participants cp, me
     where cp.user_id = me.uid
  ),
  parts as ( -- every participant of those conversations
    select cp.conversation_id as cid, cp.user_id
      from public.conversation_participants cp
     where cp.conversation_id in (select cid from acc)
  ),
  sizes as ( -- roster size per conversation
    select cid, count(*) as n from parts group by cid
  ),
  org_hits as ( -- per (conversation, org): how many participants are members
    select p.cid, tm.team_id, count(distinct p.user_id) as hits
      from parts p
      join public.team_members tm on tm.user_id = p.user_id
     group by p.cid, tm.team_id
  ),
  scoped as ( -- orgs where every participant is a member
    select oh.cid, array_agg(oh.team_id) as org_ids
      from org_hits oh
      join sizes s on s.cid = oh.cid
     where oh.hits = s.n
     group by oh.cid
  ),
  others as ( -- participants excluding me
    select p.cid, array_agg(p.user_id) as participant_ids
      from parts p, me
     where p.user_id <> me.uid
     group by p.cid
  )
  select
    c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]),
    null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[])
  from acc a
  join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid
  left join scoped s on s.cid = a.cid
  order by c.last_message_at desc;
$$;
grant execute on function public.list_my_conversations() to authenticated;

notify pgrst, 'reload schema';
