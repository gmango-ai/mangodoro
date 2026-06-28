// Per-device call preferences, shared between the pre-join lobby (RoomVideoStage)
// and the live call (LiveKitCall) so a setting chosen in the lobby carries into
// the call automatically — both read/write the SAME localStorage keys. Kept in a
// tiny standalone module so the lobby doesn't have to import the heavy call
// component just to read a key.
export const PREF = {
  bg: "ql_lk_bg",
  bgCustom: "ql_lk_bg_custom",
  noise: "ql_lk_noise",
  layout: "ql_lk_layout",
  autoMic: "ql_lk_automic",
  ptt: "ql_lk_ptt",
  speaker: "ql_lk_speaker", // saved audio-output deviceId (applied on call connect)
};

export function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function savePref(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore (private mode / quota) */
  }
}
