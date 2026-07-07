// native-push: send APNs ALERT pushes to a user's registered native devices
// (the iOS app), so notifications arrive even when the app is closed. The
// native counterpart to `web-push` — same webhook contract, different
// transport (APNs alert vs browser Push API). Web push can't run inside the
// Capacitor WKWebView, so native devices need this path.
//
// Invoked by a Database Webhook on notification_deliveries INSERT (payload
// { record: <delivery> }) — or directly with { user_id, title, body, url? }.
// Only pushes deliveries carrying the 'desktop' channel that aren't 'held'
// (mirrors web-push so browser + native stay in lockstep).
//
// Secrets (supabase secrets set): the APNS_* set (shared with the Live Activity
// path — APNS_KEY_P8/KEY_ID/TEAM_ID/BUNDLE_ID/ENV) and a webhook secret —
// NATIVE_PUSH_WEBHOOK_SECRET, falling back to WEB_PUSH_WEBHOOK_SECRET so one
// secret can gate both push webhooks. Deploy with verify_jwt = false so the DB
// webhook can call it (no user JWT); the webhook MUST send the secret as an
// x-webhook-secret header, and the function fails closed if it's unset.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sendAlertPush } from "../_shared/apns.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET =
  Deno.env.get("NATIVE_PUSH_WEBHOOK_SECRET") || Deno.env.get("WEB_PUSH_WEBHOOK_SECRET") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// APNs statuses/reasons that mean "this token is dead" — prune it so we stop
// trying. The device re-registers a fresh token on next app launch (see
// initDeviceWidgetPush → device-register), so nulling push_token is safe.
function isDeadToken(status: number, reason: string | null): boolean {
  if (status === 410) return true; // Unregistered
  return reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // The webhook is the only caller (verify_jwt=false), so the shared secret
    // is the sole auth gate — FAIL CLOSED if it's unset, or anyone could POST
    // an alert to an arbitrary user_id.
    if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return json(401, { error: "unauthorized" });
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rec: any = (body as any).record || body;
    const userId = rec.recipient_user_id || rec.user_id;
    if (!userId) return json(400, { error: "no recipient" });

    if (rec.state === "held") return json(200, { skipped: "held" });
    const channels = rec.channels || ["desktop"];
    if (Array.isArray(channels) && !channels.includes("desktop")) {
      return json(200, { skipped: "no desktop channel" });
    }

    const p = rec.payload || {};
    const url = p.route || (p.room_id ? `/office/r/${p.room_id}` : "/");
    const title = rec.title || "Mangodoro";
    const bodyText = rec.body || "";
    const type = rec.type || undefined;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: tokens } = await admin
      .from("device_push_tokens")
      .select("id, push_token, apns_env")
      .eq("user_id", userId)
      .not("push_token", "is", null);

    let sent = 0;
    let removed = 0;
    let failed = 0;
    for (const t of tokens || []) {
      if (!t.push_token) continue;
      const res = await sendAlertPush({
        pushToken: t.push_token,
        title,
        body: bodyText,
        // Read from `userInfo` in the app's UNUserNotificationCenter delegate
        // so a tap can deep-link. `kind: "alert"` distinguishes this from the
        // silent "pomodoro-state" background push AppDelegate also handles.
        data: { url, type, kind: "alert" },
        apnsEnv: t.apns_env === "sandbox" ? "sandbox" : "production",
        threadId: type,
      });
      if (res.ok) {
        sent += 1;
        continue;
      }
      let reason: string | null = null;
      try { reason = JSON.parse(res.body)?.reason ?? null; } catch { /* non-JSON body */ }
      if (isDeadToken(res.status, reason)) {
        // Keep the row (it may hold pts_token / widget_secret_hash); just drop
        // the dead APNs token.
        await admin.from("device_push_tokens").update({ push_token: null }).eq("id", t.id);
        removed += 1;
      } else {
        failed += 1;
        console.warn("native-push apns error", res.status, res.body);
      }
    }
    return json(200, { sent, removed, failed });
  } catch (e: any) {
    return json(500, { error: String(e?.message || e) });
  }
});
