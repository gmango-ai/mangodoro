-- Public-readable preview for the /team/join/:code landing page.
-- Returns enough team branding (name, icon, color, member count) for the
-- receiver to see what they're about to join before signing in. Safe to call
-- unauthenticated; intentionally omits anything sensitive.

create or replace function public.get_team_invite_preview(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_count int;
begin
  select * into v_team
    from public.teams
    where invite_code = lower(p_code);

  if not found then
    return json_build_object('error', 'Invalid invite code');
  end if;

  select count(*) into v_count
    from public.team_members
    where team_id = v_team.id;

  return json_build_object(
    'name', v_team.name,
    'icon_url', v_team.icon_url,
    'color', v_team.color,
    'member_count', v_count
  );
end;
$$;

grant execute on function public.get_team_invite_preview(text) to anon, authenticated;

notify pgrst, 'reload schema';
