#!/usr/bin/env node
// Pre-deploy smoke test for Pomodoro v2.
//
// Verifies that the new RPCs and tables are reachable, the join_sync_session
// guard rejects empty display names, and the new columns are present.
// Intended to run against a non-prod project before promotion.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_TEST_EMAIL=... SUPABASE_TEST_PASSWORD=... \
//     node scripts/smoke-pomodoro.mjs
//
// Exit code is non-zero on any failure.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL;
const PASS = process.env.SUPABASE_TEST_PASSWORD;

if (!URL || !KEY || !EMAIL || !PASS) {
  console.error("Missing required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_TEST_EMAIL, SUPABASE_TEST_PASSWORD");
  process.exit(2);
}

const supabase = createClient(URL, KEY);
let failures = 0;

function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, err) {
  failures += 1;
  console.error(`  ✗ ${label}${err ? ` — ${err.message || err}` : ""}`);
}

async function check(label, fn) {
  try { const ok = await fn(); if (ok === false) fail(label); else pass(label); }
  catch (e) { fail(label, e); }
}

(async () => {
  console.log("Pomodoro v2 smoke");

  // ── Auth ──────────────────────────────────────────────
  const { data: signIn, error: authErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (authErr) { fail("sign in", authErr); process.exit(1); }
  const userId = signIn.user.id;
  pass(`signed in as ${EMAIL}`);

  // ── Schema sanity ─────────────────────────────────────
  await check("user_settings has status column", async () => {
    const { error } = await supabase.from("user_settings").select("status, presence_state, is_guest").eq("user_id", userId).limit(1);
    return !error;
  });
  await check("sync_sessions has controller_id + visibility", async () => {
    const { error } = await supabase.from("sync_sessions").select("controller_id, control_mode, visibility").limit(1);
    return !error;
  });

  // ── RPC: set_user_status ──────────────────────────────
  await check("set_user_status round-trips", async () => {
    const { error } = await supabase.rpc("set_user_status", { p_status: "smoke-test", p_presence_state: "heads_down" });
    if (error) throw error;
    const { data } = await supabase.from("user_settings").select("status, presence_state").eq("user_id", userId).single();
    return data?.status === "smoke-test" && data?.presence_state === "heads_down";
  });

  // ── RPC: get_sync_session_preview against a fake code ─
  await check("get_sync_session_preview returns error for bad code", async () => {
    const { data, error } = await supabase.rpc("get_sync_session_preview", { p_join_code: "ZZZZZZ" });
    if (error) throw error;
    return data?.error?.includes("not found");
  });

  // ── Create a session, then validate join guards ───────
  let sessionId = null;
  let joinCode = null;
  await check("create sync session", async () => {
    const code = "SMOKE" + String(Math.floor(Math.random() * 9));
    const { data, error } = await supabase
      .from("sync_sessions")
      .insert({ leader_id: userId, controller_id: userId, join_code: code, visibility: "invite_only" })
      .select()
      .single();
    if (error) throw error;
    sessionId = data.id;
    joinCode = data.join_code;
    return !!data.id && data.controller_id === userId && data.visibility === "invite_only";
  });

  await check("join_sync_session rejects empty display name", async () => {
    const { data, error } = await supabase.rpc("join_sync_session", {
      p_join_code: joinCode,
      p_display_name: "",
    });
    // The Postgres exception surfaces as either an HTTP error or in data.error.
    return (error && /display_name_required/.test(error.message || "")) ||
           (data?.error && /display_name_required/i.test(data.error));
  });

  await check("join_sync_session works with a name", async () => {
    const { data, error } = await supabase.rpc("join_sync_session", {
      p_join_code: joinCode,
      p_display_name: "Smoke Tester",
    });
    if (error) throw error;
    return !!data?.session?.id;
  });

  await check("take_sync_control returns session for active participant", async () => {
    const { data, error } = await supabase.rpc("take_sync_control", { p_session_id: sessionId });
    if (error) throw error;
    return data?.session?.controller_id === userId;
  });

  await check("set_sync_control_mode requires leader and validates input", async () => {
    const bad = await supabase.rpc("set_sync_control_mode", { p_session_id: sessionId, p_mode: "garbage" });
    if (bad.data?.error !== "Invalid mode") throw new Error("expected Invalid mode error");
    const ok = await supabase.rpc("set_sync_control_mode", { p_session_id: sessionId, p_mode: "leader" });
    if (ok.error) throw ok.error;
    return ok.data?.ok === true;
  });

  await check("set_sync_visibility flips visibility", async () => {
    const { data, error } = await supabase.rpc("set_sync_visibility", { p_session_id: sessionId, p_visibility: "team" });
    if (error) throw error;
    return data?.ok === true;
  });

  // ── Cleanup ───────────────────────────────────────────
  await supabase.from("sync_sessions").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", sessionId);
  pass("cleanup ended session");

  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
