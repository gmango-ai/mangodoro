import { useEffect, useState } from "react";
import { Video, VideoOff, Bell, Settings as SettingsIcon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { Button } from "@/components/ui/button";
import UserAvatar from "../UserAvatar";
import VideoCall from "./VideoCall";
import { useRoomCallPresence } from "./useRoomCallPresence";

const AUTO_JOIN_KEY = "ql_auto_join_room_calls";

function loadAutoJoinPref() {
  try {
    const v = localStorage.getItem(AUTO_JOIN_KEY);
    if (v === null) return true; // default: auto-join when others are present
    return v !== "false";
  } catch {
    return true;
  }
}

function saveAutoJoinPref(value) {
  try {
    localStorage.setItem(AUTO_JOIN_KEY, value ? "true" : "false");
  } catch { /* */ }
}

// What goes in the room view's top pane.
//
// State machine:
//   1. Nobody in the call yet
//        → "Start a call" button (click → join + become first member)
//   2. Others in the call, auto_join_room_calls = true (default)
//        → join immediately, VideoCall iframe mounts
//   3. Others in the call, auto_join = false
//        → "{N} in call" preview with avatars + "Ask to join" button
//   4. I'm in the call
//        → VideoCall iframe mounts, ignores auto-join from here on
//
// "Ask to join" is currently the same action as "join" — there's no
// knock-and-approve flow yet. We surface it as a separate button so
// the auto-join opt-out doesn't auto-pull someone into the call,
// which is the actual privacy concern. A real knock flow lands when
// JaaS auth is in.
export default function RoomVideoStage({ roomId, displayName }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const userId = session?.user?.id;
  const [autoJoin, setAutoJoin] = useState(loadAutoJoinPref);
  const [intent, setIntent] = useState("idle"); // "idle" | "joining" | "in-call"
  const [showSettings, setShowSettings] = useState(false);

  const inCall = intent === "in-call";

  // Single presence hook — mode flips between observe / join based on
  // intent. Running two hooks in parallel (the old InCallPresenceShim
  // path) failed because supabase reuses channels by topic name, so
  // both consumers ended up sharing one channel and the second `.on`
  // would fire after the first's `.subscribe()` → "cannot add
  // `presence` callbacks after subscribe()".
  const observed = useRoomCallPresence({
    roomId, userId, displayName,
    mode: inCall ? "join" : "observe",
  });

  // Auto-join trigger. When others are in the call AND the user has
  // auto-join enabled, automatically flip intent to "in-call" so the
  // VideoCall component mounts. Skip if already in-call to avoid
  // re-popping the camera permission dialog.
  useEffect(() => {
    if (intent === "in-call") return;
    if (!observed.isAnyoneInCall) return;
    if (autoJoin) setIntent("in-call");
  }, [observed.isAnyoneInCall, autoJoin, intent]);

  const settingsToggle = (
    <div className="absolute top-2 right-2 z-10">
      <div className="relative">
        <Button
          variant="outline"
          size="icon"
          className={`h-8 w-8 rounded-full backdrop-blur-sm ${
            dark ? "bg-[var(--color-surface)]/80" : "bg-white/80"
          }`}
          onClick={() => setShowSettings((v) => !v)}
          title="Video settings"
        >
          <SettingsIcon className="w-4 h-4" />
        </Button>
        {showSettings && (
          <div
            className={`absolute right-0 mt-1 w-72 rounded-lg border shadow-lg p-3 z-20 ${
              dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoJoin}
                onChange={(e) => {
                  setAutoJoin(e.target.checked);
                  saveAutoJoinPref(e.target.checked);
                }}
                className="mt-0.5"
              />
              <span>
                <span className={`text-xs font-semibold block ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  Auto-join active calls
                </span>
                <span className={`text-[11px] block mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  When teammates are already in this room's call, drop in automatically. Off = you'll see an "Ask to join" button instead.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );

  // In-call view: the actual Jitsi embed fills the stage. The
  // presence broadcast happens via the shared useRoomCallPresence
  // hook above (mode = "join" when inCall).
  if (inCall) {
    return (
      <div className="relative w-full h-full">
        <VideoCall
          roomId={roomId}
          displayName={displayName}
          onLeft={() => setIntent("idle")}
        />
        {settingsToggle}
      </div>
    );
  }

  // Idle, but others are already in the call → "Ask to join" preview.
  if (observed.isAnyoneInCall) {
    return (
      <div className={`relative w-full h-full rounded-xl border overflow-hidden flex flex-col items-center justify-center text-center px-6 ${
        dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-slate-900"
      }`}>
        {settingsToggle}
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-sm font-semibold text-white">
            {observed.participants.length} in call
          </p>
        </div>
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {observed.participants.slice(0, 6).map((p) => (
            <span key={p.user_id} className="ring-2 ring-white/30 rounded-full">
              <UserAvatar url="" name={p.display_name || "Member"} size={32} />
            </span>
          ))}
        </div>
        <Button
          onClick={() => setIntent("in-call")}
          className="rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
        >
          <Bell className="w-4 h-4 mr-1.5" />
          Ask to join
        </Button>
        <p className="text-[11px] text-white/50 mt-2">
          Camera + mic enable when you join. Change defaults via the gear.
        </p>
      </div>
    );
  }

  // No call yet → "Start a call" CTA.
  return (
    <div className={`relative w-full h-full rounded-xl border overflow-hidden flex flex-col items-center justify-center text-center px-6 ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-slate-900"
    }`}>
      {settingsToggle}
      <div className="p-3 rounded-full bg-white/10 backdrop-blur-sm mb-3">
        <VideoOff className="w-6 h-6 text-white/80" />
      </div>
      <p className="text-sm font-semibold text-white">No one's in the call</p>
      <p className="text-xs text-white/60 max-w-[320px] mt-1 mb-4">
        Start a call and your teammates in this room get a join prompt.
      </p>
      <Button
        onClick={() => setIntent("in-call")}
        className="rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
      >
        <Video className="w-4 h-4 mr-1.5" />
        Start a call
      </Button>
    </div>
  );
}

