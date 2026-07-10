-- Add a `hintsDisabled` scalar to the merge-safe onboarding writer.
--
-- Lets a user turn OFF the proactive onboarding hints (welcome modal, "take a
-- tour?" offers + new-feature announcements, getting-started checklist) without
-- touching any other onboarding key. Same merge contract as the rest: it's a
-- scalar, so it simply overwrites. Recreates onboarding_merge with the extra
-- line (see 20260710150000_onboarding_merge for the original).

create or replace function public.onboarding_merge(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cur jsonb;
  result jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select coalesce(onboarding, '{}'::jsonb) into cur from public.user_settings where user_id = uid;
  result := coalesce(cur, '{}'::jsonb);

  if p ? 'welcomeDone'    then result := result || jsonb_build_object('welcomeDone', p->'welcomeDone'); end if;
  if p ? 'seenTourMarker' then result := result || jsonb_build_object('seenTourMarker', p->'seenTourMarker'); end if;
  if p ? 'hintsDisabled'  then result := result || jsonb_build_object('hintsDisabled', p->'hintsDisabled'); end if;

  if p ? 'checklist' then
    result := result || jsonb_build_object('checklist',
      coalesce(result->'checklist', '{}'::jsonb) || (p->'checklist'));
  end if;

  if p ? 'completedTours' then
    result := result || jsonb_build_object('completedTours', (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
      from jsonb_array_elements(coalesce(result->'completedTours', '[]'::jsonb) || (p->'completedTours')) e));
  end if;
  if p ? 'dismissedTours' then
    result := result || jsonb_build_object('dismissedTours', (
      select coalesce(jsonb_agg(distinct e), '[]'::jsonb)
      from jsonb_array_elements(coalesce(result->'dismissedTours', '[]'::jsonb) || (p->'dismissedTours')) e));
  end if;

  update public.user_settings set onboarding = result where user_id = uid;
  return result;
end $$;

grant execute on function public.onboarding_merge(jsonb) to authenticated;

notify pgrst, 'reload schema';
