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
  gridSort: "ql_lk_grid_sort", // grid resting order: "join" (arrival) | "name" (A–Z)
  autoMic: "ql_lk_automic",
  ptt: "ql_lk_ptt",
  speaker: "ql_lk_speaker", // saved audio-output deviceId (applied on call connect)
  mirror: "ql_lk_mirror",   // flip your OWN camera (self-view) horizontally
  selfFloat: "ql_lk_selffloat", // show your own tile as a floating PiP, not in the grid
  spotlightIgnoreSelf: "ql_lk_spot_ignore_self", // don't spotlight yourself to yourself
  fit: "ql_lk_fit",   // "cover" (fill + crop) | "contain" (fit, show whole frame)
  autoRotate: "ql_lk_autorotate", // counter-rotate my self-view to the device
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
