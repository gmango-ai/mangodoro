// device-provision
//
// Org admin creates a device account (or re-issues its pairing code). Creates a
// real Supabase auth user (synthetic email + high-entropy random password,
// server-side only), pins it to a room, and returns a SHORT one-time pairing
// code (shown to the admin once). The device redeems the code via device-pair.
//
// Body (create):   { room_id: uuid, name: string }
// Body (re-issue): { device_id: uuid }
// Response:        { device_id, pairing_code, expires_at }
//
// Auth: requires a Supabase user JWT; the caller must be an admin of the room's
// org (teams.id). Secrets: SUPABASE_SERVICE_ROLE_KEY (provided), and optionally
// DEVICE_EMAIL_DOMAIN (defaults to devices.mangodoro.app — never receives mail).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEVICE_EMAIL_DOMAIN = Deno.env.get("DEVICE_EMAIL_DOMAIN") ?? "devices.mangodoro.app";

const PAIRING_TTL_MS = 10 * 60 * 1000;
// Unambiguous alphabet (no 0/O/1/I/L) for a human-typed code.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function genPairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callerIsOrgAdmin(admin: ReturnType<typeof createClient>, orgId: string, uid: string) {
  const { data } = await admin
    .from("team_members")
    .select("role")
    .eq("team_id", orgId)
    .eq("user_id", uid)
    .maybeSingle();
  return data?.role === "admin";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!SERVICE_ROLE_KEY) return json(500, { error: "SUPABASE_SERVICE_ROLE_KEY missing" });

  // identify caller
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json(401, { error: "Missing bearer token" });
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResult, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userResult?.user) return json(401, { error: "Invalid session" });
  const caller = userResult.user;

  let body: { room_id?: string; name?: string; device_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const code = genPairingCode();
  const codeHash = await sha256hex(code);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

  // ── re-issue a code for an existing device ──
  if (body.device_id) {
    const { data: dev } = await admin
      .from("org_devices")
      .select("id, org_id")
      .eq("id", body.device_id)
      .is("revoked_at", null)
      .maybeSingle();
    if (!dev) return json(404, { error: "Device not found" });
    if (!(await callerIsOrgAdmin(admin, dev.org_id, caller.id))) {
      return json(403, { error: "Only an org admin can manage devices" });
    }
    const { error: upErr } = await admin
      .from("org_devices")
      .update({ pairing_code_hash: codeHash, pairing_expires_at: expiresAt })
      .eq("id", dev.id);
    if (upErr) return json(500, { error: "Could not re-issue code" });
    return json(200, { device_id: dev.id, pairing_code: code, expires_at: expiresAt });
  }

  // ── create a new device ──
  const roomId = (body.room_id || "").trim();
  const name = (body.name || "").trim().slice(0, 80);
  if (!roomId || !name) return json(400, { error: "room_id and name are required" });

  const { data: room } = await admin.from("rooms").select("id, team_id").eq("id", roomId).maybeSingle();
  if (!room) return json(404, { error: "Room not found" });
  const orgId = room.team_id as string;
  if (!(await callerIsOrgAdmin(admin, orgId, caller.id))) {
    return json(403, { error: "Only an org admin can add devices" });
  }

  const email = `device-${crypto.randomUUID()}@${DEVICE_EMAIL_DOMAIN}`;
  const password = randomPassword();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { is_device: true, name, org_id: orgId, room_id: roomId },
  });
  if (cErr || !created?.user) {
    console.error("[device-provision] createUser failed", cErr);
    return json(500, { error: "Could not create device account" });
  }
  const deviceUserId = created.user.id;

  // Profile + secret + registry. On any failure, delete the auth user so we
  // don't leave an orphan.
  const cleanup = async () => { try { await admin.auth.admin.deleteUser(deviceUserId); } catch { /* */ } };

  const { error: usErr } = await admin
    .from("user_settings")
    .upsert({ user_id: deviceUserId, name, is_device: true }, { onConflict: "user_id" });
  if (usErr) { await cleanup(); return json(500, { error: "Could not create device profile" }); }

  const { error: secErr } = await admin
    .from("org_device_secrets")
    .insert({ user_id: deviceUserId, password });
  if (secErr) { await cleanup(); return json(500, { error: "Could not store device secret" }); }

  const { data: dev, error: dErr } = await admin
    .from("org_devices")
    .insert({
      org_id: orgId,
      room_id: roomId,
      user_id: deviceUserId,
      name,
      created_by: caller.id,
      pairing_code_hash: codeHash,
      pairing_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (dErr || !dev) { await cleanup(); return json(500, { error: "Could not register device" }); }

  return json(200, { device_id: dev.id, pairing_code: code, expires_at: expiresAt });
});
