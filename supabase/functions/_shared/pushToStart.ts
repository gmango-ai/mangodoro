// Shared cross-device push helpers used by activity-push (web/desktop state
// changes) and widget-start (home-widget "Start" tap):
//   - maybePushToStart: CREATE a Live Activity via the registered push-to-start
//     token when one isn't already running (iOS 17.2+).
//   - refreshDeviceWidgets: silent background push to every device so its
//     home-screen widget merges the latest state + reloads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendLiveActivityStartPush, sendBackgroundPush } from "./apns.ts";

type Admin = ReturnType<typeof createClient>;

// Matches PomodoroActivityAttributes in the iOS app: the type name the OS uses
// to instantiate the activity, and its (non-state) attributes payload.
const ATTRIBUTES_TYPE = "PomodoroActivityAttributes";
const ATTRIBUTES = { appName: "Mangodoro" };

export function labelForMode(mode: string): string {
  switch (mode) {
    case "work": return "Focus";
    case "shortBreak": return "Short break";
    case "longBreak": return "Long break";
    default: return "Pomodoro";
  }
}

// Create a Live Activity on the user's device via push-to-start when one isn't
// already running. Best-effort; no-op if no pts token is registered (e.g. iOS
// < 17.2, or the app hasn't registered one yet).
export async function maybePushToStart(
  admin: Admin,
  userId: string,
  contentState: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin
    .from("device_push_tokens")
    .select("pts_token, apns_env")
    .eq("user_id", userId)
    .not("pts_token", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("pts token lookup failed", error);
    return false;
  }
  const ptsToken = data?.pts_token as string | undefined;
  if (!ptsToken) return false;

  const endsAtMs = typeof contentState.endsAtEpochMs === "number" ? contentState.endsAtEpochMs : 0;
  const staleDate = endsAtMs > 0
    ? Math.floor(endsAtMs / 1000) + 60
    : Math.floor(Date.now() / 1000) + 3600;

  const res = await sendLiveActivityStartPush({
    pushToken: ptsToken,
    apnsEnv: (data?.apns_env as "production" | "sandbox") ?? "production",
    attributesType: ATTRIBUTES_TYPE,
    attributes: ATTRIBUTES,
    contentState,
    staleDate,
  });
  if (!res.ok) console.error("push-to-start failed", res.status, res.body);
  return res.ok;
}

// Silent background push to every registered device so the home-screen widget
// merges the new state + reloads (the App Group can't be written server-side).
export async function refreshDeviceWidgets(
  admin: Admin,
  userId: string,
  state: Record<string, unknown>,
): Promise<number> {
  const { data: devices, error } = await admin
    .from("device_push_tokens")
    .select("push_token, apns_env")
    .eq("user_id", userId)
    .not("push_token", "is", null);
  if (error) {
    console.error("device token lookup failed", error);
    return 0;
  }
  let n = 0;
  for (const d of devices ?? []) {
    const res = await sendBackgroundPush({
      pushToken: d.push_token as string,
      apnsEnv: d.apns_env as "production" | "sandbox",
      payload: { kind: "pomodoro-state", ...state },
    });
    if (res.ok) n++;
    else console.error("background push failed", res.status, res.body);
  }
  return n;
}
