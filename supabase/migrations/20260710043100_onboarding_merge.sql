-- Atomic, merge-safe onboarding writes.
--
-- The onboarding jsonb (user_settings.onboarding) is written from several
-- independent places (tour completion, checklist facts, welcome flow, the
-- "seen marker" seed). The old client did a read-modify-write of the WHOLE blob
-- from a possibly-stale in-memory copy, so concurrent writers clobbered each
-- other's keys — which is why completedTours never survived. This RPC merges a
-- partial patch server-side against the current row so a writer only ever
-- touches the keys it owns: scalars overwrite, `checklist` shallow-merges, and
-- `completedTours`/`dismissedTours` union (dedup) — never dropping existing ids.

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
