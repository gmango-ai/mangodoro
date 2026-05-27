import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Crown, ShieldCheck, Trash2, Pencil, Rows3, LayoutGrid } from "lucide-react";

const PRESENCE_INFO = {
  active:     { label: "Active",       light: "bg-emerald-500", dark: "bg-emerald-400" },
  available:  { label: "Available",    light: "bg-sky-500",     dark: "bg-sky-400"     },
  heads_down: { label: "Heads-down",   light: "bg-violet-500",  dark: "bg-violet-400"  },
  in_meeting: { label: "In a meeting", light: "bg-rose-500",    dark: "bg-rose-400"    },
  away:       { label: "Away",         light: "bg-amber-500",   dark: "bg-amber-400"   },
};

function presenceOf(p) {
  return PRESENCE_INFO[p?.presence_state] || PRESENCE_INFO.active;
}

const VIEW_KEY = "ql_sync_participants_view";

function Avatar({ participant, size = 36, dark, isLeader }) {
  const initial = (participant.display_name || "?")[0].toUpperCase();
  const url = participant.avatar_url;
  const px = `${size}px`;
  const fontSize = Math.max(10, Math.round(size / 2.5));
  return (
    <div
      className={`relative rounded-full overflow-hidden border-2 shrink-0 ${
        isLeader
          ? dark ? "border-cyan-500/50" : "border-teal-400"
          : dark ? "border-slate-700" : "border-slate-300"
      }`}
      style={{ width: px, height: px }}
    >
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span
          className={`flex items-center justify-center w-full h-full font-bold ${
            isLeader
              ? dark ? "bg-cyan-500/30 text-cyan-300" : "bg-teal-100 text-teal-700"
              : dark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
          }`}
          style={{ fontSize }}
        >
          {initial}
        </span>
      )}
    </div>
  );
}

export default function SyncParticipantList({
  participants,
  leaderId,
  controlMode = "leader", // "open" | "leader"
  presenceMap,
  currentUserId,
  onTransferLeader,
  onKickParticipant,
  onEditMyStatus,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) || "list"; } catch { return "list"; }
  });
  const [confirming, setConfirming] = useState(null); // { type, userId }

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);

  if (!participants?.length) return null;

  const viewerIsLeader = currentUserId && currentUserId === leaderId;
  // Make-leader only makes sense in leader-controlled mode; in open mode
  // there's no distinction between leader and other participants for
  // controlling the timer, so hide it.
  const allowMakeLeader = controlMode === "leader";

  const headerCls = `flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider mb-1 ${
    dark ? "text-slate-500" : "text-slate-400"
  }`;
  const toggleBtn = (active) =>
    `p-1 rounded transition-colors ${
      active
        ? dark ? "bg-slate-700 text-slate-100" : "bg-slate-200 text-slate-700"
        : dark ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="space-y-1.5">
      <div className={headerCls}>
        <span>In session · {participants.length}</span>
        <div className="flex gap-0.5">
          <button type="button" onClick={() => setView("list")} className={toggleBtn(view === "list")} title="List view" aria-label="List view">
            <Rows3 className="w-3 h-3" />
          </button>
          <button type="button" onClick={() => setView("compact")} className={toggleBtn(view === "compact")} title="Compact view" aria-label="Compact view">
            <LayoutGrid className="w-3 h-3" />
          </button>
        </div>
      </div>

      {view === "compact" ? (
        <CompactView
          participants={participants}
          leaderId={leaderId}
          presenceMap={presenceMap}
          currentUserId={currentUserId}
          dark={dark}
        />
      ) : (
        <ListView
          participants={participants}
          leaderId={leaderId}
          allowMakeLeader={allowMakeLeader}
          presenceMap={presenceMap}
          currentUserId={currentUserId}
          viewerIsLeader={viewerIsLeader}
          confirming={confirming}
          setConfirming={setConfirming}
          onTransferLeader={onTransferLeader}
          onKickParticipant={onKickParticipant}
          onEditMyStatus={onEditMyStatus}
          dark={dark}
        />
      )}
    </div>
  );
}

function ListView({
  participants, leaderId, allowMakeLeader, presenceMap, currentUserId,
  viewerIsLeader, confirming, setConfirming,
  onTransferLeader, onKickParticipant, onEditMyStatus, dark,
}) {
  return (
    <ul className="max-h-72 overflow-y-auto -mx-0.5 px-0.5 space-y-1">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        const showActions = viewerIsLeader && !isSelf && !isLeader;
        const isConfirming = confirming?.userId === p.user_id;

        return (
          <li
            key={p.user_id}
            className={`rounded-lg px-2 py-1.5 ${
              dark ? "bg-slate-800/40 hover:bg-slate-800/70" : "bg-slate-50 hover:bg-slate-100"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <div className="relative">
                <Avatar participant={p} dark={dark} isLeader={isLeader} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                    dark ? "border-slate-900" : "border-white"
                  } ${dotCls}`}
                  title={isOnline ? presence.label : "Offline"}
                />
                {isLeader && (
                  <span className={`absolute -top-1 -right-1 rounded-full p-0.5 ${dark ? "bg-slate-900" : "bg-white"}`}>
                    <Crown className={`w-2.5 h-2.5 ${dark ? "text-amber-300" : "text-amber-500"}`} fill="currentColor" />
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {isSelf ? `${p.display_name || "You"} (you)` : (p.display_name || "Member")}
                </p>
                <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {p.status?.trim()
                    ? p.status
                    : <span className="italic opacity-70">{presence.label}{!isOnline ? " · Offline" : ""}</span>}
                </p>
              </div>

              <div className="flex items-center gap-0.5 shrink-0">
                {isSelf && typeof onEditMyStatus === "function" && (
                  <button
                    type="button"
                    onClick={onEditMyStatus}
                    title="Edit my status"
                    className={`p-1 rounded ${
                      dark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                {showActions && allowMakeLeader && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ type: "transfer", userId: p.user_id })}
                    title="Make leader"
                    disabled={!onTransferLeader}
                    className={`p-1 rounded ${
                      dark ? "text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/15" : "text-slate-500 hover:text-teal-700 hover:bg-teal-50"
                    } disabled:opacity-40`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                  </button>
                )}
                {showActions && (
                  <button
                    type="button"
                    onClick={() => setConfirming({ type: "kick", userId: p.user_id })}
                    title="Remove from session"
                    disabled={!onKickParticipant}
                    className={`p-1 rounded ${
                      dark ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15" : "text-slate-500 hover:text-red-600 hover:bg-red-50"
                    } disabled:opacity-40`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isConfirming && (
              <ConfirmRow
                dark={dark}
                prompt={
                  confirming.type === "transfer"
                    ? `Transfer leadership to ${p.display_name || "this member"}?`
                    : `Remove ${p.display_name || "this member"} from the session?`
                }
                confirmLabel={confirming.type === "transfer" ? "Yes, transfer" : "Remove"}
                confirmTone={confirming.type === "transfer" ? "primary" : "danger"}
                onConfirm={() => {
                  if (confirming.type === "transfer") onTransferLeader?.(p.user_id);
                  else onKickParticipant?.(p.user_id);
                  setConfirming(null);
                }}
                onCancel={() => setConfirming(null)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CompactView({ participants, leaderId, presenceMap, currentUserId, dark }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        return (
          <div
            key={p.user_id}
            className="relative"
            title={`${isSelf ? "You" : (p.display_name || "Member")}${p.status?.trim() ? ` — ${p.status}` : ""}`}
          >
            <Avatar participant={p} size={32} dark={dark} isLeader={isLeader} />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 ${
                dark ? "border-slate-900" : "border-white"
              } ${dotCls}`}
            />
            {isLeader && (
              <span className={`absolute -top-1 -right-1 rounded-full p-0.5 ${dark ? "bg-slate-900" : "bg-white"}`}>
                <Crown className={`w-2.5 h-2.5 ${dark ? "text-amber-300" : "text-amber-500"}`} fill="currentColor" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConfirmRow({ dark, prompt, confirmLabel, confirmTone, onConfirm, onCancel }) {
  const confirmCls =
    confirmTone === "danger"
      ? dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-500 text-white"
      : dark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-teal-600 hover:bg-teal-500 text-white";
  return (
    <div className="mt-2 pt-2 border-t border-current/10 space-y-1.5">
      <p className={`text-[11px] ${dark ? "text-slate-300" : "text-slate-600"}`}>{prompt}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold ${confirmCls}`}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`flex-1 px-2 py-1 rounded-md text-[11px] font-semibold ${
            dark ? "bg-slate-800 text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
