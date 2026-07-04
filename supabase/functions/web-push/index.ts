// web-push: send VAPID-signed browser Push notifications to a user's stored
// subscriptions, so notifications arrive even when the app/tab is closed.
//
// Invoked by a Database Webhook on notification_deliveries INSERT (payload
// { record: <delivery> }) — or directly with { user_id, title, body, url?, tag? }.
// Only pushes deliveries on the 'desktop' channel that aren't 'held'.
//
// Secrets (supabase secrets set): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (mailto: or https URL), and WEB_PUSH_WEBHOOK_SECRET (REQUIRED —
// the only auth gate). Deploy with verify_jwt = false so the DB webhook can call
// it (no user JWT); the webhook MUST send that secret as an x-webhook-secret
// header, and the function fails closed if the secret is unset.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "https://esm.sh/web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:notifications@mangodoro.app";
const WEBHOOK_SECRET = Deno.env.get("WEB_PUSH_WEBHOOK_SECRET") || "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Require the shared secret (the DB webhook sends it via x-webhook-secret).
    // Deployed with verify_jwt=false so the webhook can call it, so this is the
    // only gate — FAIL CLOSED if it's unset, or anyone could POST a push for an
    // arbitrary user_id.
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
    const payload = JSON.stringify({
      title: rec.title || "Mangodoro",
      body: rec.body || "",
      url,
      tag: rec.type || undefined,
      type: rec.type || undefined,
    });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: subs } = await admin
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    let sent = 0;
    let removed = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent += 1;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await admin.from("web_push_subscriptions").delete().eq("id", s.id);
          removed += 1;
        }
      }
    }
    return json(200, { sent, removed });
  } catch (e: any) {
    return json(500, { error: String(e?.message || e) });
  }
});
