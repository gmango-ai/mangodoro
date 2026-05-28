import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Crown, ShieldCheck, Trash2, Pencil, Rows3, LayoutGrid, X, Clock } from "lucide-react";

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

function relativeTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
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
  const [selectedId, setSelectedId] = useState(null);
  const [confirming, setConfirming] = useState(null); // "transfer" | "kick" | null

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ } }, [view]);

  // Clear selection if that participant leaves the session.
  useEffect(() => {
    if (selectedId && !participants?.some((p) => p.user_id === selectedId)) {
      setSelectedId(null);
      setConfirming(null);
    }
  }, [participants, selectedId]);

  // Reset confirmation when switching between participants.
  useEffect(() => { setConfirming(null); }, [selectedId]);

  if (!participants?.length) return null;

  const viewerIsLeader = currentUserId && currentUserId === leaderId;
  const allowMakeLeader = controlMode === "leader";
  const selected = participants.find((p) => p.user_id === selectedId) || null;

  function toggleSelect(userId) {
    setSelectedId((cur) => (cur === userId ? null : userId));
  }

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
          selectedId={selectedId}
          onSelect={toggleSelect}
          dark={dark}
        />
      ) : (
        <ListView
          participants={participants}
          leaderId={leaderId}
          presenceMap={presenceMap}
          currentUserId={currentUserId}
          selectedId={selectedId}
          onSelect={toggleSelect}
          dark={dark}
        />
      )}

      {/* Click-through detail card: full status, joined-at, actions */}
      {selected && (
        <ParticipantDetail
          participant={selected}
          dark={dark}
          isLeader={selected.user_id === leaderId}
          isSelf={selected.user_id === currentUserId}
          isOnline={presenceMap?.[selected.user_id] ?? false}
          viewerIsLeader={viewerIsLeader}
          allowMakeLeader={allowMakeLeader}
          confirming={confirming}
          setConfirming={setConfirming}
          onTransferLeader={onTransferLeader}
          onKickParticipant={onKickParticipant}
          onEditMyStatus={onEditMyStatus}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ListView({ participants, leaderId, presenceMap, currentUserId, selectedId, onSelect, dark }) {
  return (
    <ul className="max-h-72 overflow-y-auto -mx-0.5 px-0.5 space-y-1">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        const isSelected = selectedId === p.user_id;
        return (
          <li key={p.user_id}>
            <button
              type="button"
              onClick={() => onSelect(p.user_id)}
              aria-pressed={isSelected}
              className={`w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected
                  ? dark ? "bg-cyan-500/10 ring-1 ring-cyan-500/40" : "bg-teal-50 ring-1 ring-teal-300"
                  : dark ? "bg-slate-800/40 hover:bg-slate-800/70" : "bg-slate-50 hover:bg-slate-100"
              }`}
            >
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
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CompactView({ participants, leaderId, presenceMap, currentUserId, selectedId, onSelect, dark }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {participants.map((p) => {
        const isLeader = p.user_id === leaderId;
        const isSelf = p.user_id === currentUserId;
        const isOnline = presenceMap?.[p.user_id] ?? false;
        const presence = presenceOf(p);
        const dotCls = isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400";
        const isSelected = selectedId === p.user_id;
        return (
          <button
            type="button"
            key={p.user_id}
            onClick={() => onSelect(p.user_id)}
            aria-pressed={isSelected}
            title={`${isSelf ? "You" : (p.display_name || "Member")}${p.status?.trim() ? ` — ${p.status}` : ""}`}
            className={`relative rounded-full ${isSelected ? "ring-2 ring-offset-1 " + (dark ? "ring-cyan-400 ring-offset-slate-900" : "ring-teal-500 ring-offset-white") : ""}`}
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
          </button>
        );
      })}
    </div>
  );
}

function ParticipantDetail({
  participant: p, dark, isLeader, isSelf, isOnline, viewerIsLeader, allowMakeLeader,
  confirming, setConfirming,
  onTransferLeader, onKickParticipant, onEditMyStatus, onClose,
}) {
  const presence = presenceOf(p);

  return (
    <div
      className={`rounded-lg border p-3 ${
        dark
          ? "bg-slate-900/90 border-cyan-500/30 shadow-lg shadow-cyan-500/10"
          : "bg-white border-teal-300 shadow-lg shadow-teal-500/10"
      }`}
    >
      <div className="flex items-start gap-3">
        <Avatar participant={p} size={48} dark={dark} isLeader={isLeader} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {isSelf ? `${p.display_name || "You"} (you)` : (p.display_name || "Member")}
            </p>
            {isLeader && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
              }`}>
                <Crown className="w-2.5 h-2.5" fill="currentColor" />
                Leader
              </span>
            )}
          </div>
          <div className={`flex items-center gap-1.5 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? (dark ? presence.dark : presence.light) : "bg-slate-400"}`} />
            <span>{presence.label}{!isOnline ? " · Offline" : ""}</span>
          </div>
          {p.joined_at && (
            <div className={`flex items-center gap-1 text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              <Clock className="w-3 h-3" />
              <span>Joined {relativeTime(p.joined_at)}</span>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`p-0.5 rounded shrink-0 ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Full status text (wraps; not truncated) */}
      <div className={`mt-3 rounded-md px-2 py-1.5 ${dark ? "bg-slate-800/60" : "bg-slate-50"}`}>
        {p.status?.trim() ? (
          <p className={`text-[12px] whitespace-pre-wrap break-words ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {p.status}
          </p>
        ) : (
          <p className={`text-[12px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
            No status set
          </p>
        )}
        {p.status_updated_at && p.status?.trim() && (
          <p className={`text-[10px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Updated {relativeTime(p.status_updated_at)}
          </p>
        )}
      </div>

      {/* Self → edit my status */}
      {isSelf && typeof onEditMyStatus === "function" && (
        <button
          type="button"
          onClick={() => { onEditMyStatus(); onClose(); }}
          className={`mt-3 w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
            dark ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25" : "bg-teal-50 text-teal-700 hover:bg-teal-100"
          }`}
        >
          <Pencil className="w-3 h-3" /> Edit my status
        </button>
      )}

      {/* Leader actions against others */}
      {viewerIsLeader && !isSelf && !isLeader && (
        <div className="mt-3 pt-3 border-t border-current/10">
          {confirming === "transfer" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Transfer leadership to ${p.display_name || "this member"}?`}
              confirmLabel="Yes, transfer"
              confirmTone="primary"
              onConfirm={() => { onTransferLeader?.(p.user_id); onClose(); }}
              onCancel={() => setConfirming(null)}
            />
          ) : confirming === "kick" ? (
            <ConfirmRow
              dark={dark}
              prompt={`Remove ${p.display_name || "this member"} from the session?`}
              confirmLabel="Remove"
              confirmTone="danger"
              onConfirm={() => { onKickParticipant?.(p.user_id); onClose(); }}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <div className={allowMakeLeader ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-1 gap-1.5"}>
              {allowMakeLeader && (
                <button
                  type="button"
                  onClick={() => setConfirming("transfer")}
                  disabled={!onTransferLeader}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                    dark ? "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25" : "bg-teal-50 text-teal-700 hover:bg-teal-100"
                  } disabled:opacity-40`}
                >
                  <ShieldCheck className="w-3 h-3" /> Make leader
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirming("kick")}
                disabled={!onKickParticipant}
                className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  dark ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-50 text-red-600 hover:bg-red-100"
                } disabled:opacity-40`}
              >
                <Trash2 className="w-3 h-3" /> Remove
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmRow({ dark, prompt, confirmLabel, confirmTone, onConfirm, onCancel }) {
  const confirmCls =
    confirmTone === "danger"
      ? dark ? "bg-red-500 hover:bg-red-400 text-white" : "bg-red-600 hover:bg-red-500 text-white"
      : dark ? "bg-cyan-500 hover:bg-cyan-400 text-white" : "bg-teal-600 hover:bg-teal-500 text-white";
  return (
    <div className="space-y-1.5">
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
