-- Synced widget preferences (order + pinned topbar strip).
--
-- Part of the universal-widgets work: the widget order and the pinned-strip set
-- move per-account so they follow the user across devices (laptop / desktop /
-- iOS), replacing the per-device localStorage `ql_widget_order`. Stored as one
-- jsonb blob (like `onboarding`) so adding a widget later is code-only.
-- Shape (all keys optional; defaults handled client-side):
--   {
--     "order":      string[],   -- sidebar/drawer widget order (sidebar ids)
--     "pinned":     string[],   -- widget ids pinned to the topbar strip
--     "disabled":   string[],   -- widget ids the user turned off
--     "drawerOpen": bool        -- last widget-drawer open/closed state
--   }
-- Own-row RLS from the base user_settings schema already covers read/update.
alter table public.user_settings
  add column if not exists widget_prefs jsonb not null default '{}'::jsonb;

-- Merge-safe partial write (mirrors onboarding_merge). Each provided key
-- overwrites; unprovided keys are preserved, so a writer touching only `order`
-- never clobbers `pinned`. Arrays are replace-semantics (the client owns the
-- whole list for a given action — reorder sends the full order, pin/unpin sends
-- the full set), so no union is needed. Only whitelisted keys are accepted.
create or replace function public.widget_prefs_merge(p jsonb)
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
  select coalesce(widget_prefs, '{}'::jsonb) into cur from public.user_settings where user_id = uid;
  result := coalesce(cur, '{}'::jsonb);

  if p ? 'order'      then result := result || jsonb_build_object('order', p->'order'); end if;
  if p ? 'pinned'     then result := result || jsonb_build_object('pinned', p->'pinned'); end if;
  if p ? 'disabled'   then result := result || jsonb_build_object('disabled', p->'disabled'); end if;
  if p ? 'drawerOpen' then result := result || jsonb_build_object('drawerOpen', p->'drawerOpen'); end if;

  update public.user_settings set widget_prefs = result where user_id = uid;
  return result;
end $$;

grant execute on function public.widget_prefs_merge(jsonb) to authenticated;

notify pgrst, 'reload schema';
