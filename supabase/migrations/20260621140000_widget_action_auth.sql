-- Lets the home-screen widget START a personal timer without opening the app,
-- and lets the server push-to-start a Live Activity.
--   widget_secret_hash : SHA256 of a per-user "widget action" secret. The app
--     mints the raw secret, stashes it in the App Group, and registers the hash
--     here; the widget-start edge fn validates the secret against this hash
--     (same trust model as pomodoro_activity_tokens.secret_hash, but per device
--     rather than per activity). No user JWT lives natively, so this is how the
--     widget authenticates as the user.
--   pts_token : ActivityKit push-to-start token (iOS 17.2+). Lets the server
--     CREATE a Live Activity (not just update one) when a timer starts on the
--     web or from the widget while the app is backgrounded.
alter table public.device_push_tokens
  add column if not exists widget_secret_hash text,
  add column if not exists pts_token text;

-- The widget secret / pts token can register before APNs has handed over the
-- device token, so a row may exist without a push_token. Allow it.
alter table public.device_push_tokens
  alter column push_token drop not null;
