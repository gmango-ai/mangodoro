import { useTheme } from "../context/ThemeContext";

export default function SyncParticipantList({ participants, leaderId, presenceMap }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  if (!participants?.length) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const initial = (p.display_name || "?")[0].toUpperCase();

        return (
          <div
            key={p.user_id}
            className="relative group"
            title={`${p.display_name || "Member"}${isLeader ? " (Leader)" : ""}${isOnline ? "" : " (Offline)"}`}
          >
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                isLeader
                  ? dark
                    ? "bg-cyan-500/30 text-cyan-300 border-cyan-500/50"
                    : "bg-teal-100 text-teal-700 border-teal-400"
                  : dark
                    ? "bg-slate-800 text-slate-400 border-slate-600"
                    : "bg-slate-100 text-slate-500 border-slate-300"
              }`}
            >
              {initial}
            </div>
            {/* Online indicator */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${
                dark ? "border-slate-900" : "border-white"
              } ${isOnline ? "bg-emerald-400" : "bg-slate-400"}`}
            />
          </div>
        );
      })}
    </div>
  );
}
