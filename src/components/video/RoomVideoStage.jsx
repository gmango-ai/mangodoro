import { useEffect, useRef, useState } from "react";
import { Video, Eye, LogIn, ArrowLeft } from "lucide-react";
import { PreJoin } from "@livekit/components-react";
import "@livekit/components-styles";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useVideoCall } from "../../context/VideoCallContext";
import { Button } from "@/components/ui/button";
import UserAvatar from "../UserAvatar";
import { useRoomCallPresence } from "./useRoomCallPresence";

// What goes in the room view's video tile.
//
// Join model (deliberately NOT auto-join from the hallway):
//   • Enter a room from the hallway → you choose. A "Set up & join" card
//     (LiveKit <PreJoin>) lets you pick + preview camera/mic before joining,
//     or "Just watch" to spectate (see/hear everyone without publishing).
//   • The ONLY auto-join is carry-over: if you're already in a call and move
//     rooms, the call follows you (handled in PersistentVideoCall).
//
// When you're in the call, the real media is owned by PersistentVideoCall at
// the app shell (so it survives navigation); this component just hands it a
// stageRef to position over and renders the spectate "Join in" affordance.
export default function RoomVideoStage({ roomId, displayName }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const userId = session?.user?.id;
  const [setupOpen, setSetupOpen] = useState(false);

  const { call, startCall, setStageEl } = useVideoCall();
  const inCall = call?.roomId === roomId;
  const spectating = inCall && call?.mode === "spectate";
  // In a call somewhere else → carry-over is about to move it here; show a
  // neutral placeholder rather than flashing the pre-join card.
  const inAnotherCall = !!call && call.roomId !== roomId;

  const stageRef = useRef(null);
  useEffect(() => {
    if (!inCall) return;
    setStageEl(stageRef.current);
    return () => setStageEl(null);
  }, [inCall, setStageEl]);

  // Spectators announce as "observe" so they don't show up as participants
  // in the room's call-presence; publishers announce as "join".
  const observed = useRoomCallPresence({
    roomId, userId, displayName,
    mode: inCall && !spectating ? "join" : "observe",
  });
  const othersInCall = observed.isAnyoneInCall;

  const join = (choices) => startCall(roomId, displayName, { mode: "join", choices });
  const watch = () => startCall(roomId, displayName, { mode: "spectate" });

  // ── In the call ──────────────────────────────────────────────
  // The persistent overlay covers this rect; we keep a neutral fill plus,
  // for spectators, a "Join in" affordance.
  if (inCall) {
    // The persistent call overlay (LiveKitCall) covers this rect and now owns
    // the spectate "Join in" affordance, since anything rendered here is
    // behind the overlay. We just provide the rect to position over.
    return (
      <div
        ref={stageRef}
        className="relative w-full h-full rounded-xl overflow-hidden"
        style={{ background: "#0f172a" }}
      />
    );
  }

  // ── Carry-over in flight ─────────────────────────────────────
  if (inAnotherCall) {
    return <div className="w-full h-full rounded-xl overflow-hidden bg-slate-900" aria-label="Moving your call" />;
  }

  const shellCls = `relative w-full h-full rounded-xl border overflow-hidden flex flex-col ${
    dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-slate-900"
  }`;

  // ── Device setup (LiveKit PreJoin) ───────────────────────────
  if (setupOpen) {
    return (
      <div className={shellCls}>
        <div className="flex items-center gap-2 px-3 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setSetupOpen(false)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/70 hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        </div>
        <div
          className="flex-1 min-h-0 overflow-auto"
          data-lk-theme="default"
          style={{ "--lk-accent-bg": "var(--color-accent)", "--lk-accent-fg": "#fff" }}
        >
          <PreJoin
            defaults={{ username: displayName, videoEnabled: true, audioEnabled: true }}
            joinLabel={othersInCall ? "Join call" : "Start call"}
            persistUserChoices
            onSubmit={(choices) => join(choices)}
            onError={(e) => console.warn("[prejoin]", e?.message)}
          />
        </div>
      </div>
    );
  }

  // ── Choice card (fresh entry from the hallway) ───────────────
  return (
    <div className={`${shellCls} items-center justify-center text-center px-6`}>
      {othersInCall ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-sm font-semibold text-white">{observed.participants.length} in call</p>
          </div>
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {observed.participants.slice(0, 6).map((p) => (
              <span key={p.user_id} className="ring-2 ring-white/30 rounded-full">
                <UserAvatar url="" name={p.display_name || "Member"} size={32} />
              </span>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="p-3 rounded-full bg-white/10 backdrop-blur-sm mb-3">
            <Video className="w-6 h-6 text-white/80" />
          </div>
          <p className="text-sm font-semibold text-white">No one's in the call</p>
          <p className="text-xs text-white/60 max-w-[320px] mt-1 mb-4">
            Set up your camera and mic, then start a call — teammates in this room get a join prompt.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => setSetupOpen(true)}
          className="rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
        >
          <LogIn className="w-4 h-4 mr-1.5" />
          {othersInCall ? "Set up & join" : "Set up & start"}
        </Button>
        {othersInCall && (
          <Button
            onClick={watch}
            variant="outline"
            className="rounded-full border-white/20 text-white hover:bg-white/10"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Just watch
          </Button>
        )}
      </div>
      <p className="text-[11px] text-white/50 mt-3">
        {othersInCall ? "Watch without turning on your camera, or set up and join in." : "Your camera + mic stay off until you start."}
      </p>
    </div>
  );
}
