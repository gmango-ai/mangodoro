-- Messaging v2 — Phase 8: per-conversation pin & mute.
--
-- pinned_at/muted_at on the participant row (dm/group) and on channel_read_state
-- (channels, column added in Phase 2). list_my_conversations now surfaces both so
-- the client can sort pinned-first and drop the unread dot for muted convos; the
-- notify trigger skips muted recipients so a muted conversation is silent.

alter table public.conversation_participants
  add column if not exists pinned_at timestamptz,
  add column if not exists muted_at  timestamptz;

-- Return shape changes (adds pinned_at, muted_at) → drop + recreate.
drop function if exists public.list_my_conversations();
create function public.list_my_conversations()
returns table (
  id uuid,
  kind text,
  title text,
  last_message_at timestamptz,
  last_read_at timestamptz,
  participant_ids uuid[],
  org_team_id uuid,
  org_team_color text,
  org_ids uuid[],
  pinned_at timestamptz,
  muted_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  with me as (select auth.uid() as uid),
  dm_acc as (
    select cp.conversation_id as cid, cp.last_read_at, cp.pinned_at, cp.muted_at
      from public.conversation_participants cp, me
     where cp.user_id = me.uid
  ),
  parts as (
    select cp.conversation_id as cid, cp.user_id
      from public.conversation_participants cp
     where cp.conversation_id in (select cid from dm_acc)
  ),
  sizes as (select cid, count(*) as n from parts group by cid),
  org_hits as (
    select p.cid, tm.team_id, count(distinct p.user_id) as hits
      from parts p join public.team_members tm on tm.user_id = p.user_id
     group by p.cid, tm.team_id
  ),
  scoped as (
    select oh.cid, array_agg(oh.team_id) as org_ids
      from org_hits oh join sizes s on s.cid = oh.cid
     where oh.hits = s.n group by oh.cid
  ),
  others as (
    select p.cid, array_agg(p.user_id) as participant_ids
      from parts p, me where p.user_id <> me.uid group by p.cid
  ),
  chan_acc as (
    select c.id as cid, c.org_team_id, c.team_id as org_id, ot.color as org_team_color,
           crs.last_read_at, crs.muted_at
      from public.conversations c
      join public.org_team_members otm on otm.org_team_id = c.org_team_id
      join public.org_teams ot on ot.id = c.org_team_id
      left join public.channel_read_state crs on crs.conversation_id = c.id and crs.user_id = (select uid from me)
     where c.kind = 'channel' and otm.user_id = (select uid from me)
  )
  select
    c.id, c.kind, c.title, c.last_message_at, a.last_read_at,
    coalesce(o.participant_ids, '{}'::uuid[]),
    null::uuid, null::text,
    coalesce(s.org_ids, '{}'::uuid[]),
    a.pinned_at, a.muted_at
  from dm_acc a
  join public.conversations c on c.id = a.cid
  left join others o on o.cid = a.cid
  left join scoped s on s.cid = a.cid
  union all
  select
    c.id, c.kind, c.title, c.last_message_at, ca.last_read_at,
    '{}'::uuid[],
    ca.org_team_id, ca.org_team_color,
    array[ca.org_id],
    null::timestamptz, ca.muted_at
  from chan_acc ca
  join public.conversations c on c.id = ca.cid
  order by 4 desc nulls last;
$$;
grant execute on function public.list_my_conversations() to authenticated;

-- Skip muted recipients on send.
create or replace function public.tg_dm_message_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rec record; sender_name text; conv record;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  select * into conv from public.conversations where id = new.conversation_id;
  select coalesce(nullif(btrim(us.name), ''), 'Someone') into sender_name
    from public.user_settings us where us.user_id = new.sender_id;

  if conv.kind = 'channel' then
    for rec in
      select otm.user_id
        from public.org_team_members otm
       where otm.org_team_id = conv.org_team_id and otm.user_id <> new.sender_id
         and not exists (
           select 1 from public.channel_read_state crs
            where crs.conversation_id = conv.id and crs.user_id = otm.user_id and crs.muted_at is not null
         )
    loop
      perform public.emit_notification(
        rec.user_id, 'channel',
        sender_name || ' in #' || coalesce(conv.title, 'a channel'),
        left(new.body, 140),
        jsonb_build_object('conversation_id', new.conversation_id, 'route', '/messages'),
        new.sender_id, conv.team_id, 'conversation', new.conversation_id,
        'channel:' || conv.id, 5
      );
    end loop;
    return new;
  end if;

  for rec in
    select cp.user_id from public.conversation_participants cp
     where cp.conversation_id = new.conversation_id and cp.user_id <> new.sender_id
       and cp.muted_at is null
  loop
    perform public.emit_notification(
      rec.user_id, 'dm',
      case when conv.is_group then sender_name || ' in ' || coalesce(conv.title, 'a group')
           else sender_name end,
      left(new.body, 140),
      jsonb_build_object('conversation_id', new.conversation_id, 'route', '/messages'),
      new.sender_id
    );
  end loop;
  return new;
end; $$;

notify pgrst, 'reload schema';
