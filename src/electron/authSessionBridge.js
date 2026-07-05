export function toElectronAuthPayload(session) {
  if (!session?.access_token || !session?.refresh_token) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    token_type: session.token_type ?? "bearer",
  };
}

export function isElectronAuthPayload(payload) {
  return !!(
    payload &&
    typeof payload === "object" &&
    typeof payload.access_token === "string" &&
    payload.access_token.length > 0 &&
    typeof payload.refresh_token === "string" &&
    payload.refresh_token.length > 0
  );
}

export async function restoreElectronAuthSession(supabaseClient, payload) {
  if (!isElectronAuthPayload(payload)) return null;
  const { data, error } = await supabaseClient.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) throw error;
  return data?.session ?? null;
}
