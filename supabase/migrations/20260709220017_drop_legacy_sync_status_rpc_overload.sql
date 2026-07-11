-- Drop the legacy 2-arg overload of set_sync_participant_status(uuid, text).
--
-- Recovered into the repo during a migration-history repair: this migration was
-- applied directly to the shared DB (via MCP apply_migration) but its file was
-- never committed to this branch. Reconstructed verbatim from the recorded
-- statement in supabase_migrations.schema_migrations (version 20260709220017) so
-- local history matches the remote. Part of the status-system rewrite that moved
-- participant status onto user_presence; the old overload is unused.

drop function if exists public.set_sync_participant_status(uuid, text);
