// Org device accounts — client wrappers. A device is a shared kiosk that logs
// into an org (pinned to one room) without a personal email. Admin actions go
// through edge functions that hold the service role; the device pairs with a
// one-time code and then runs as a normal (least-privilege) Supabase session.
import { supabase } from "../supabase";

async function invoke(fn, body) {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) return { error };
  if (data?.error) return { error: { message: data.error } };
  return { data };
}

// Admin: list an org's devices (RLS lets org admins read org_devices).
export async function listOrgDevices(orgId) {
  const { data, error } = await supabase
    .from("org_devices")
    .select("id, name, room_id, last_seen_at, created_at")
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

// Admin: create a device pinned to a room. Returns { device_id, pairing_code, expires_at }.
export function provisionDevice(roomId, name) {
  return invoke("device-provision", { room_id: roomId, name });
}

// Admin: re-issue a fresh pairing code for an existing device (codes expire).
export function reissueDeviceCode(deviceId) {
  return invoke("device-provision", { device_id: deviceId });
}

// Admin: remove a device (kills its session + deletes its account).
export function revokeDevice(deviceId) {
  return invoke("device-revoke", { device_id: deviceId });
}

// Device: redeem a pairing code → establish the device's Supabase session.
export async function pairDevice(code) {
  const { data, error } = await invoke("device-pair", { code });
  if (error) return { error };
  const { access_token, refresh_token } = data || {};
  if (!access_token || !refresh_token) return { error: { message: "Pairing returned no session" } };
  const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (setErr) return { error: setErr };
  return { data: { ok: true } };
}
