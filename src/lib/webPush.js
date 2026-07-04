import { supabase } from "../supabase";

// Browser web-push: subscribe this device to the Push API and store the
// subscription so the web-push edge function can reach it when the app is
// closed. Complements the in-tab desktop Notification (which only fires while a
// tab is open). See public/push-sw.js (SW handler) + supabase/functions/web-push.

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY;

export function webPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    !!VAPID_PUBLIC
  );
}

// Base64URL VAPID public key → Uint8Array (applicationServerKey format).
function urlB64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function isWebPushEnabled() {
  if (!webPushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

// Request permission, subscribe, and store the subscription. Returns { error }.
export async function enableWebPush(userId) {
  if (!webPushSupported()) return { error: "This browser doesn't support web push." };
  if (!userId) return { error: "Not signed in." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { error: "Notification permission denied." };

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC),
    });
  }
  const json = sub.toJSON();
  const { error } = await supabase.from("web_push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,endpoint" }
  );
  return { error: error?.message || null };
}

// Unsubscribe this device and drop the stored subscription.
export async function disableWebPush(userId) {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      if (userId) await supabase.from("web_push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    }
  } catch {
    /* best-effort */
  }
  return { error: null };
}
