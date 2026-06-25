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
    .select("id, name, room_id, movable, last_seen_at, created_at")
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });
  return { data: data || [], error };
}

// Device: the LIVE pinned room (authoritative — survives a room switch, unlike
// the stale room_id baked into the JWT at pairing).
export async function currentDeviceRoom() {
  const { data, error } = await supabase.rpc("current_device_room");
  return { data: data || null, error };
}

// Device (movable only): switch which room this kiosk is in. Gated server-side.
export async function setDeviceRoom(roomId) {
  const { error } = await supabase.rpc("set_device_room", { new_room_id: roomId });
  return { error };
}

// Admin: reassign a device to another room in the org.
export async function adminSetDeviceRoom(deviceId, roomId) {
  const { error } = await supabase.rpc("admin_set_device_room", { p_device_id: deviceId, p_room_id: roomId });
  return { error };
}

// Admin: toggle whether a device may self-switch rooms.
export async function adminSetDeviceMovable(deviceId, movable) {
  const { error } = await supabase.rpc("admin_set_device_movable", { p_device_id: deviceId, p_movable: movable });
  return { error };
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
