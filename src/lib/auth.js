import { supabase } from "../supabase";

// Sign in anonymously and seed a user_settings row with the chosen
// display name + is_guest flag. Used by the JoinSyncPage "Continue as
// guest" path so unauthenticated visitors can join a pomodoro without
// creating a full account.
export async function signInAsGuest(displayName) {
  const cleanName = (displayName || "").trim().slice(0, 60);
  if (!cleanName) return { error: { message: "Display name required" } };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) return { error };
  const userId = data?.user?.id;
  if (!userId) return { error: { message: "Anonymous sign-in failed" } };

  // Seed minimal user_settings. RLS allows INSERT where user_id = auth.uid().
  const { error: settingsError } = await supabase.from("user_settings").upsert(
    { user_id: userId, name: cleanName, is_guest: true },
    { onConflict: "user_id" },
  );
  if (settingsError) {
    // Sign-in succeeded; just log and continue. The session is still usable.
    console.warn("guest settings upsert:", settingsError.message);
  }
  return { data, displayName: cleanName };
}
