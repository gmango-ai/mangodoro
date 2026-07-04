-- Fix: set_channel_meta rejected open + room channels ("not a channel"), so
-- announcement toggles (post_policy) / title / topic couldn't be saved on them.
--
-- The original selected `team_id, org_team_id into v_org, v_team` and then
-- guarded `if v_team is null` — but v_team held org_team_id, which is NULL for
-- open ('org') and room channels. Guard on team_id instead (always set for a
-- channel), and only run the org_team-lead check when there IS an org_team.

create or replace function public.set_channel_meta(
  p_conversation_id uuid,
  p_title text default null,
  p_topic text default null,
  p_post_policy text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_team uuid; v_org_team uuid;
begin
  select team_id, org_team_id into v_team, v_org_team
    from public.conversations where id = p_conversation_id and kind = 'channel';
  if v_team is null then raise exception 'not a channel'; end if;
  if not public.is_org_admin(v_team)
     and not (v_org_team is not null and exists (
       select 1 from public.org_team_members
        where org_team_id = v_org_team and user_id = auth.uid() and role = 'lead')) then
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
