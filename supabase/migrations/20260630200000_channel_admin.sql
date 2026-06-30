-- Messaging v2 — Phase 9: channel admin controls.
--
-- topic (description) and post_policy ('all' | 'admins'). An 'admins' channel is
-- an announcement channel: only org admins / org_team leads may post, while every
-- org_team member still reads. Editing meta is gated the same way channel
-- creation is.

alter table public.conversations
  add column if not exists topic text,
  add column if not exists post_policy text not null default 'all'
    check (post_policy in ('all', 'admins'));

-- Is the caller allowed to post in this conversation?
--  * non-channel conversations: same as access (participants).
--  * channel, post_policy 'all': any org_team member.
--  * channel, post_policy 'admins': org admin or org_team lead only.
create or replace function public.can_post_in_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with c as (select * from public.conversations where id = p_conversation_id)
  select case
    when (select kind from c) <> 'channel' then public.is_conversation_participant(p_conversation_id)
    when (select post_policy from c) = 'admins' then
      public.is_org_admin((select team_id from c))
      or exists (select 1 from public.org_team_members otm
                  where otm.org_team_id = (select org_team_id from c)
                    and otm.user_id = auth.uid() and otm.role = 'lead')
    else exists (select 1 from public.org_team_members otm
                  where otm.org_team_id = (select org_team_id from c) and otm.user_id = auth.uid())
  end;
$$;
grant execute on function public.can_post_in_conversation(uuid) to authenticated;

-- Fold the post gate into the dm_messages INSERT policy (replaces the Phase-2 one).
drop policy if exists "participant sends messages" on public.dm_messages;
create policy "participant sends messages" on public.dm_messages
  for insert with check (
    sender_id = auth.uid()
    and public.can_access_conversation(conversation_id)
    and public.can_post_in_conversation(conversation_id)
  );

-- Edit channel meta (title / topic / post_policy). Admin or lead of the org_team.
create or replace function public.set_channel_meta(
  p_conversation_id uuid,
  p_title text default null,
  p_topic text default null,
  p_post_policy text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_team uuid;
begin
  select team_id, org_team_id into v_org, v_team
    from public.conversations where id = p_conversation_id and kind = 'channel';
  if v_team is null then raise exception 'not a channel'; end if;
  if not public.is_org_admin(v_org)
     and not exists (select 1 from public.org_team_members
                      where org_team_id = v_team and user_id = auth.uid() and role = 'lead') then
    raise exception 'must be an org admin or team lead';
  end if;
  if p_post_policy is not null and p_post_policy not in ('all', 'admins') then
    raise exception 'bad post_policy';
  end if;
  update public.conversations set
    title       = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
    topic       = coalesce(p_topic, topic),
    post_policy = coalesce(p_post_policy, post_policy)
   where id = p_conversation_id;
end; $$;
grant execute on function public.set_channel_meta(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
